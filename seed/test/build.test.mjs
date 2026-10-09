import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.mjs';
import { makeScenarios } from '../src/scenarios.mjs';
import { createRng } from '../src/rng.mjs';

const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaSql = readFileSync(join(seedDir, '..', 'contract', 'schema.sql'), 'utf8');

// 整批构建较慢，各用例共用一份
const first = build();

test('同一种子连续构建两次，输出逐字节相同', () => {
  const again = build();
  assert.equal(JSON.stringify(again.collections), JSON.stringify(first.collections));
  assert.equal(JSON.stringify(again.manifest), JSON.stringify(first.manifest));
});

test('不同种子给出不同的数据，但仍满足比例', () => {
  const other = build({ seed: 7 });
  assert.notEqual(JSON.stringify(other.collections.plots), JSON.stringify(first.collections.plots));
  assert.deepEqual(other.manifest.statusCounts, { green: 110, yellow: 50, red: 24, needs_review: 16 });
});

test('场景表合计 197，加 3 个演示地块正好是 110/50/24/16', () => {
  const list = makeScenarios(createRng(1));
  const c = {};
  for (const s of list) c[s.target] = (c[s.target] ?? 0) + 1;
  assert.deepEqual(c, { green: 109, yellow: 49, red: 23, needs_review: 16 });
});

test('演示地块的关键数字与 contract/schema.sql 里写的一致', () => {
  const plot = (n) => first.collections.plots.find((p) => p.path.endsWith(`00000000000${n}`)).data;
  for (const [n, nick, status, area] of [[1, 'Kebun Utama', 'green', 4.23], [2, 'Kebun Belakang', 'yellow', 3.49], [3, 'Kebun Arwah Ayah', 'red', 3.4]]) {
    assert.ok(schemaSql.includes(`'${nick}'`));
    assert.equal(plot(n).nickname, nick);
    assert.equal(plot(n).status, status);
    assert.equal(plot(n).areaHaComputed, area);
    assert.ok(schemaSql.includes(`${area.toFixed(4)}, 2`), `schema.sql 里没找到面积 ${area}`); // area_ha_computed 与 oil_palm_planted_year 相邻
  }
});

test('自检：场景要求 green，数据却是执照过期 → 构建直接抛错，不产出任何结果，并报出 plotId', () => {
  const scenarios = makeScenarios(createRng(1));
  const i = scenarios.findIndex((s) => s.target === 'green');
  scenarios[i] = { ...scenarios[i], licence: 'expired' };
  assert.throws(() => build({ scenarios }), /plotId [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}.*目标 green，规则引擎算出 red/);
});

test('自检：几何要求"面积多出 > 50%"，场景却标成 yellow → 抛错', () => {
  const scenarios = makeScenarios(createRng(1));
  const i = scenarios.findIndex((s) => s.target === 'yellow' && s.area === 'warn');
  scenarios[i] = { ...scenarios[i], area: 'fail' };
  assert.throws(() => build({ scenarios }), /目标 yellow，规则引擎算出 red/);
});

// ---- 校验器：对完整输出通过，对故意改坏的副本报错 ----
function validate(dir) {
  return spawnSync(process.execPath, [join(seedDir, 'validate.mjs')], { env: { ...process.env, SEED_DATA_DIR: dir }, encoding: 'utf8' });
}

// 用本进程刚构建的结果写一份临时副本，不依赖磁盘上未入库的 seed/data/，克隆后直接 npm test 也能过
function withCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-validate-'));
  try {
    for (const [name, docs] of Object.entries(first.collections)) writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(docs, null, 2)}\n`);
    writeFileSync(join(dir, '_manifest.json'), `${JSON.stringify(first.manifest, null, 2)}\n`);
    const load = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
    const save = (name, v) => writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(v, null, 2)}\n`);
    mutate({ load, save, dir });
    return validate(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('校验器：对完整输出通过', () => {
  const r = withCopy(() => {});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /全部通过：200 个地块/);
});

test('校验器：把 4 公顷以上的地块改成 point → 报错', () => {
  const r = withCopy(({ load, save }) => {
    const plots = load('plots');
    const big = plots.find((p) => p.data.geometryType === 'polygon' && p.data.areaHaComputed >= 5);
    Object.assign(big.data, { geometryType: 'point', polygonGeojson: null, areaHaDeclared: big.data.areaHaComputed, areaHaComputed: null });
    save('plots', plots);
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /point 缺质心／手填面积，或手填面积 ≥ 4/);
});

test('校验器：评估 done 却没有 result / 与 plots.status 不符 → 报错', () => {
  const r = withCopy(({ load, save }) => {
    const a = load('assessments');
    a[10].data.result = null;
    save('assessments', a);
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /评估 done\/null 与 plots\.status/);
});

test('校验器：把 yellow 地块偷偷改成 green（状态与规则重算不符）→ 报错', () => {
  const r = withCopy(({ load, save }) => {
    const plots = load('plots');
    const y = plots.find((p) => p.data.status === 'yellow' && !p.path.endsWith('2'));
    y.data.status = 'green';
    save('plots', plots);
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /独立聚合得 yellow/);
});

test('校验器：输出里混进明文身份证号 → 报错', () => {
  const r = withCopy(({ dir }) => {
    const file = join(dir, 'titles.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"sourceDocumentPath"', '"leak": "720304075117",\n"sourceDocumentPath"'));
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /明文身份证号/);
});

test('校验器：多边形数组直接嵌套（原样 GeoJSON）→ 报错', () => {
  const r = withCopy(({ load, save }) => {
    const plots = load('plots');
    const p = plots.find((x) => x.data.geometryType === 'polygon' && !x.path.endsWith('1') && !x.path.endsWith('2') && !x.path.endsWith('3'));
    p.data.polygonGeojson = JSON.parse(p.data.polygonGeojson); // 变成对象，里面是三层数组
    save('plots', plots);
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /数组直接嵌套数组|JSON 字符串/);
});

test('校验器：引用不存在的地契 → 报错', () => {
  const r = withCopy(({ load, save }) => {
    const plots = load('plots');
    plots[5].data.landTitleId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    save('plots', plots);
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /landTitleId 引用不存在/); // 是校验器报出的错误，而不是它自己崩溃
  assert.doesNotMatch(r.stderr, /TypeError/);
});
