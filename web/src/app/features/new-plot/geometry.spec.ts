import {
  GeometryDraft,
  LngLat,
  Ring,
  checkRing,
  evaluate,
  parseDeclaredHa,
  ringAreaHa,
  selfIntersects,
  toGeoJsonPolygon,
} from './geometry';

// 屏 5 原型里点出的矩形（z17、中心约 4.325°N、101.162°E，180×160 px）：独立实测 4.0756 公顷
const RECT: Ring = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];

// 「蝴蝶结」：第 1—2 条边与第 3—4 条边交叉
const BOWTIE: Ring = [
  [101.0, 4.0],
  [101.002, 4.002],
  [101.002, 4.0],
  [101.0, 4.002],
];

const draft = (patch: Partial<GeometryDraft> = {}): GeometryDraft => ({
  tab: 'map',
  mapRing: [],
  walkRing: [],
  point: null,
  declared: '',
  ...patch,
});

describe('ringAreaHa', () => {
  it('矩形的球面面积与独立实测相符（≈4.0756 ha）', () => {
    expect(ringAreaHa(RECT)).toBeCloseTo(4.0756, 2);
  });

  it('不管顶点顺时针还是逆时针，面积一样（正数）', () => {
    expect(ringAreaHa([...RECT].reverse())).toBeCloseTo(ringAreaHa(RECT), 6);
  });

  it('少于 3 个点是 0', () => {
    expect(ringAreaHa([])).toBe(0);
    expect(ringAreaHa(RECT.slice(0, 2))).toBe(0);
  });

  it('三点共线是 0', () => {
    expect(
      ringAreaHa([
        [101, 4],
        [101.001, 4],
        [101.002, 4],
      ]),
    ).toBeCloseTo(0, 8);
  });
});

describe('selfIntersects', () => {
  it('矩形不交叉', () => expect(selfIntersects(RECT)).toBe(false));
  it('三角形不交叉（没有不相邻的边）', () => expect(selfIntersects(RECT.slice(0, 3))).toBe(false));
  it('蝴蝶结交叉', () => expect(selfIntersects(BOWTIE)).toBe(true));

  it('凹多边形（L 形）不算交叉', () => {
    const l: Ring = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ];
    expect(selfIntersects(l)).toBe(false);
  });

  it('共线重叠（一条边的一部分压在另一条边上）算交叉', () => {
    // 第 3 个点 (1,0) 落在第 1 条边 (0,0)→(2,0) 上
    const spike: Ring = [
      [0, 0],
      [2, 0],
      [1, 0],
      [1, 1],
    ];
    expect(selfIntersects(spike)).toBe(true);
  });

  it('把一个顶点拖到对边上（接触）算交叉', () => {
    const touching: Ring = [
      [0, 0],
      [2, 0],
      [2, 2],
      [1, 0],
      [0, 2],
    ];
    expect(selfIntersects(touching)).toBe(true);
  });

  it('四个点、只有最后一条边（末点→首点）与第 2 条边交叉：回绕的那条边也要比', () => {
    // 末边 (3,1)→(0,0) 穿过第 2 条边 (2,0)→(2,3)；它与第 1、3 条边只共用端点，所以只有「末边 × 第 2 条边」这一对能查出来
    const wrap: Ring = [
      [0, 0],
      [2, 0],
      [2, 3],
      [3, 1],
    ];
    expect(selfIntersects(wrap)).toBe(true);
  });

  it('首尾相连的那条边与别的边交叉也要查出来', () => {
    // 最后一条边（4→0）与第 2 条边（1→2）交叉
    const closing: Ring = [
      [0, 0],
      [3, 0],
      [3, 3],
      [-1, 1],
      [4, 1],
    ];
    expect(selfIntersects(closing)).toBe(true);
  });
});

describe('checkRing', () => {
  it('少于 3 个点：few，没有面积', () => {
    expect(checkRing([])).toEqual({ count: 0, areaHa: null, problem: 'few' });
    expect(checkRing(RECT.slice(0, 2)).problem).toBe('few');
  });

  it('自交：self，不给面积', () => {
    expect(checkRing(BOWTIE)).toMatchObject({ problem: 'self', areaHa: null });
  });

  it('面积四舍五入成 0（< 0.005 ha）：tiny', () => {
    // 约 1 m × 1 m
    const tiny: Ring = [
      [101, 4],
      [101.00001, 4],
      [101.00001, 4.00001],
      [101, 4.00001],
    ];
    expect(checkRing(tiny).problem).toBe('tiny');
  });

  it('连续重复的点（站着不动按了两次）不算交叉，也不算多一个点', () => {
    const dup: Ring = [
      [101, 4],
      [101, 4],
      [101.001, 4],
      [101.001, 4.001],
    ];
    const c = checkRing(dup);
    expect(c.problem).toBeNull();
    expect(c.count).toBe(3);
    expect(c.areaHa).toBeGreaterThan(0.005);
    // 全是同一个点：点数不够
    expect(
      checkRing([
        [101, 4],
        [101, 4],
        [101, 4],
      ]).problem,
    ).toBe('few');
    // 最后一个点与第一个重合
    expect(
      checkRing([
        [101, 4],
        [101.001, 4],
        [101.001, 4.001],
        [101, 4],
      ]).count,
    ).toBe(3);
  });

  it('三点共线：tiny（面积为 0）', () => {
    expect(
      checkRing([
        [101, 4],
        [101.001, 4],
        [101.002, 4],
      ]).problem,
    ).toBe('tiny');
  });

  it('有效：给出面积，4 公顷以上也有效（多边形没有上限）', () => {
    const ok = checkRing(RECT);
    expect(ok.problem).toBeNull();
    expect(ok.areaHa).toBeCloseTo(4.0756, 2);
    expect(ok.count).toBe(4);
  });
});

