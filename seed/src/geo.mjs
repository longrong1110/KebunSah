// 地块几何：造多边形、算面积、检查自交与重叠。
// 面积用球面公式、地球半径 6378137 m，与 Google Maps JavaScript API 的 spherical.computeArea 同一约定，
// 这样将来前端圈出来写进 area_ha_computed 的数，和 seed 里的口径一致。
const R = 6378137;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// ring: [[lng, lat], …]，首尾相同的闭合环
export function ringAreaM2(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    sum += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}

export const ringAreaHa = (ring) => ringAreaM2(ring) / 10000;

export const round6 = (x) => Math.round(x * 1e6) / 1e6;

export function bbox(ring) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

export const bboxOverlap = (a, b) =>
  a.minLng < b.maxLng && a.maxLng > b.minLng && a.minLat < b.maxLat && a.maxLat > b.minLat;

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// 两线段是否相交（含端点接触）
export function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const onSeg = (a, b, c) =>
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  if (d1 === 0 && onSeg(p3, p4, p1)) return true;
  if (d2 === 0 && onSeg(p3, p4, p2)) return true;
  if (d3 === 0 && onSeg(p1, p2, p3)) return true;
  if (d4 === 0 && onSeg(p1, p2, p4)) return true;
  return false;
}

// 环是否自交：任意两条不相邻的边不得相交
export function isSimpleRing(ring) {
  const n = ring.length - 1; // 边数
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  }
  return true;
}

// 射线法
export function pointInRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 两个环是否重叠：边相交，或一个的顶点落在另一个里面
export function ringsOverlap(a, b) {
  if (!bboxOverlap(bbox(a), bbox(b))) return false;
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsIntersect(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return pointInRing(a[0], b) || pointInRing(b[0], a);
}

// 平面质心（小范围内误差可忽略）
export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  a /= 2;
  return [cx / (6 * a), cy / (6 * a)];
}

// 以 (centerLng, centerLat) 为中心造一个不自交的多边形，面积约等于 targetHa。
// 顶点按角度排序、半径恒正，所以对中心是"星形"的，必然不自交。
// 返回的 areaHa 是按取整到 6 位小数后的坐标重新实算的，不是目标值。
export function makePolygon(rng, { centerLat, centerLng, targetHa }) {
  const n = rng.int(4, 7);
  const base = rng.float(0, Math.PI * 2);
  const stretch = rng.float(1, 1.6);
  const local = [];
  for (let i = 0; i < n; i++) {
    const theta = base + (Math.PI * 2 * (i + rng.float(-0.28, 0.28))) / n;
    const r = rng.float(0.8, 1.2);
    local.push([stretch * r * Math.cos(theta), (r * Math.sin(theta)) / stretch]);
  }
  // 平面鞋带公式算单位面积，再缩放到目标面积
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = local[i];
    const [x2, y2] = local[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  const scale = Math.sqrt((targetHa * 10000) / Math.abs(s / 2));
  const cosLat = Math.cos(rad(centerLat));
  const ring = local.map(([x, y]) => [
    round6(centerLng + deg((x * scale) / (R * cosLat))),
    round6(centerLat + deg((y * scale) / R)),
  ]);
  ring.push(ring[0].slice());
  const [clng, clat] = ringCentroid(ring);
  const centroid = pointInRing([clng, clat], ring) ? [round6(clng), round6(clat)] : [round6(centerLng), round6(centerLat)];
  return { ring, areaHa: ringAreaHa(ring), centroid };
}

// 格子分配器：每个地块独占一个正方形格子，互不重叠。
// 从县锚点出发按螺旋顺序找空格；已被占用的包围盒（含演示地块）会被避开。
export function createCellAllocator(step = 0.006) {
  const used = []; // 已占用的包围盒
  const half = step / 2;

  function* spiral() {
    yield [0, 0];
    for (let r = 1; r < 60; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r) yield [dx, dy];
        }
      }
    }
  }

  return {
    reserve(box) {
      used.push(box);
    },
    // 取一个空格子的中心 [lat, lng]
    take([anchorLat, anchorLng]) {
      for (const [dx, dy] of spiral()) {
        const lat = anchorLat + dy * step;
        const lng = anchorLng + dx * step;
        const cell = { minLng: lng - half, maxLng: lng + half, minLat: lat - half, maxLat: lat + half };
        if (used.some((u) => bboxOverlap(u, cell))) continue;
        used.push(cell);
        return { lat, lng, cell };
      }
      throw new Error('找不到空格子');
    },
  };
}
