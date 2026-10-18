import area from '@turf/area';

// 屏 5「圈地块」的纯逻辑：顶点、面积、自交、手填面积、GeoJSON。不碰 DOM、不碰 Google，方便单测。
// 坐标一律是 [经度, 纬度]（与 contract/schema.sql 的 polygon_geojson 一致）；ring 不含闭合点。

export type LngLat = readonly [lng: number, lat: number];
export type Ring = readonly LngLat[];

/** 三种记录方式（对应屏 5 的三个页签） */
export type MapTab = 'map' | 'walk' | 'point';

/** 4 公顷以下才允许只记一个点；4 及以上必须画边界（EUDR，对应合同 rule_params 的 PLOT.point_max_ha） */
export const POINT_MAX_HA = 4;
/** 四舍五入到 2 位小数仍是 0 的面积不当有效（徽标不写「≈ 0 ha」） */
export const MIN_AREA_HA = 0.005;
/** GPS 误差超过这个值（米）就提示改用卫星图 */
export const GPS_WARN_M = 10;

/** 一圈顶点围成的面积（公顷，球面算法）。少于 3 个点是 0。 */
export function ringAreaHa(ring: Ring): number {
  if (ring.length < 3) return 0;
  const pts = ring.map(([lng, lat]) => [lng, lat]);
  const m2 = area({ type: 'Polygon', coordinates: [[...pts, pts[0]]] });
  return m2 / 10000;
}

type Pt = readonly [number, number];

const cross = (o: Pt, a: Pt, b: Pt): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const within = (a: number, b: number, v: number): boolean =>
  v >= Math.min(a, b) && v <= Math.max(a, b);

/** c 与 a、b 共线时，c 是否落在线段 ab 上 */
const onSegment = (a: Pt, b: Pt, c: Pt): boolean =>
  within(a[0], b[0], c[0]) && within(a[1], b[1], c[1]);

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && onSegment(p3, p4, p1)) ||
    (d2 === 0 && onSegment(p3, p4, p2)) ||
    (d3 === 0 && onSegment(p1, p2, p3)) ||
    (d4 === 0 && onSegment(p1, p2, p4))
  );
}

/**
 * 多边形的边是否互相交叉（含首尾相连的那条边）。相邻两条边共用一个端点，不算交叉。
 * 在经纬度平面上判断：地块只有几公顷，平面与球面的差别不会改变交叉与否。
 */
export function selfIntersects(ring: Ring): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // 相邻的两条边（含最后一条与第一条）共用端点，跳过
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(a1, a2, ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

export type RingProblem = 'few' | 'self' | 'tiny';

export interface RingCheck {
  /** 顶点数 */
  count: number;
  /** 有效时的面积（公顷）；无效时 null */
  areaHa: number | null;
  /** 无效的原因；有效时 null */
  problem: RingProblem | null;
}

/** 去掉连续重复的点（含最后一个与第一个相同）：走角点时站着不动按两次会读到同一个位置 */
export function dedupe(ring: Ring): Ring {
  const out = ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
  const last = out[out.length - 1];
  return out.length > 1 && last[0] === out[0][0] && last[1] === out[0][1] ? out.slice(0, -1) : out;
}

/** 少于 3 个（不同的）点、自交、面积太小都不能完成；其余有效（面积没有上限） */
export function checkRing(input: Ring): RingCheck {
  const ring = dedupe(input);
  const count = ring.length;
  if (count < 3) return { count, areaHa: null, problem: 'few' };
  if (selfIntersects(ring)) return { count, areaHa: null, problem: 'self' };
  const ha = ringAreaHa(ring);
  if (!(ha >= MIN_AREA_HA)) return { count, areaHa: null, problem: 'tiny' };
  return { count, areaHa: ha, problem: null };
}

export type Declared =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'big'; ha: number }
  | { kind: 'ok'; ha: number };

/**
 * 「Satu titik」手填的面积（公顷）。接受「2.5」「2,5」「.5」；空、0、负数、非数字、
 * 多个小数点都是无效；四舍五入到 4 位小数；≥4 公顷要改画边界（big）。
 */
export function parseDeclaredHa(text: string): Declared {
  const t = text.trim();
  if (t === '') return { kind: 'empty' };
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return { kind: 'invalid' };
  const ha = Math.round(Number(t.replace(',', '.')) * 10000) / 10000;
  if (!(ha > 0)) return { kind: 'invalid' };
  return ha >= POINT_MAX_HA ? { kind: 'big', ha } : { kind: 'ok', ha };
}

/** 屏 5 保存的结果（中性形状，以后接 API 时再映射成 geometry_type／polygon_geojson／centroid／area_ha_declared） */
export type PlotGeometry =
  | { kind: 'polygon'; method: 'map' | 'walk'; ring: Ring; areaHa: number }
  | { kind: 'point'; point: LngLat; declaredHa: number };

/** 屏 5 各页签的工作状态（页签切换不丢各自的输入） */
export interface GeometryDraft {
  tab: MapTab;
  mapRing: Ring;
  walkRing: Ring;
  point: LngLat | null;
  declared: string;
}

export type GeometryProblem = RingProblem | 'no-point' | 'empty' | 'invalid' | 'big';

export interface Evaluation {
  /** 当前页签可以完成时的结果，否则 null */
  geometry: PlotGeometry | null;
  /** 当前页签不能完成的原因；能完成时 null */
  problem: GeometryProblem | null;
  /** 当前页签的面积（A、B 是计算值，C 是手填值）；没有有效面积时 null */
  areaHa: number | null;
}

/** 当前页签能不能「Selesai」、为什么不能、面积是多少 */
export function evaluate(draft: GeometryDraft): Evaluation {
  if (draft.tab === 'point') {
    if (!draft.point) return { geometry: null, problem: 'no-point', areaHa: null };
    const d = parseDeclaredHa(draft.declared);
    if (d.kind !== 'ok') return { geometry: null, problem: d.kind, areaHa: null };
    return {
      geometry: { kind: 'point', point: draft.point, declaredHa: d.ha },
      problem: null,
      areaHa: d.ha,
    };
  }
  const ring = draft.tab === 'map' ? draft.mapRing : draft.walkRing;
  const check = checkRing(ring);
  if (check.problem || check.areaHa === null) {
    return { geometry: null, problem: check.problem ?? 'tiny', areaHa: null };
  }
  return {
    // 存去掉连续重复点之后的 ring：面积就是按它算的，以后映射成 GeoJSON 也不该带上重复顶点
    geometry: { kind: 'polygon', method: draft.tab, ring: dedupe(ring), areaHa: check.areaHa },
    problem: null,
    areaHa: check.areaHa,
  };
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** GeoJSON Polygon：坐标保留 6 位小数，环首尾闭合 */
export function toGeoJsonPolygon(ring: Ring): { type: 'Polygon'; coordinates: number[][][] } {
  const pts = ring.map(([lng, lat]) => [round6(lng), round6(lat)]);
  return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
}

/**
 * 网址参数 ?at=纬度,经度（如 3.6654,102.95906）→ [经度, 纬度]。测试和演示用的小辅助：打开屏 5 时地图直接飞到那里，
 * 不替用户放点。格式不对、不是有限数、超出经纬度范围都返回 null（当没有这个参数）。
 */
export function parseAt(text: string | null | undefined): LngLat | null {
  if (typeof text !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? [lng, lat]
    : null;
}
