// 生产构建产物里不得带模拟器的痕迹：node scripts/check-prod-bundle.mjs [目录]
// 先 `ng build`（默认就是生产配置），再运行本脚本。标记词取开发配置里独有的值：
// 项目名和模拟器地址只写在 environment.development.ts，生产构建会把它换掉。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 端口要求前后都不是字母数字或点：裸的 8080 子串会误中 Firestore 里 BigInt 常量（如 80807125n），
// 而开发配置里的端口是独立的数字（firestorePort: 8080）。
const MARKERS = [
  'demo-kebunsah',
  '127.0.0.1',
  /(?<![\w.])9099(?![\w.])/,
  /(?<![\w.])8080(?![\w.])/,
];
const root =
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web', 'browser');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|html|json|webmanifest|css)$/.test(name)) yield p;
  }
}

let files;
try {
  files = [...walk(root)];
} catch {
  console.error(`找不到构建产物：${root}。先运行 npx ng build。`);
  process.exit(2);
}

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const marker of MARKERS) {
    const found = typeof marker === 'string' ? text.includes(marker) : marker.test(text);
    if (found) hits.push(`${relative(process.cwd(), file)} 含 ${marker}`);
  }
}

if (hits.length) {
  console.error('生产产物里发现模拟器痕迹：');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(
  `生产产物检查通过：${files.length} 个文件里没有模拟器标记（${MARKERS.map(String).join('、')}）。`,
);
