// 把 seed/data/ 灌进本机 Firestore 模拟器：FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node seed/load-emulator.mjs
//
// 护栏（刻意写死，不能用参数绕过）：
//   - 没设 FIRESTORE_EMULATOR_HOST → 不发任何网络请求，提示后正常退出；
//   - 主机不是回环地址（localhost / 127.0.0.1 / [::1]）→ 拒绝；
//   - 项目 ID 固定 demo-kebunsah，不读环境变量或参数；
//   - 不读取任何服务账号或凭据文件。
// 模拟器上用 "Authorization: Bearer owner" 绕过安全规则，这个头对线上 Firestore 无效。
// 前端（web/）对 Firestore 只读，写入只发生在这个脚本里，且只写本机模拟器。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMESTAMP_FIELDS, ISO_TIMESTAMP } from './src/shape.mjs';

const PROJECT = 'demo-kebunsah';
const BATCH = 400; // Firestore 单次提交上限 500，留余量
const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data');

// ---- 护栏 ----
export function resolveEmulatorHost(env = process.env) {
  const hostEnv = env.FIRESTORE_EMULATOR_HOST;
  if (!hostEnv) return { ok: false, reason: '未设置 FIRESTORE_EMULATOR_HOST，不会连接任何服务。先启动模拟器，例如：\n  firebase emulators:start --only firestore --project demo-kebunsah\n再设置 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 后重新运行。' };
  const m = /^(?:https?:\/\/)?(\[[0-9a-fA-F:]+\]|[^:/]+)(?::(\d+))?\/?$/.exec(hostEnv.trim());
  if (!m) return { ok: false, reason: `FIRESTORE_EMULATOR_HOST 格式不对：${hostEnv}` };
  const host = m[1];
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host.toLowerCase())) {
    return { ok: false, reason: `拒绝执行：${host} 不是本机回环地址。这个脚本只允许写本机的 Firestore 模拟器。` };
  }
  return { ok: true, base: `http://${host}:${m[2] ?? '8080'}` };
}

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

async function main() {
  const target = resolveEmulatorHost();
  if (!target.ok) {
    console.log(target.reason);
    // 没设变量是正常情况，退出码 0；地址不合规才是错误
    process.exit(process.env.FIRESTORE_EMULATOR_HOST ? 1 : 0);
  }
  const base = target.base;

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

  console.log(`连接 ${base}，项目 ${PROJECT}，共 ${writes.length} 个文档`);
  for (let i = 0; i < writes.length; i += BATCH) {
    const chunk = writes.slice(i, i + BATCH);
    try {
      // 不带 updateMask 的 update = 整篇覆盖，重跑不会产生重复
      await call(base, 'POST', `/v1/projects/${PROJECT}/databases/(default)/documents:commit`, { writes: chunk });
    } catch (err) {
      // 批量失败时逐个重试，指出具体是哪个文档写不进去
      for (const w of chunk) {
        try {
          await call(base, 'POST', `/v1/projects/${PROJECT}/databases/(default)/documents:commit`, { writes: [w] });
        } catch (e) {
          console.error(`写入失败：${w.update.name.split('/documents/')[1]}\n${e.message}`);
          process.exit(1);
        }
      }
      void err;
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
  console.log('完成。');
}

// 被测试引用时不执行 main
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
