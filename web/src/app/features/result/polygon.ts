// 屏 10 的多边形预览：把 plots.polygonGeojson（JSON 字符串，Firestore 不收嵌套数组所以存成字符串）
// 画成一个内联 SVG 的 points。没有地图底图，所以不依赖 Google Maps，也没有 key。

export type Ring = [number, number][];

/** 取 Polygon 的外环 [经度, 纬度][]。不是 Polygon、点数不足、坐标越界或有非数字都返回 null（调用方不显示预览） */
export function parseRing(value: unknown): Ring | null {
  let geo: unknown = value;
  if (typeof value === 'string') {
    try {
      geo = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const g = geo as { type?: unknown; coordinates?: unknown } | null;
  if (!g || g.type !== 'Polygon' || !Array.isArray(g.coordinates)) return null;
  const outer: unknown = g.coordinates[0];
  if (!Array.isArray(outer)) return null;

  const ring: Ring = [];
  for (const p of outer as unknown[]) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const [lng, lat] = p as unknown[];
    if (typeof lng !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    ring.push([lng, lat]);
  }
  // GeoJSON 的环首尾是同一个点：去掉结尾那个重复点
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring.length >= 3 ? ring : null;
}

/**
 * 把环等比例放进 width × height 的画布（四周留 pad）。经度按纬度中值的余弦压缩，形状才不会被拉宽；
 * 北在上。返回 SVG polygon 的 points 字符串，每个点一位小数。
 */
export function toSvgPoints(ring: Ring, width = 240, height = 140, pad = 14): string {
  const lats = ring.map((p) => p[1]);
  const lngs = ring.map((p) => p[0]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const minLng = Math.min(...lngs);
  const maxLat = Math.max(...lats);

  const xs = ring.map((p) => (p[0] - minLng) * k);
  const ys = ring.map((p) => maxLat - p[1]);
  const spanX = Math.max(...xs);
  const spanY = Math.max(...ys);
  const availW = width - 2 * pad;
  const availH = height - 2 * pad;
  // 某一边的跨度为 0（点连成一条线）时只按另一边缩放
  const scale = Math.min(
    spanX > 0 ? availW / spanX : Infinity,
    spanY > 0 ? availH / spanY : Infinity,
  );
  const s = Number.isFinite(scale) ? scale : 1;
  const offsetX = (width - spanX * s) / 2;
  const offsetY = (height - spanY * s) / 2;

  return ring
    .map((_, i) => `${(xs[i] * s + offsetX).toFixed(1)},${(ys[i] * s + offsetY).toFixed(1)}`)
    .join(' ');
}
