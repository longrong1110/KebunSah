import test from 'node:test';
import assert from 'node:assert/strict';
import { toHa, fromHa, round, toTenThousandths } from '../src/units.mjs';
import { addDays, diffDays, addYears, myt } from '../src/dates.mjs';
import { createRng } from '../src/rng.mjs';
import { ringAreaHa, makePolygon, isSimpleRing, ringsOverlap, pointInRing, createCellAllocator, bbox } from '../src/geo.mjs';

test('面积换算与 schema.sql 的生成列公式一致，保留 4 位小数', () => {
  assert.equal(toHa(4.2, 'ha'), 4.2);
  assert.equal(toHa(10000, 'sqm'), 1);
  assert.equal(toHa(38500, 'sqm'), 3.85);
  assert.equal(toHa(10, 'acre'), 4.0469); // 10 × 0.40468564224 = 4.0468564… → 4.0469
  assert.equal(toHa(100, 'acre'), 40.4686); // MPOB 小园主上限 100 英亩 ≈ 40.46 公顷
  assert.equal(toHa(43560, 'sqft'), 0.4047);
  assert.throws(() => toHa(1, 'yard'));
});

test('公顷换回纸面单位，再换回公顷基本不失真', () => {
  for (const unit of ['ha', 'acre', 'sqm', 'sqft']) {
    assert.ok(Math.abs(toHa(fromHa(3.37, unit), unit) - 3.37) < 0.0002, unit);
  }
});

test('万分位整数比较避开浮点误差', () => {
  assert.equal(toTenThousandths(3.04), 30400);
  assert.equal(toTenThousandths(0.1 + 0.2), 3000);
  assert.equal(round(1.005, 2), 1.01);
});

test('日期运算按 UTC 整数天，不受时区影响', () => {
  assert.equal(addDays('2026-10-09', 90), '2027-01-07');
  assert.equal(diffDays('2026-10-09', '2026-12-05'), 57);
  assert.equal(diffDays('2026-10-09', '2026-04-30'), -162);
  assert.equal(addYears('2024-03-01', 5), '2029-03-01');
  assert.equal(myt('2026-10-02', '09:10'), '2026-10-02T01:10:00.000Z');
});

test('同一种子给出同一串随机数，分叉互不影响', () => {
  const a = createRng(1), b = createRng(1);
  assert.deepEqual([a.next(), a.next(), a.int(0, 9)], [b.next(), b.next(), b.int(0, 9)]);
  assert.notEqual(createRng(1).fork('x').next(), createRng(1).fork('y').next());
  assert.match(createRng(7).uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('球面面积：schema.sql 的演示多边形与它声明的面积相差不到 0.05 公顷', () => {
  const demo = [
    [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895], [101.149037, 4.310895], [101.149037, 4.309105]], 4.23],
    [[[101.161125, 4.324187], [101.162875, 4.324187], [101.162875, 4.325813], [101.161125, 4.325813], [101.161125, 4.324187]], 3.49],
    [[[101.140137, 4.297198], [101.141863, 4.297198], [101.141863, 4.298802], [101.140137, 4.298802], [101.140137, 4.297198]], 3.4],
  ];
  for (const [ring, declared] of demo) assert.ok(Math.abs(ringAreaHa(ring) - declared) < 0.05, `${ringAreaHa(ring)} vs ${declared}`);
});

test('造出的多边形：面积接近目标、不自交、质心在里面、坐标最多 6 位小数', () => {
  const rng = createRng(42);
  for (const target of [0.5, 3, 8.4, 12, 19]) {
    for (let i = 0; i < 20; i++) {
      const poly = makePolygon(rng, { centerLat: 4.3, centerLng: 101.15, targetHa: target });
      assert.ok(Math.abs(poly.areaHa - target) / target < 0.01, `目标 ${target} 实际 ${poly.areaHa}`);
      assert.ok(isSimpleRing(poly.ring));
      assert.ok(pointInRing(poly.centroid, poly.ring));
      assert.deepEqual(poly.ring[0], poly.ring.at(-1));
      for (const [x, y] of poly.ring) assert.ok(Math.abs(x * 1e6 - Math.round(x * 1e6)) < 1e-6 && Math.abs(y * 1e6 - Math.round(y * 1e6)) < 1e-6);
    }
  }
});

test('自交、重叠与点在多边形内的判断', () => {
  const bowtie = [[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]];
  const square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  assert.equal(isSimpleRing(bowtie), false);
  assert.equal(isSimpleRing(square), true);
  assert.equal(pointInRing([1, 1], square), true);
  assert.equal(pointInRing([3, 1], square), false);
  const shifted = square.map(([x, y]) => [x + 1, y + 1]);
  const apart = square.map(([x, y]) => [x + 5, y + 5]);
  const inner = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]];
  assert.equal(ringsOverlap(square, shifted), true);
  assert.equal(ringsOverlap(square, inner), true); // 完全包含也算重叠
  assert.equal(ringsOverlap(square, apart), false);
});

test('格子分配器：200 个格子互不重叠，并避开预留区域', () => {
  const alloc = createCellAllocator(0.007);
  const reserved = { minLng: 101.148, maxLng: 101.152, minLat: 4.308, maxLat: 4.312 };
  alloc.reserve(reserved);
  const cells = Array.from({ length: 200 }, () => alloc.take([4.31, 101.15]).cell);
  for (let i = 0; i < cells.length; i++) {
    assert.equal(cells[i].minLng < reserved.maxLng && cells[i].maxLng > reserved.minLng && cells[i].minLat < reserved.maxLat && cells[i].maxLat > reserved.minLat, false);
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      assert.equal(a.minLng < b.maxLng && a.maxLng > b.minLng && a.minLat < b.maxLat && a.maxLat > b.minLat, false);
    }
  }
  void bbox;
});
