import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountsFromUsers, interpretBatchCreate, resolveAuthHost, resolveEmulatorHost } from '../load-emulator.mjs';

const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Auth 主机护栏：只认回环地址，没设变量不连，端口默认 9099', () => {
  assert.equal(resolveAuthHost({}).ok, false);
  assert.equal(resolveAuthHost({}).unset, true);
  assert.equal(resolveAuthHost({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1' }).base, 'http://127.0.0.1:9099');
  assert.equal(resolveAuthHost({ FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9100' }).base, 'http://localhost:9100');
  assert.equal(resolveAuthHost({ FIREBASE_AUTH_EMULATOR_HOST: '[::1]:9099' }).base, 'http://[::1]:9099');
  for (const bad of ['identitytoolkit.googleapis.com:443', '10.0.0.5:9099', 'localhost.evil.com:9099', 'evil.localhost.com', '0.0.0.0:9099']) {
    const r = resolveAuthHost({ FIREBASE_AUTH_EMULATOR_HOST: bad });
    assert.equal(r.ok, false, bad);
    assert.notEqual(r.unset, true, `${bad} 是"不合规"，不是"没设置"`);
  }
});

test('Firestore 主机护栏的行为保持不变（Auth 步骤没有破坏它）', () => {
  assert.equal(resolveEmulatorHost({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).base, 'http://127.0.0.1:8080');
  assert.equal(resolveEmulatorHost({ FIRESTORE_EMULATOR_HOST: '10.0.0.5:8080' }).ok, false);
  assert.equal(resolveEmulatorHost({}).unset, true);
});

test('users 文档 → Auth 账号：uid 取文档 id，手机号取 phone', () => {
  const users = JSON.parse(readFileSync(join(seedDir, 'data', 'users.json'), 'utf8'));
  const accounts = accountsFromUsers(users);
  assert.deepEqual(accounts, [
    { localId: 'demo-officer-1', phoneNumber: '+60100000001' },
    { localId: 'demo-admin-1', phoneNumber: '+60100000002' },
    { localId: 'demo-smallholder-1', phoneNumber: '+60100000011' },
    { localId: 'demo-smallholder-2', phoneNumber: '+60100000012' },
    { localId: 'demo-smallholder-3', phoneNumber: '+60100000013' },
  ]);
});

test('没有手机号的 users 文档、非 users 路径都会被跳过', () => {
  assert.deepEqual(
    accountsFromUsers([
      { path: 'users/a', data: { phone: '+60100000001' } },
      { path: 'users/b', data: { phone: null } },
      { path: 'persons/c', data: { phone: '+60100000003' } },
    ]),
    [{ localId: 'a', phoneNumber: '+60100000001' }],
  );
});

test('batchCreate 响应：全部新建；已存在视为跳过（HTTP 200 + error[]）；其余是真错误', () => {
  assert.deepEqual(interpretBatchCreate({ kind: 'x', error: [] }, 5), { created: 5, existing: 0, failed: [] });
  assert.deepEqual(interpretBatchCreate({}, 2), { created: 2, existing: 0, failed: [] });
  const existing = { index: 0, message: 'localId belongs to an existing account - can not overwrite.' };
  assert.deepEqual(interpretBatchCreate({ error: [existing, { ...existing, index: 1 }] }, 5), { created: 3, existing: 2, failed: [] });
  const other = { index: 2, message: 'PHONE_NUMBER_EXISTS' };
  const r = interpretBatchCreate({ error: [existing, other] }, 5);
  assert.equal(r.existing, 1);
  assert.deepEqual(r.failed, [other]);
});

// ---- 命令行：护栏路径，不需要模拟器 ----
function run(env) {
  const clean = { ...process.env };
  delete clean.FIRESTORE_EMULATOR_HOST;
  delete clean.FIREBASE_AUTH_EMULATOR_HOST;
  return spawnSync(process.execPath, [join(seedDir, 'load-emulator.mjs')], { env: { ...clean, ...env }, encoding: 'utf8' });
}

test('命令行：两个变量都没设 → 不连任何服务，退出码 0', () => {
  const r = run({});
  assert.equal(r.status, 0);
  assert.match(r.stdout, /FIRESTORE_EMULATOR_HOST/);
  assert.match(r.stdout, /FIREBASE_AUTH_EMULATOR_HOST/);
});

test('命令行：Auth 主机不是回环地址 → 拒绝，退出码 1', () => {
  const r = run({ FIREBASE_AUTH_EMULATOR_HOST: 'example.com:9099' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /不是本机回环地址/);
});

test('命令行：Firestore 合规但 Auth 主机不合规 → 整体拒绝，一个都不灌', () => {
  const r = run({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_AUTH_EMULATOR_HOST: '10.0.0.5:9099' });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /Firestore：连接/);
});

test('命令行：模拟器没启动 → 提示"连不上"，而不是把网络错误误报成某个文档写不进去', () => {
  const r = run({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /连不上 Firestore 模拟器/);
  assert.doesNotMatch(r.stderr, /写入失败/);
});
