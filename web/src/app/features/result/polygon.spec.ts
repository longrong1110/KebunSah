import { parseRing, toSvgPoints } from './polygon';

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [101.149037, 4.309105],
      [101.150963, 4.309105],
      [101.150963, 4.310895],
      [101.149037, 4.310895],
      [101.149037, 4.309105],
    ],
  ],
};

describe('parseRing', () => {
  it('JSON 字符串或对象都行；去掉首尾重复的闭合点', () => {
    const fromString = parseRing(JSON.stringify(square))!;
    expect(fromString).toHaveLength(4);
    expect(parseRing(square)).toHaveLength(4);
    expect(fromString[0]).toEqual([101.149037, 4.309105]);
  });

  it('没有闭合点也行', () => {
    const open = { type: 'Polygon', coordinates: [square.coordinates[0].slice(0, 4)] };
    expect(parseRing(open)).toHaveLength(4);
  });

  it('不是合法 JSON、不是 Polygon、没有 coordinates：null', () => {
    for (const bad of [
      '',
      'not json',
      '{',
      null,
      undefined,
      42,
      '{"type":"Point","coordinates":[101,4]}',
      '{"type":"Polygon"}',
      '{"type":"Polygon","coordinates":[]}',
      '{"type":"Polygon","coordinates":[1]}',
    ]) {
      expect(parseRing(bad), String(bad)).toBeNull();
    }
  });

  it('点数不足 3 个：null', () => {
    const two = {
      type: 'Polygon',
      coordinates: [
        [
          [101, 4],
          [102, 4],
          [101, 4],
        ],
      ],
    };
    expect(parseRing(two)).toBeNull();
  });

  it('坐标越界、非数字、缺一维：null，不画出奇怪的图', () => {
    const ring = (pts: unknown[]) => ({ type: 'Polygon', coordinates: [pts] });
    expect(
      parseRing(
        ring([
          [101, 4],
          [102, 4],
          [102, 95],
          [101, 4],
        ]),
      ),
    ).toBeNull(); // 纬度 > 90
    expect(
      parseRing(
        ring([
          [181, 4],
          [102, 4],
          [102, 5],
          [181, 4],
        ]),
      ),
    ).toBeNull(); // 经度 > 180
    expect(
      parseRing(
        ring([
          [101, 4],
          [102, 4],
          ['x', 5],
          [101, 4],
        ]),
      ),
    ).toBeNull();
    expect(parseRing(ring([[101, 4], [102, 4], [102], [101, 4]]))).toBeNull();
    expect(
      parseRing(
        ring([
          [101, 4],
          [102, 4],
          [NaN, 5],
          [101, 4],
        ]),
      ),
    ).toBeNull();
  });
});

const parsePoints = (s: string) =>
  s.split(' ').map((p) => p.split(',').map(Number) as [number, number]);

describe('toSvgPoints', () => {
  it('所有点都落在画布内（留边距），点数不变', () => {
    const pts = parsePoints(toSvgPoints(parseRing(square)!, 240, 140, 14));
    expect(pts).toHaveLength(4);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(14 - 0.1);
      expect(x).toBeLessThanOrEqual(240 - 14 + 0.1);
      expect(y).toBeGreaterThanOrEqual(14 - 0.1);
      expect(y).toBeLessThanOrEqual(140 - 14 + 0.1);
    }
  });

  it('北在上：纬度大的点 y 小', () => {
    const pts = parsePoints(toSvgPoints(parseRing(square)!));
    // square 的第 1 点纬度最小，第 3 点纬度最大
    expect(pts[2][1]).toBeLessThan(pts[0][1]);
  });

  it('等比例：经度按纬度余弦压缩，形状不被拉宽', () => {
    // 同样 0.01° 的经度跨度和纬度跨度：在赤道附近长宽近似 1:1，在高纬度宽度被压缩
    const equator = parseRing({
      type: 'Polygon',
      coordinates: [
        [
          [100, 0],
          [100.01, 0],
          [100.01, 0.01],
          [100, 0.01],
          [100, 0],
        ],
      ],
    })!;
    const high = parseRing({
      type: 'Polygon',
      coordinates: [
        [
          [100, 60],
          [100.01, 60],
          [100.01, 60.01],
          [100, 60.01],
          [100, 60],
        ],
      ],
    })!;
    const size = (r: typeof equator) => {
      const pts = parsePoints(toSvgPoints(r, 200, 200, 0));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    };
    expect(size(equator)).toBeCloseTo(1, 1);
    expect(size(high)).toBeCloseTo(0.5, 1); // cos(60°) = 0.5
  });

  it('点连成一条线（某一边跨度为 0）也不崩，不出现 NaN／Infinity', () => {
    const line = parseRing({
      type: 'Polygon',
      coordinates: [
        [
          [101, 4],
          [102, 4],
          [103, 4],
          [101, 4],
        ],
      ],
    })!;
    const out = toSvgPoints(line);
    expect(out).not.toMatch(/NaN|Infinity/);
  });
});
