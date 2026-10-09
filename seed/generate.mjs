// 生成 200 个模拟地块：node seed/generate.mjs
// 先在内存里全部造好并自检（每个地块的状态都由规则引擎重算），全部通过才写 seed/data/。
// 任何一处对不上就非零退出，旧输出原封不动，不会留下写了一半的文件。
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './src/build.mjs';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data');

let result;
try {
  result = build();
} catch (err) {
  console.error(`生成失败，没有写任何文件：\n${err.message}`);
  process.exit(1);
}

// 文件统一 LF 换行、2 空格缩进、末尾一个换行，Windows 上也逐字节一致
const text = (value) => `${JSON.stringify(value, null, 2)}\n`;

mkdirSync(dataDir, { recursive: true });
for (const f of readdirSync(dataDir)) {
  if (f.endsWith('.json')) rmSync(join(dataDir, f));
}
for (const [name, docs] of Object.entries(result.collections)) {
  writeFileSync(join(dataDir, `${name}.json`), text(docs));
}
writeFileSync(join(dataDir, '_manifest.json'), text(result.manifest));

const { statusCounts, collections } = result.manifest;
console.log(`已写入 ${dataDir}`);
console.log('状态：', statusCounts);
console.log('文档数：', collections);
