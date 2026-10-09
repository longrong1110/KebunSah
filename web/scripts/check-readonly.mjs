// 只读铁律检查：node scripts/check-readonly.mjs [目录]
//   1. web/src 里不得出现 Firestore 的写函数（写入只走后端 API）；
//   2. 只有 app/core/firebase/ 下的文件可以 import 'firebase/*'，组件与页面一律走 AuthService / FirestoreReader。
// 有违规就打印 文件:行号 并以非零码退出。
// 禁用名单由片段拼出来，脚本自己的源码里不出现完整的函数名，免得检查把自己当成违规。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const verbs = ['add', 'set', 'update', 'delete'];
const BANNED = [...verbs.map((v) => `${v}Doc`), 'write' + 'Batch', 'run' + 'Transaction'];
const WRITE_CALL = new RegExp(`\\b(${BANNED.join('|')})\\b`);
// import ... from 'firebase/…'、import 'firebase/…'（副作用式）、import('firebase/…')、require('firebase/…')
const FIREBASE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]firebase[/'"]/;
const ALLOWED_IMPORT_DIR = 'app/core/firebase/';

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|html)$/.test(name)) yield p;
  }
}

const hits = [];
for (const file of walk(root)) {
  const rel = relative(root, file).split('\\').join('/');
  const where = relative(process.cwd(), file);
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const m = WRITE_CALL.exec(line);
      if (m) hits.push(`${where}:${i + 1}: 写函数 ${m[1]}  →  ${line.trim()}`);
      if (FIREBASE_IMPORT.test(line) && !rel.startsWith(ALLOWED_IMPORT_DIR)) {
        hits.push(
          `${where}:${i + 1}: 只有 ${ALLOWED_IMPORT_DIR} 下的文件可以 import firebase/*  →  ${line.trim()}`,
        );
      }
    });
}

if (hits.length) {
  console.error('违反前端只读与分层约定：');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(
  `只读检查通过：${root} 里没有 Firestore 写函数，firebase/* 只在 ${ALLOWED_IMPORT_DIR} 里被引用。`,
);
