// 两个检查脚本的回归测试：node --test scripts
// 检查脚本一旦被改坏（正则写错、标记漏了），没人会发现——它们只在"有违规"时才会出声。所以这里对
// 每种违规各造一个输入，确认脚本真的会失败；对干净输入与容易误报的输入，确认脚本不会乱报。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const READONLY = join(here, 'check-readonly.mjs');
const PROD_BUNDLE = join(here, 'check-prod-bundle.mjs');

// 写函数名在这里拼出来，免得有人用 grep 扫整个仓库时把测试当成违规
const SET = 'set' + 'Doc';
const DELETE = 'delete' + 'Doc';

function withDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'check-scripts-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (script, dir) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

// ---------------- check-readonly ----------------
test('只读检查：干净的源码通过', () => {
  withDir({ 'app/a.ts': 'export const x = 1;\n' }, (dir) =>
    assert.equal(run(READONLY, dir).status, 0),
  );
});

test('只读检查：出现写函数 → 失败，并指出 文件:行号', () => {
  withDir({ 'app/bad.ts': `import { ${SET} } from 'x';\nawait ${SET}(ref, {});\n` }, (dir) => {
    const r = run(READONLY, dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /bad\.ts:1:/);
    assert.match(r.stderr, /bad\.ts:2:/);
  });
});

test('只读检查：别名 import、方法式调用、模板里的写函数名都能抓到', () => {
  withDir(
    {
      'app/alias.ts': `import { ${SET} as put } from 'x';\n`,
      'app/method.ts': `store.${DELETE}(ref);\n`,
      'app/t.html': `<button (click)="${DELETE}()">x</button>\n`,
    },
    (dir) => {
      const r = run(READONLY, dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /alias\.ts:1/);
      assert.match(r.stderr, /method\.ts:1/);
      assert.match(r.stderr, /t\.html:1/);
    },
  );
});

test('只读检查：只有 app/core/firebase/ 下的文件可以 import firebase/*', () => {
  withDir({ 'app/core/firebase/ok.ts': `import { doc } from 'firebase/firestore';\n` }, (dir) =>
    assert.equal(run(READONLY, dir).status, 0),
  );
  withDir({ 'app/features/home/home.ts': `import { doc } from 'firebase/firestore';\n` }, (dir) => {
    const r = run(READONLY, dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /home\.ts:1/);
  });
  withDir({ 'app/features/x.ts': `const m = await import('firebase/auth');\n` }, (dir) =>
    assert.equal(run(READONLY, dir).status, 1),
  );
  // 副作用式 import（没有 from）也要抓
  withDir({ 'app/features/y.ts': `import 'firebase/auth';\n` }, (dir) =>
    assert.equal(run(READONLY, dir).status, 1),
  );
});

test('只读检查：名字里只是含有 firebase 字样的 import 不误报', () => {
  withDir(
    {
      'app/a.ts': `import { x } from './firebase-helpers';\nimport { y } from '../core/firebase/auth.service';\n`,
    },
    (dir) => {
      assert.equal(run(READONLY, dir).status, 0);
    },
  );
});

// ---------------- check-prod-bundle ----------------
test('产物检查：干净的产物通过', () => {
  withDir({ 'main.js': 'console.log("hello");\n' }, (dir) =>
    assert.equal(run(PROD_BUNDLE, dir).status, 0),
  );
});

test('产物检查：项目名、回环地址、独立的端口号各自都会被抓到', () => {
  for (const [name, content] of [
    ['项目名', 'const p="demo-kebunsah";'],
    ['回环地址', 'fetch("http://127.0.0.1/x")'],
    ['Auth 端口', 'const c={authPort:9099};'],
    ['Firestore 端口', 'const c={firestorePort:8080,x:1};'],
    ['host:port', 'connect("host:8080")'],
  ]) {
    withDir({ 'main.js': content }, (dir) => {
      const r = run(PROD_BUNDLE, dir);
      assert.equal(r.status, 1, `${name} 应该被抓到`);
    });
  }
});

test('产物检查：Firestore 的 BigInt 常量里含 8080 子串，不误报', () => {
  withDir({ 'chunk.js': 'const k=[80807125n,0x24a457f466ce8d18n,-80807124n];' }, (dir) =>
    assert.equal(run(PROD_BUNDLE, dir).status, 0),
  );
});

test('产物检查：找不到构建产物 → 退出码 2，并提示先 ng build', () => {
  const r = run(PROD_BUNDLE, join(tmpdir(), 'not-exist-' + Date.now()));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ng build/);
});
