// 把 seed/data/ 灌进本机 Firebase 模拟器：
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node seed/load-emulator.mjs
// 两个步骤各自判断、各自跳过：
//   - 设了 FIRESTORE_EMULATOR_HOST → 灌 Firestore（整篇覆盖，重跑不产生重复）；
//   - 设了 FIREBASE_AUTH_EMULATOR_HOST → 在 Auth 模拟器建 users 里的账号（uid = users 文档 id，手机号 = phone），
//     这样用测试号登录后 uid 能对上 users/{uid}（已在 Auth 模拟器上实测）。
//
// 护栏（刻意写死，不能用参数绕过）：
//   - 一个变量都没设 → 不发任何网络请求，提示后正常退出；
//   - 任一主机不是回环地址（localhost / 127.0.0.1 / [::1]）→ 拒绝，什么都不做；
//   - 项目 ID 固定 demo-kebunsah，不读环境变量或参数；
//   - 不读取任何服务账号或凭据文件。
// 模拟器上用 "Authorization: Bearer owner" 绕过安全规则，这个头对线上服务无效。
// 前端（web/）对 Firestore 只读，写入只发生在这个脚本里，且只写本机模拟器。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMESTAMP_FIELDS, ISO_TIMESTAMP } from './src/shape.mjs';

const PROJECT = 'demo-kebunsah';
const BATCH = 400; // Firestore 单次提交上限 500，留余量
const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data');

// ---- 护栏 ----
function resolveHost(env, varName, defaultPort, hint) {
  const hostEnv = env[varName];
  if (!hostEnv) return { ok: false, unset: true, reason: `未设置 ${varName}，不会连接。${hint}` };
  const m = /^(?:https?:\/\/)?(\[[0-9a-fA-F:]+\]|[^:/]+)(?::(\d+))?\/?$/.exec(hostEnv.trim());
  if (!m) return { ok: false, reason: `${varName} 格式不对：${hostEnv}` };
  const host = m[1];
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host.toLowerCase())) {
    return { ok: false, reason: `拒绝执行：${varName} 的主机 ${host} 不是本机回环地址。这个脚本只允许写本机的模拟器。` };
  }
  return { ok: true, base: `http://${host}:${m[2] ?? defaultPort}` };
}

export const resolveEmulatorHost = (env = process.env) =>
  resolveHost(env, 'FIRESTORE_EMULATOR_HOST', '8080', '先启动模拟器（web/ 里 npm run emulators），再设置 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080。');

export const resolveAuthHost = (env = process.env) =>
  resolveHost(env, 'FIREBASE_AUTH_EMULATOR_HOST', '9099', '先启动模拟器（web/ 里 npm run emulators），再设置 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099。');

// ---- JSON → Firestore REST 类型化值 ----
export function toValue(v, key = '') {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') {
    if (TIMESTAMP_FIELDS.has(key) && ISO_TIMESTAMP.test(v)) return { timestampValue: v };
    return { stringValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map((x) => toValue(x, key)) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`无法编码的值：${String(v)}`);
}

export const toFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, toValue(x, k)]));

const docName = (path) => `projects/${PROJECT}/databases/(default)/documents/${path}`;

// ---- Auth：users 文档 → 账号 ----
// uid 就是 users 文档 id（路径最后一段），手机号取 data.phone；缺手机号的账号没法用手机号登录，直接跳过。
export function accountsFromUsers(userDocs) {
  return userDocs
    .filter((d) => d.path.startsWith('users/') && d.data.phone)
    .map((d) => ({ localId: d.path.split('/').pop(), phoneNumber: d.data.phone }));
}

// accounts:batchCreate 不幂等：已存在的 localId 在 error[] 里报一条，HTTP 状态仍是 200。
// 已存在视为跳过，其余才是真错误。
export function interpretBatchCreate(body, requested) {
  const errors = Array.isArray(body?.error) ? body.error : [];
  const existing = errors.filter((e) => /existing account/i.test(e.message ?? ''));
  const failed = errors.filter((e) => !/existing account/i.test(e.message ?? ''));
  return { created: requested - errors.length, existing: existing.length, failed };
}