describe('parseDeclaredHa', () => {
  it('空：empty', () => {
    expect(parseDeclaredHa('')).toEqual({ kind: 'empty' });
    expect(parseDeclaredHa('   ')).toEqual({ kind: 'empty' });
  });

  it('正常数字：ok', () => {
    expect(parseDeclaredHa('2.5')).toEqual({ kind: 'ok', ha: 2.5 });
    expect(parseDeclaredHa(' 3 ')).toEqual({ kind: 'ok', ha: 3 });
    expect(parseDeclaredHa('.5')).toEqual({ kind: 'ok', ha: 0.5 });
  });

  it('逗号小数按小数点处理', () => {
    expect(parseDeclaredHa('2,5')).toEqual({ kind: 'ok', ha: 2.5 });
  });

  it('0、负数、非数字、多个小数点：invalid', () => {
    for (const bad of ['0', '0.0000', '-1', 'abc', '1.2.3', '1,2,3', '2 ha', '.', '1e2']) {
      expect(parseDeclaredHa(bad), bad).toEqual({ kind: 'invalid' });
    }
  });

  it('3.9999 可以，4 与以上要改画边界（big）', () => {
    expect(parseDeclaredHa('3.9999')).toEqual({ kind: 'ok', ha: 3.9999 });
    expect(parseDeclaredHa('4')).toEqual({ kind: 'big', ha: 4 });
    expect(parseDeclaredHa('12.5')).toEqual({ kind: 'big', ha: 12.5 });
  });

  it('最多 4 位小数：多出来的四舍五入', () => {
    expect(parseDeclaredHa('1.23456')).toEqual({ kind: 'ok', ha: 1.2346 });
    // 四舍五入后恰好到 4
    expect(parseDeclaredHa('3.99996')).toEqual({ kind: 'big', ha: 4 });
  });
});

describe('evaluate', () => {
  it('A 页签：有效多边形给出 polygon 结果与面积', () => {
    const e = evaluate(draft({ tab: 'map', mapRing: RECT }));
    expect(e.problem).toBeNull();
    expect(e.geometry).toMatchObject({ kind: 'polygon', method: 'map', ring: RECT });
    expect(e.areaHa).toBeCloseTo(4.0756, 2);
  });

  it('保存的 ring 不含连续重复的点', () => {
    const dup: Ring = [RECT[0], RECT[0], RECT[1], RECT[2], RECT[3]];
    const e = evaluate(draft({ tab: 'map', mapRing: dup }));
    expect(e.geometry && e.geometry.kind === 'polygon' && e.geometry.ring).toEqual(RECT);
  });

  it('B 页签只看走出来的点，不看 A 页签画的', () => {
    const e = evaluate(draft({ tab: 'walk', mapRing: RECT, walkRing: RECT.slice(0, 2) }));
    expect(e.problem).toBe('few');
    expect(e.geometry).toBeNull();
    const ok = evaluate(draft({ tab: 'walk', walkRing: RECT }));
    expect(ok.geometry).toMatchObject({ kind: 'polygon', method: 'walk' });
  });

  it('A 页签自交：self，不能完成', () => {
    expect(evaluate(draft({ mapRing: BOWTIE }))).toEqual({
      geometry: null,
      problem: 'self',
      areaHa: null,
    });
  });

  it('C 页签：没有点 → no-point；有点没填 → empty；填错 → invalid；≥4 → big', () => {
    const p: LngLat = [101.1, 4.3];
    expect(evaluate(draft({ tab: 'point', declared: '2' })).problem).toBe('no-point');
    expect(evaluate(draft({ tab: 'point', point: p })).problem).toBe('empty');
    expect(evaluate(draft({ tab: 'point', point: p, declared: 'x' })).problem).toBe('invalid');
    expect(evaluate(draft({ tab: 'point', point: p, declared: '4' })).problem).toBe('big');
  });

  it('C 页签：有点且面积 < 4：point 结果，面积是手填值', () => {
    const p: LngLat = [101.1, 4.3];
    const e = evaluate(draft({ tab: 'point', point: p, declared: '2,5' }));
    expect(e.problem).toBeNull();
    expect(e.geometry).toEqual({ kind: 'point', point: p, declaredHa: 2.5 });
    expect(e.areaHa).toBe(2.5);
  });

  it('各页签的输入互不影响', () => {
    const d = draft({
      tab: 'point',
      point: [101, 4],
      declared: '1',
      mapRing: RECT,
      walkRing: BOWTIE,
    });
    expect(evaluate({ ...d, tab: 'map' }).problem).toBeNull();
    expect(evaluate({ ...d, tab: 'walk' }).problem).toBe('self');
    expect(evaluate({ ...d, tab: 'point' }).problem).toBeNull();
  });
});

describe('toGeoJsonPolygon', () => {
  it('环首尾闭合，坐标保留 6 位小数，[经度, 纬度]', () => {
    const g = toGeoJsonPolygon([
      [101.12345678, 4.98765432],
      [101.2, 4.9],
      [101.2, 5],
    ]);
    expect(g.type).toBe('Polygon');
    const ring = g.coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual([101.123457, 4.987654]);
    expect(ring[3]).toEqual(ring[0]);
  });
});