async function call(base, method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function loadFirestore(base) {
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.json') && f !== '_manifest.json');
  const expected = {}; // collectionId → 数量，灌完后核对
  const writes = [];
  for (const f of files) {
    for (const d of JSON.parse(readFileSync(join(dataDir, f), 'utf8'))) {
      writes.push({ update: { name: docName(d.path), fields: toFields(d.data) } });
      const segs = d.path.split('/');
      const colId = segs[segs.length - 2];
      expected[colId] = (expected[colId] ?? 0) + 1;
    }
  }

  console.log(`Firestore：连接 ${base}，项目 ${PROJECT}，共 ${writes.length} 个文档`);
  const commit = (chunk) => call(base, 'POST', `/v1/projects/${PROJECT}/databases/(default)/documents:commit`, { writes: chunk });
  for (let i = 0; i < writes.length; i += BATCH) {
    const chunk = writes.slice(i, i + BATCH);
    try {
      // 不带 updateMask 的 update = 整篇覆盖，重跑不会产生重复
      await commit(chunk);
    } catch (batchErr) {
      // 批量失败：先看是不是根本连不上，再逐个重试指出具体是哪个文档写不进去
      if (!/→ \d{3} /.test(batchErr.message)) {
        console.error(`连不上 Firestore 模拟器（${base}）。是否已启动？\n${batchErr.cause?.message ?? batchErr.message}`);
        process.exit(1);
      }
      for (const w of chunk) {
        try {
          await commit([w]);
        } catch (e) {
          console.error(`写入失败：${w.update.name.split('/documents/')[1]}\n${e.message}`);
          process.exit(1);
        }
      }
    }
    console.log(`  已写入 ${Math.min(i + BATCH, writes.length)} / ${writes.length}`);
  }

  // 核对：每个集合 ID（含子集合）下的文档数
  let bad = 0;
  for (const [colId, n] of Object.entries(expected)) {
    const rows = await call(base, 'POST', `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, {
      structuredQuery: { from: [{ collectionId: colId, allDescendants: true }], select: { fields: [{ fieldPath: '__name__' }] } },
    });
    const got = rows.filter((r) => r.document).length;
    const ok = got === n;
    if (!ok) bad++;
    console.log(`  ${ok ? '一致' : '不一致'}  ${colId}: 期望 ${n}，实际 ${got}`);
  }
  if (bad) process.exit(1);
}

async function loadAuth(base) {
  const users = JSON.parse(readFileSync(join(dataDir, 'users.json'), 'utf8'));
  const accounts = accountsFromUsers(users);
  console.log(`Auth：连接 ${base}，项目 ${PROJECT}，共 ${accounts.length} 个账号`);
  let body;
  try {
    body = await call(base, 'POST', `/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchCreate`, { users: accounts });
  } catch (err) {
    if (!/→ \d{3} /.test(err.message)) {
      console.error(`连不上 Auth 模拟器（${base}）。是否已启动？\n${err.cause?.message ?? err.message}`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
  const r = interpretBatchCreate(body, accounts.length);
  if (r.failed.length) {
    console.error(`建账号失败：${JSON.stringify(r.failed)}`);
    process.exit(1);
  }
  console.log(`  新建 ${r.created} 个，已存在跳过 ${r.existing} 个`);

  // 核对：每个账号的 uid 与手机号都在 Auth 模拟器里
  const listed = await call(base, 'GET', `/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?maxResults=1000`);
  const byUid = new Map((listed?.users ?? []).map((u) => [u.localId, u.phoneNumber]));
  const missing = accounts.filter((a) => byUid.get(a.localId) !== a.phoneNumber);
  if (missing.length) {
    console.error(`Auth 核对不一致：${missing.map((a) => `${a.localId}(${a.phoneNumber})`).join('、')}`);
    process.exit(1);
  }
  console.log(`  一致  Auth 账号：期望 ${accounts.length}，uid 与手机号都对得上`);
}

async function main() {
  const fs = resolveEmulatorHost();
  const au = resolveAuthHost();
  // 设了变量却不合规 → 拒绝，什么都不做（未设置不算错误）
  for (const t of [fs, au]) {
    if (!t.ok && !t.unset) {
      console.error(t.reason);
      process.exit(1);
    }
  }
  if (fs.unset && au.unset) {
    console.log(`${fs.reason}\n${au.reason}`);
    return;
  }

  if (fs.ok) await loadFirestore(fs.base);
  else console.log(`跳过 Firestore：${fs.reason}`);

  if (au.ok) await loadAuth(au.base);
  else console.log(`跳过 Auth：${au.reason}`);
  console.log('完成。');
}

// 被测试引用时不执行 main
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
