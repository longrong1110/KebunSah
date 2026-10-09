// 独立校验 seed/data/ 是否自洽、是否符合 contract/schema.sql 与企划书 §8.10：node seed/validate.mjs
// 刻意不引用 src/ 下的规则、几何、相似度实现：规则和面积在这里重新写了一遍，
// 枚举值直接从 contract/schema.sql 的 CHECK 约束里解析，阈值读输出里的 config/ruleParams。
// 有任何一条不满足就非零退出。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// SEED_DATA_DIR 只给测试用：指向一份被故意改坏的副本，确认校验器真的会报错
const dataDir = process.env.SEED_DATA_DIR ?? join(here, 'data');
const schemaSql = readFileSync(join(here, '..', 'contract', 'schema.sql'), 'utf8');

const errors = [];
const groups = new Map();
let current = '';
const section = (name) => { current = name; if (!groups.has(name)) groups.set(name, 0); };
const check = (cond, msg) => {
  if (!cond) {
    errors.push(`[${current}] ${msg}`);
    groups.set(current, groups.get(current) + 1);
  }
  return Boolean(cond);
};

// ---------------- 读取 ----------------
const raw = {};
for (const f of readdirSync(dataDir)) {
  if (f.endsWith('.json')) raw[f.replace('.json', '')] = readFileSync(join(dataDir, f), 'utf8');
}
const manifest = JSON.parse(raw._manifest);
const col = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== '_manifest').map(([k, v]) => [k, JSON.parse(v)]));
const byPath = new Map();
for (const list of Object.values(col)) for (const d of list) byPath.set(d.path, d.data);
const idOf = (path) => path.split('/').pop();
const ASOF = manifest.asOf;

const persons = new Map(col.persons.map((d) => [idOf(d.path), d.data]));
const titles = new Map(col.titles.map((d) => [idOf(d.path), d.data]));
const licences = new Map(col.mpobLicences.map((d) => [idOf(d.path), d.data]));
const certs = new Map(col.mspoCertificates.map((d) => [idOf(d.path), d.data]));
const users = new Map(col.users.map((d) => [idOf(d.path), d.data]));
const plots = col.plots.map((d) => ({ id: idOf(d.path), ...d.data }));
const docsByPlot = new Map();
for (const d of col.documents) {
  const pid = d.data.plotId;
  if (!docsByPlot.has(pid)) docsByPlot.set(pid, []);
  docsByPlot.get(pid).push({ id: idOf(d.path), path: d.path, ...d.data });
}
const assessByPlot = new Map();
for (const d of col.assessments) {
  const pid = d.data.plotId;
  if (!assessByPlot.has(pid)) assessByPlot.set(pid, []);
  assessByPlot.get(pid).push({ id: idOf(d.path), ...d.data });
}
const DEMO_PLOTS = ['90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003'];

// ---------------- 前置：引用必须先存在，否则后面的检查会在悬空引用上崩溃 ----------------
section('AC-14 引用存在性（前置）');
for (const p of plots) {
  check(persons.has(p.operatorPersonId), `${p.id} 的 operatorPersonId 引用不存在：${p.operatorPersonId}`);
  check(byPath.has(`cooperatives/${p.coopId}`), `${p.id} 的 coopId 引用不存在：${p.coopId}`);
  check(titles.has(p.landTitleId), `${p.id} 的 landTitleId 引用不存在：${p.landTitleId}`);
  check(p.mpobLicenceId === null || licences.has(p.mpobLicenceId), `${p.id} 的 mpobLicenceId 引用不存在：${p.mpobLicenceId}`);
  check(p.mspoMemberId === null || byPath.has(`mspoCertificates/${p.mspoCertificateId}/members/${p.mspoMemberId}`), `${p.id} 的 mspo 成员引用不存在`);
}
if (errors.length) finish(); // 引用有问题就不往下走，直接报告

// ---------------- 从 schema.sql 解析枚举 ----------------
const enums = {};
for (const m of schemaSql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
  enums[m[1]] = {};
  for (const c of m[2].matchAll(/^\s*(\w+) [^\n]*?CHECK \(\1 IN \(([^)]*)\)\)/gm)) {
    enums[m[1]][c[1]] = c[2].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  }
}
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const TABLE_OF = {
  persons: 'persons', cooperatives: 'cooperatives', users: 'users', titles: 'land_titles', mpobLicences: 'mpob_licences',
  mspoCertificates: 'mspo_certificates', plots: 'plots', documents: 'documents', assessments: 'assessments',
};

// ---------------- 几何：另一种算法（局部等距投影 + 鞋带公式） ----------------
const R = 6378137;
const rad = (d) => (d * Math.PI) / 180;
function areaHaProjected(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const lng0 = ring[0][0];
  const pts = ring.map(([lng, lat]) => [R * rad(lng - lng0) * Math.cos(rad(lat0)), R * rad(lat - ring[0][1])]);
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return Math.abs(s / 2) / 10000;
}
const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
function segHit(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const within = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (o1 === 0 && within(a, b, c)) || (o2 === 0 && within(a, b, d)) || (o3 === 0 && within(c, d, a)) || (o4 === 0 && within(c, d, b));
}
const hasSelfIntersection = (ring) => {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segHit(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
  }
  return false;
};
const inside = (pt, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const box = (ring) => ({ x0: Math.min(...ring.map((p) => p[0])), x1: Math.max(...ring.map((p) => p[0])), y0: Math.min(...ring.map((p) => p[1])), y1: Math.max(...ring.map((p) => p[1])) });
const decimals = (x) => { const s = String(x); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

// ---------------- 规则：重新实现 ----------------
const params = (code, key) => byPath.get('config/ruleParams')[code][key].value;
const tolPct = params('CC-01', 'area_tolerance_pct'), tolMin = params('CC-01', 'area_tolerance_min_ha'), failPct = params('CC-01', 'area_fail_over_pct');
const warnDays = params('CC-02', 'expiry_warn_days'), nameMin = params('CC-03', 'name_similarity_min'), confMin = params('EXTRACT', 'confidence_min');
const pointMax = params('PLOT', 'point_max_ha');

const unitHa = (v, u) => Math.round({ ha: v, sqm: v / 10000, acre: v * 0.40468564224, sqft: (v * 0.09290304) / 10000 }[u] * 1e4) / 1e4;
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const sim = (a, b) => {
  const x = a.toUpperCase().replace(/\s+/g, ' ').trim(), y = b.toUpperCase().replace(/\s+/g, ' ').trim();
  return 1 - lev(x, y) / Math.max(x.length, y.length, 1);
};
const lowUnconfirmed = (f) => Boolean(f) && f.confirmedValue == null && Math.round(f.confidence * 100) < Math.round(confMin * 100);

// ====================================================================================
section('AC-1 数量与比例');
check(plots.length === 200, `plots 应为 200，实际 ${plots.length}`);
const statusCount = { green: 0, yellow: 0, red: 0, needs_review: 0, pending: 0 };
for (const p of plots) statusCount[p.status] = (statusCount[p.status] ?? 0) + 1;
check(statusCount.green === 110 && statusCount.yellow === 50 && statusCount.red === 24 && statusCount.needs_review === 16 && statusCount.pending === 0,
  `状态计数不对：${JSON.stringify(statusCount)}`);

section('AC-2 演示地块与 schema.sql 一致');
{
  const expect = [
    { nick: 'Kebun Utama', status: 'green', area: 4.23, titleNo: 'GRN 51234', areaValue: 4.2, licence: '810200000011', until: '2027-03-31' },
    { nick: 'Kebun Belakang', status: 'yellow', area: 3.49, titleNo: 'HSM 2217/91', areaValue: 3.04, licence: '810200000022', until: '2026-12-05' },
    { nick: 'Kebun Arwah Ayah', status: 'red', area: 3.4, titleNo: 'GRN 30977', areaValue: 2, licence: '810200000033', until: '2026-04-30' },
  ];
  DEMO_PLOTS.forEach((id, i) => {
    const p = plots.find((x) => x.id === id);
    if (!check(p, `缺演示地块 ${id}`)) return;
    const e = expect[i];
    const t = titles.get(p.landTitleId), l = licences.get(p.mpobLicenceId);
    check(p.nickname === e.nick && p.status === e.status && p.areaHaComputed === e.area, `演示地块 ${i + 1} 的基本字段与 schema.sql 不符`);
    check(t.titleNo === e.titleNo && t.areaValue === e.areaValue, `演示地块 ${i + 1} 的地契与 schema.sql 不符`);
    check(l.licenceNo === e.licence && l.validUntil === e.until, `演示地块 ${i + 1} 的执照与 schema.sql 不符`);
    // schema.sql 里这几个值必须真的写着，防止期望值抄错
    for (const s of [e.nick, e.titleNo, e.licence, e.until]) check(schemaSql.includes(s), `schema.sql 里找不到 ${s}`);
  });
  const yellowGaps = byPath.get(`plots/${DEMO_PLOTS[1]}/assessments/70000000-0000-4000-8000-000000000002`).gaps.map((g) => g.gapCode).join();
  const redGaps = byPath.get(`plots/${DEMO_PLOTS[2]}/assessments/70000000-0000-4000-8000-000000000003`).gaps.map((g) => g.gapCode).join();
  check(yellowGaps === 'area_mismatch,expiring', `演示黄块缺口不对：${yellowGaps}`);
  check(redGaps === 'expired,name_mismatch,area_mismatch,not_in_mspo', `演示红块缺口不对：${redGaps}`);
  const yd = (docsByPlot.get(DEMO_PLOTS[1]) ?? []).filter((d) => d.storagePath.startsWith('seed/p2/'));
  check(yd.length === 3 && yd.reduce((s, d) => s + Object.keys(d.fields).length, 0) === 6, '演示黄块原有的 3 个文件与 6 个字段应原样保留');
}

section('AC-4 isSynthetic');
for (const [name, list] of Object.entries(col)) {
  if (name === 'config') continue;
  const bad = list.filter((d) => d.data.isSynthetic !== true);
  check(bad.length === 0, `${name} 里有 ${bad.length} 个文档缺 isSynthetic: true`);
}

section('AC-6 枚举值（取自 schema.sql）');
for (const [name, list] of Object.entries(col)) {
  const table = TABLE_OF[name];
  if (!table) continue;
  for (const d of list) {
    for (const [k, v] of Object.entries(d.data)) {
      const allowed = enums[table]?.[snake(k)];
      if (allowed && v !== null) check(allowed.includes(v), `${d.path}.${k} = ${v} 不在 ${allowed.join('/')}`);
    }
    for (const r of d.data.ruleResults ?? []) {
      check(enums.rule_results.result.includes(r.result), `${d.path} ruleResults.result = ${r.result}`);
      check(/^CC-[0-9]{2}$/.test(r.ruleCode), `${d.path} ruleCode = ${r.ruleCode}`);
    }
    for (const g of d.data.gaps ?? []) {
      check(enums.gaps.severity.includes(g.severity), `${d.path} gap.severity = ${g.severity}`);
      check(g.docType === null || enums.gaps.doc_type.includes(g.docType), `${d.path} gap.docType = ${g.docType}`);
      check(enums.gaps.status.includes(g.status), `${d.path} gap.status = ${g.status}`);
    }
    for (const f of Object.keys(d.data.fields ?? {})) {
      void f;
    }
  }
}
// status.md 的状态值
check(['pending', 'green', 'yellow', 'red', 'needs_review'].every((s) => enums.plots.status.includes(s)), 'schema 的 plots.status 与 status.md 不一致');

section('AC-7 地契');
for (const [id, t] of titles) {
  check(unitHa(t.areaValue, t.areaUnit) === t.areaHa, `${id} areaHa ${t.areaHa} ≠ 换算 ${unitHa(t.areaValue, t.areaUnit)}`);
  check(t.tenure !== 'freehold' || t.leaseExpiry === null, `${id} freehold 却有 leaseExpiry`);
  check(Boolean(t.titleNo) && Boolean(t.lotNo), `${id} titleNo／lotNo 为空`);
  check(t.proprietors.length >= 1, `${id} 没有持有人`);
}
{
  const units = {};
  for (const t of titles.values()) units[t.areaUnit] = (units[t.areaUnit] ?? 0) + 1;
  check(units.ha >= 140 && units.acre >= 10 && units.sqm >= 5, `面积单位分布不对：${JSON.stringify(units)}`);
}

section('AC-8/9 地块几何');
const rings = [];
for (const p of plots) {
  const t = titles.get(p.landTitleId);
  const demo = DEMO_PLOTS.includes(p.id);
  if (p.geometryType === 'polygon') {
    check(p.polygonGeojson && p.areaHaComputed > 0, `${p.id} polygon 缺 polygonGeojson／areaHaComputed`);
    if (!check(typeof p.polygonGeojson === 'string', `${p.id} polygonGeojson 应是 JSON 字符串（Firestore 不允许数组套数组）`)) continue;
    let g;
    try { g = JSON.parse(p.polygonGeojson); } catch { check(false, `${p.id} polygonGeojson 不是合法 JSON`); continue; }
    const ring = g.coordinates[0];
    check(g.type === 'Polygon' && g.coordinates.length === 1, `${p.id} 不是单环 Polygon`);
    check(ring.length >= 4 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1], `${p.id} 环未闭合或点太少`);
    check(ring.every(([lng, lat]) => lng > 100 && lng < 102 && lat > 3 && lat < 6), `${p.id} 坐标不像 [经度, 纬度] 或不在 Perak`);
    check(ring.every((pt) => decimals(pt[0]) <= 6 && decimals(pt[1]) <= 6), `${p.id} 坐标超过 6 位小数`);
    check(!hasSelfIntersection(ring), `${p.id} 多边形自交`);
    const tol = demo ? 0.05 : 0.01; // 演示地块原样来自 schema.sql，与球面实算相差约 0.03 公顷
    const a = areaHaProjected(ring);
    check(Math.abs(a - p.areaHaComputed) <= tol, `${p.id} areaHaComputed ${p.areaHaComputed} 与实算 ${a.toFixed(4)} 相差超过 ${tol}`);
    check(inside([p.centroidLng, p.centroidLat], ring), `${p.id} 质心不在多边形内`);
    check(p.areaHaDeclared === null, `${p.id} polygon 不应有 areaHaDeclared`);
    rings.push({ id: p.id, ring, b: box(ring) });
  } else {
    check(p.geometryType === 'point', `${p.id} geometryType = ${p.geometryType}`);
    check(p.centroidLat !== null && p.centroidLng !== null && p.areaHaDeclared > 0 && p.areaHaDeclared < pointMax, `${p.id} point 缺质心／手填面积，或手填面积 ≥ ${pointMax}`);
    check(p.polygonGeojson === null && p.areaHaComputed === null, `${p.id} point 不应有多边形`);
    check(decimals(p.centroidLat) <= 6 && decimals(p.centroidLng) <= 6, `${p.id} 坐标超过 6 位小数`);
  }
  const plotHa = p.areaHaComputed ?? p.areaHaDeclared;
  check(plotHa < pointMax ? true : p.geometryType === 'polygon', `${p.id} 面积 ≥ ${pointMax} 公顷却不是 polygon`);
  check(titles.get(p.landTitleId).areaHa < pointMax || p.geometryType === 'polygon', `${p.id} 地契 ≥ ${pointMax} 公顷却是 point`);
  check(p.centroidLat > 3.6 && p.centroidLat < 5.9 && p.centroidLng > 100 && p.centroidLng < 101.9, `${p.id} 质心不在 Perak 范围`);
  void t;
}
{
  let overlaps = 0;
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
    const a = rings[i].b, b = rings[j].b;
    if (a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0) continue; // 包围盒不相交就不会重叠
    let hit = inside(rings[i].ring[0], rings[j].ring) || inside(rings[j].ring[0], rings[i].ring);
    for (let x = 0; !hit && x < rings[i].ring.length - 1; x++) for (let y = 0; !hit && y < rings[j].ring.length - 1; y++) {
      hit = segHit(rings[i].ring[x], rings[i].ring[x + 1], rings[j].ring[y], rings[j].ring[y + 1]);
    }
    if (hit) { overlaps++; check(false, `多边形重叠：${rings[i].id} 与 ${rings[j].id}`); }
  }
  void overlaps;
  const pts = plots.filter((p) => p.geometryType === 'point').length;
  check(pts >= 20 && plots.filter((p) => p.geometryType === 'polygon').length >= 150, `point 数 ${pts} 太少或 polygon 太少`);
}

section('AC-10 文件与字段');
{
  const IC_MASK = /^\*{6}-\*{2}-\d{4}$/;
  for (const [pid, list] of docsByPlot) {
    const seen = new Set();
    for (const d of list) {
      const key = `${d.docType}#${d.pageNo}`;
      if (d.isCurrent) { check(!seen.has(key), `${pid} 重复的当前文件 ${key}`); seen.add(key); }
      check(d.storagePath.startsWith('seed/') && d.source === 'seed' && d.sha256 === null, `${d.path} storagePath／source／sha256 不对`);
      for (const [k, f] of Object.entries(d.fields)) {
        check(/^(land_title|mpob_licence|mspo_cert|mspo_member_list)\.[a-z0-9_]+$/.test(k), `${d.path} 字段键不规范：${k}`);
        check(typeof f.rawText === 'string' && typeof f.normalizedValue === 'string', `${d.path}.${k} 缺 rawText／normalizedValue`);
        check(typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1 && decimals(f.confidence) <= 2, `${d.path}.${k} confidence 不合法`);
        if (/_ic$/.test(k)) check(IC_MASK.test(f.rawText) && /^\d{4}$/.test(f.normalizedValue), `${d.path}.${k} 身份证未打码`);
      }
    }
  }
  check(plots.every((p) => (docsByPlot.get(p.id) ?? []).some((d) => d.docType === 'land_title')), '每个地块都应有地契文件');
  check(col.documents.length >= 800, `文件数 ${col.documents.length} 偏少`);
}

section('AC-11/12/13 评估自洽（独立重算）');
const stat = { cc01: { pass: 0, warn: 0, fail: 0, needs_review: 0 }, cc02: { pass: 0, warn: 0, fail: 0, needs_review: 0 }, cc03: { pass: 0, warn: 0, fail: 0, needs_review: 0 }, missingLicence: 0, notInMspo: 0, floor: 0, conf70: 0, corrected: 0, lowUnconfirmed: 0, multi: 0, variant: 0, sims: [] };
for (const p of plots) {
  const as = assessByPlot.get(p.id) ?? [];
  if (!check(as.length === 1, `${p.id} 应恰有 1 条评估，实际 ${as.length}`)) continue;
  const a = as[0];
  check(a.runStatus === 'done' && a.result === p.status, `${p.id} 评估 ${a.runStatus}/${a.result} 与 plots.status ${p.status} 不符`);
  check(p.lastAssessedAt === a.finishedAt, `${p.id} lastAssessedAt ≠ finishedAt`);
  const docs = docsByPlot.get(p.id) ?? [];
  const capt = docs.map((d) => d.capturedAt).filter(Boolean);
  check(capt.every((c) => c <= p.geometryRecordedAt) && p.geometryRecordedAt <= a.startedAt && a.startedAt <= a.finishedAt && a.finishedAt < `${ASOF}T23:59:59Z`, `${p.id} 时间先后不对`);
  check(new Set(a.ruleResults.map((r) => r.ruleCode)).size === a.ruleResults.length && a.ruleResults.map((r) => r.ruleCode).sort().join() === 'CC-01,CC-02,CC-03', `${p.id} ruleCode 不是唯一的 CC-01/02/03`);

  const t = titles.get(p.landTitleId), op = persons.get(p.operatorPersonId);
  const l = p.mpobLicenceId ? licences.get(p.mpobLicenceId) : null;
  const cert = p.mspoCertificateId ? certs.get(p.mspoCertificateId) : null;
  const member = p.mspoMemberId ? byPath.get(`mspoCertificates/${p.mspoCertificateId}/members/${p.mspoMemberId}`) : null;
  const field = (docType, pageNo, key) => docs.find((d) => d.docType === docType && d.pageNo === pageNo)?.fields[key];

  // CC-01（万分位整数）
  const T = Math.round(t.areaHa * 1e4), PL = Math.round((p.areaHaComputed ?? p.areaHaDeclared) * 1e4), over = PL - T;
  const tol = Math.max((T * tolPct) / 100, tolMin * 1e4);
  let e1 = 'pass';
  if (over * 100 > T * failPct) e1 = 'fail'; else if (over > tol) e1 = 'warn';
  // CC-02
  let e2, days2 = null;
  if (!l) { e2 = 'warn'; stat.missingLicence++; } else {
    const ds = [l.validUntil, t.leaseExpiry, cert && member ? cert.expiryDate : null].filter(Boolean).map((d) => dayDiff(ASOF, d));
    days2 = Math.min(...ds);
    e2 = days2 < 0 ? 'fail' : days2 < warnDays ? 'warn' : 'pass';
  }
  // CC-03
  const names = t.proprietors.map((x) => x.nameAsPrinted);
  const parts = [Math.max(...names.map((n) => sim(op.fullName, n)))];
  if (l) parts.push(sim(op.fullName, l.holderName));
  if (member) parts.push(sim(op.fullName, member.memberName));
  const minSim = Math.min(...parts);
  const e3 = minSim >= nameMin ? 'pass' : 'fail';
  // 置信度
  const opProp = t.proprietors.find((x) => x.personId === p.operatorPersonId) ?? t.proprietors[0];
  const fArea = field('land_title', 1, 'land_title.area_value');
  const fUntil = l ? field('mpob_licence', 1, 'mpob_licence.valid_until') : null;
  const fName = field('land_title', 2, `land_title.proprietor_${opProp.seq}_name`);
  const exp = [lowUnconfirmed(fArea) ? 'needs_review' : e1, lowUnconfirmed(fUntil) ? 'needs_review' : e2, lowUnconfirmed(fName) ? 'needs_review' : e3];
  ['CC-01', 'CC-02', 'CC-03'].forEach((code, i) => {
    const got = a.ruleResults.find((r) => r.ruleCode === code)?.result;
    check(got === exp[i], `${p.id} ${code} 存的是 ${got}，独立重算是 ${exp[i]}`);
    stat[`cc0${i + 1}`][exp[i]]++;
  });

  // 缺口
  const notIn = !member;
  if (notIn) stat.notInMspo++;
  const codes = a.gaps.map((g) => g.gapCode);
  check(codes.includes('not_in_mspo') === notIn, `${p.id} not_in_mspo 缺口与名单情况不符`);
  const nonPass = exp.filter((r) => r !== 'pass').length;
  check(a.gaps.length >= nonPass + (notIn ? 1 : 0), `${p.id} 缺口数 ${a.gaps.length} 少于非通过规则数`);
  if (p.status === 'green') check(a.gaps.length === 0, `${p.id} green 却有缺口`);
  check(a.gaps.every((g) => g.status === 'open'), `${p.id} 缺口应为 open`);
  // 聚合
  const agg = exp.includes('fail') ? 'red' : exp.includes('needs_review') ? 'needs_review' : exp.includes('warn') || a.gaps.some((g) => g.status === 'open') ? 'yellow' : 'green';
  check(agg === p.status, `${p.id} 独立聚合得 ${agg}，plots.status 是 ${p.status}`);

  // 安全带（演示地块是 schema.sql 原值，不要求）
  if (!DEMO_PLOTS.includes(p.id)) {
    const pct = (over / T) * 100;
    if (e1 === 'warn') check(pct >= 12 && pct <= 48 && over / 1e4 - tol / 1e4 >= 0.02, `${p.id} CC-01 warn 离阈值太近（${pct.toFixed(1)}%）`);
    if (e1 === 'fail') check(pct >= 55, `${p.id} CC-01 fail 离 50% 太近（${pct.toFixed(1)}%）`);
    if (e1 === 'pass') {
      check(Math.abs(pct) <= 7 || (pct > 10.5 && over / 1e4 <= 0.095), `${p.id} CC-01 pass 离阈值太近（${pct.toFixed(1)}%）`);
      if (pct > 10.5) stat.floor++;
    }
    if (days2 !== null && !fUntil?.confirmedValue) check(![89, 90, 91].includes(days2) && Math.abs(days2) > 5, `${p.id} CC-02 天数 ${days2} 太贴近阈值`);
    check(minSim >= 0.9 || minSim <= 0.6, `${p.id} CC-03 相似度 ${minSim.toFixed(2)} 落在 (0.60, 0.90) 之间`);
  }
  stat.sims.push(minSim);
  for (const f of [fArea, fUntil, fName]) {
    if (f && f.confidence === 0.7 && f.confirmedValue == null) stat.conf70++;
    if (f && f.confirmedValue != null && Math.round(f.confidence * 100) < 70) stat.corrected++;
    if (lowUnconfirmed(f)) stat.lowUnconfirmed++;
  }
  if (t.proprietors.length > 1) {
    stat.multi++;
    const share = t.proprietors.map((x) => x.shareText.split('/').map(Number)).reduce((s, [n, d]) => s + n / d, 0);
    check(Math.abs(share - 1) < 1e-9, `${p.id} 共有份额合计 ${share} ≠ 1`);
  }
  // 拼写差异：园主本人在地契／执照／名单上的写法与 persons 里不同，但仍判同一人
  const opProp2 = t.proprietors.find((x) => x.personId === p.operatorPersonId);
  if (!DEMO_PLOTS.includes(p.id) && e3 === 'pass' && ((opProp2 && opProp2.nameAsPrinted !== op.fullName) || (l && l.holderName !== op.fullName) || (member && member.memberName !== op.fullName))) stat.variant++;
  if (p.status === 'needs_review') {
    check(exp.filter((r) => r === 'needs_review').length === 1 && exp.filter((r) => r === 'pass').length === 2, `${p.id} needs_review 应只有一条规则读不准`);
    check(docs.some((d) => d.extractionStatus === 'needs_review'), `${p.id} needs_review 地块应有 extractionStatus = needs_review 的文件`);
  }
}

section('AC-13/16 场景覆盖');
{
  const red = plots.filter((p) => p.status === 'red');
  check(stat.cc03.fail === 16, `CC-03 fail 应为 16（已故父亲名下），实际 ${stat.cc03.fail}`);
  check(red.length === 24 && stat.cc02.fail === 5 && stat.cc01.fail === 5, `red 的构成不对：CC-02 fail ${stat.cc02.fail}，CC-01 fail ${stat.cc01.fail}`);
  check(stat.cc01.warn >= 20 && stat.cc02.warn >= 23 && stat.missingLicence === 5, `yellow 构成不足：CC-01 warn ${stat.cc01.warn}，CC-02 warn ${stat.cc02.warn}，缺执照 ${stat.missingLicence}`);
  check(stat.notInMspo >= 12, `不在 MSPO 名单的地块只有 ${stat.notInMspo}`);
  check(stat.cc01.needs_review + stat.cc02.needs_review + stat.cc03.needs_review === 16, '需人工复核的规则结果应共 16 条');
  check(stat.floor >= 3, `缺"小于 1 公顷、超出 >10% 却仍在 0.1 公顷容差内"的样本（${stat.floor}）`);
  check(stat.conf70 >= 1, '缺置信度恰好 0.70 的样本');
  check(stat.corrected >= 4, `缺"AI 读错、用户已改"的样本（${stat.corrected}）`);
  check(stat.multi >= 10, `多持有人地契太少（${stat.multi}）`);
  check(stat.variant >= 8, `姓名拼写差异样本太少（${stat.variant}）`);
  const diffs = plots.map((p) => { const t = titles.get(p.landTitleId); const x = (p.areaHaComputed ?? p.areaHaDeclared); return ((x - t.areaHa) / t.areaHa) * 100; });
  const within5 = diffs.filter((d) => Math.abs(d) <= 5).length;
  check(within5 >= 120, `面积差在 ±5% 以内的只有 ${within5} 个，应占大多数`);
  const longText = col.assessments.some((a) => a.data.summaryText.length > 160 || a.data.gaps.some((g) => g.suggestedAction.length > 160));
  check(longText, '缺少长文案样本（summaryText 或 suggestedAction > 160 字符）');
  const expiring = plots.map((p) => licences.get(p.mpobLicenceId)).filter(Boolean).filter((l) => dayDiff(ASOF, l.validUntil) >= 90).length;
  check(expiring >= 150, `距到期 ≥ 90 天的执照只有 ${expiring}，应占大多数`);
}

section('AC-14 引用完整');
{
  const seen = { title: new Set(), licence: new Set(), person: new Set() };
  for (const p of plots) {
    check(persons.has(p.operatorPersonId) && byPath.has(`cooperatives/${p.coopId}`) && titles.has(p.landTitleId), `${p.id} 的 operator／coop／title 引用不存在`);
    check(p.mpobLicenceId === null || licences.has(p.mpobLicenceId), `${p.id} 的 mpobLicenceId 不存在`);
    check((p.mspoMemberId === null) === (p.mspoCertificateId === null), `${p.id} mspoMemberId 与 mspoCertificateId 要么都有要么都没有`);
    if (p.mspoMemberId) {
      const m = byPath.get(`mspoCertificates/${p.mspoCertificateId}/members/${p.mspoMemberId}`);
      if (check(m, `${p.id} 的 mspo 成员不存在`)) {
        check(m.landTitleId === p.landTitleId && m.personId === p.operatorPersonId, `${p.id} 成员的 landTitleId／personId 与地块不符`);
        const l = p.mpobLicenceId ? licences.get(p.mpobLicenceId) : null;
        check(m.mpobLicenceNo === (l ? l.licenceNo : null), `${p.id} 成员的 mpobLicenceNo 与执照不符`);
      }
    }
    const t = titles.get(p.landTitleId);
    check(p.state === t.state && p.district === t.district && p.titleNo === t.titleNo, `${p.id} 复制的 state／district／titleNo 与地契不一致`);
    for (const [set, v] of [['title', p.landTitleId], ['person', p.operatorPersonId], ['licence', p.mpobLicenceId]]) {
      if (v === null) continue;
      check(!seen[set].has(v), `${set} ${v} 被多个地块共用`);
      seen[set].add(v);
    }
    for (const pr of t.proprietors) check(pr.personId === null || persons.has(pr.personId), `${p.id} 持有人 personId 不存在`);
    const ls = p.mpobLicenceId ? licences.get(p.mpobLicenceId) : null;
    check(!ls || persons.has(ls.holderPersonId), `${p.id} 执照 holderPersonId 不存在`);
  }
  for (const d of col.documents) {
    check(d.data.uploadedBy === null || users.has(d.data.uploadedBy), `${d.path} uploadedBy 不存在`);
    for (const f of Object.values(d.data.fields)) check(!f.confirmedBy || users.has(f.confirmedBy), `${d.path} confirmedBy 不存在`);
  }
  for (const m of [...titles.values(), ...licences.values()]) {
    check(m.sourceDocumentPath === null || byPath.has(m.sourceDocumentPath), `sourceDocumentPath 指向不存在的文件：${m.sourceDocumentPath}`);
  }
  for (const a of col.assessments) {
    for (const r of a.data.ruleResults) for (const ev of r.evidence ?? []) {
      check(byPath.has(`plots/${a.data.plotId}/documents/${ev.documentId}`), `${a.path} 证据指向不存在的文件`);
    }
  }
}

section('AC-15 MSPO');
{
  const membersByCert = new Map();
  for (const m of col.mspoMembers) {
    const cid = m.data.certificateId;
    check(m.path.startsWith(`mspoCertificates/${cid}/members/`), `${m.path} 路径与 certificateId 不一致`);
    if (!membersByCert.has(cid)) membersByCert.set(cid, []);
    membersByCert.get(cid).push(m.data);
  }
  const nos = new Set();
  check(certs.size >= 4 && certs.size <= 5, `证书数 ${certs.size} 应为 4–5（演示 1 + 新增 3–4）`);
  for (const [cid, c] of certs) {
    const ms = membersByCert.get(cid) ?? [];
    check(/^MSPO \d{6}$/.test(c.certNo) && !nos.has(c.certNo), `${cid} certNo 不合格或重复`);
    nos.add(c.certNo);
    check(c.membersCount === ms.length, `${cid} membersCount ${c.membersCount} ≠ 成员数 ${ms.length}`);
    check(Number(c.certificationUnit.match(/\((\d+) members\)/)?.[1]) === ms.length, `${cid} certificationUnit 里的成员数不对`);
    check(ms.map((m) => m.memberNo).sort((a, b) => a - b).every((n, i) => n === i + 1), `${cid} memberNo 不连续`);
    check(c.expiryDate > c.startDate && c.firstCertifiedDate <= c.startDate, `${cid} 日期先后不对`);
    const s = new Date(`${c.startDate}T00:00:00Z`); s.setUTCFullYear(s.getUTCFullYear() + 5); s.setUTCDate(s.getUTCDate() - 1);
    check(s.toISOString().slice(0, 10) === c.expiryDate, `${cid} 周期不是 5 年`);
    check(dayDiff(ASOF, c.expiryDate) >= 365, `${cid} 到期日离基准日不足一年`);
  }
  check((membersByCert.get('e0000000-0000-4000-8000-000000000001') ?? []).length === 2, '演示证书应仍只含 2 个成员');
}

section('AC-17 users');
{
  const want = { 'demo-officer-1': 'field_officer', 'demo-admin-1': 'coop_admin', 'demo-smallholder-1': 'smallholder', 'demo-smallholder-2': 'smallholder', 'demo-smallholder-3': 'smallholder' };
  check(users.size === 5, `users 应为 5 个，实际 ${users.size}`);
  const phones = new Set();
  for (const [uid, u] of users) {
    check(want[uid] === u.role, `${uid} 角色不对`);
    check(/^\+[0-9]{8,15}$/.test(u.phone) && !phones.has(u.phone), `${uid} 手机号不合格或重复`);
    phones.add(u.phone);
    check(uid.startsWith('demo-smallholder') ? persons.has(u.personId) : u.personId === null, `${uid} personId 不对`);
  }
}

section('AC-18 身份证');
{
  const hashes = new Set();
  const all = [...persons.values()].map((p) => p.icHash);
  check(new Set(all).size === all.length && all.every((h) => /^[0-9a-f]{64}$/.test(h)), 'persons.icHash 要唯一且是 64 位十六进制');
  check([...persons.values()].every((p) => /^\d{4}$/.test(p.icLast4)), 'icLast4 要是 4 位数字');
  for (const p of persons.values()) hashes.add(p.icHash);
  for (const t of titles.values()) for (const x of t.proprietors) { hashes.add(x.icHash); check(/^[0-9a-f]{64}$/.test(x.icHash) && /^\d{4}$/.test(x.icLast4), '持有人 icHash／icLast4 格式不对'); }
  for (const l of licences.values()) hashes.add(l.holderIcHash);
  // 泄漏扫描：任何 12 位数字串，只要它的 SHA-256 在哈希集合里，就是明文身份证号
  let leaks = 0;
  for (const [name, text] of Object.entries(raw)) {
    for (const m of text.matchAll(/(?<!\d)\d{12}(?!\d)/g)) {
      if (hashes.has(createHash('sha256').update(m[0]).digest('hex'))) { leaks++; check(false, `${name}.json 里有明文身份证号`); }
    }
    check(!/(?<!\d)\d{6}-\d{2}-\d{4}(?!\d)/.test(text), `${name}.json 里有 YYMMDD-PB-#### 形式的号码`);
  }
  void leaks;
  const tan = persons.get('a0000000-0000-4000-8000-000000000001');
  check(tan.icHash === createHash('sha256').update('720304075117').digest('hex') && tan.icLast4 === '5117', '演示 persons 的哈希与 schema.sql 的 sha256 不一致');
}

section('AC-19 姓名与分布');
{
  const MALAY = /\b(BIN|BINTI)\b/, INDIAN = /\b(A\/L|A\/P)\b/;
  const PERAK = ['Batang Padang', 'Manjung', 'Kinta', 'Kerian', 'Kuala Kangsar', 'Larut, Matang dan Selama', 'Hilir Perak', 'Hulu Perak', 'Perak Tengah', 'Kampar', 'Muallim', 'Bagan Datuk'];
  let m = 0, i = 0, c = 0;
  for (const p of persons.values()) {
    check(p.fullName === p.fullName.toUpperCase(), `姓名不是全大写：${p.fullName}`);
    if (MALAY.test(p.fullName)) m++; else if (INDIAN.test(p.fullName)) i++; else c++;
  }
  check(m > 80 && i > 25 && c > 25, `三种姓名分布不对：马来 ${m} 印度 ${i} 华裔 ${c}`);
  for (const t of titles.values()) check(PERAK.includes(t.district) && t.state === 'Perak', `县名不是 Perak 的真实县：${t.district}`);
  check(new Set([...titles.values()].map((t) => t.district)).size >= 8, '县的分布太集中');
  check(new Set([...persons.values()].map((p) => p.fullName)).size === persons.size, '园主姓名有重复');
}

section('AC-20 Firestore 可写性');
{
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TS = new Set(['createdAt', 'updatedAt', 'lastLoginAt', 'geometryRecordedAt', 'lastAssessedAt', 'capturedAt', 'extractedAt', 'startedAt', 'finishedAt', 'confirmedAt']);
  const DATES = new Set(['validUntil', 'leaseExpiry', 'expiryDate', 'startDate', 'firstCertifiedDate', 'dateFirstAlienation']);
  const walk = (v, p, parentIsArray, key) => {
    if (v === undefined) check(false, `${p} 是 undefined`);
    else if (typeof v === 'number') check(Number.isFinite(v), `${p} 非有限数字`);
    else if (Array.isArray(v)) { check(!parentIsArray, `${p} 数组直接嵌套数组`); v.forEach((x, i) => walk(x, `${p}[${i}]`, true, key)); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { check(k !== '', `${p} 有空键`); walk(x, `${p}.${k}`, false, k); }
    else if (typeof v === 'string' && v !== '') {
      if (TS.has(key)) check(ISO.test(v), `${p} 应是 ISO 时间戳：${v}`);
      if (DATES.has(key)) check(DATE.test(v), `${p} 应是 YYYY-MM-DD：${v}`);
    }
  };
  for (const [name, list] of Object.entries(col)) for (const d of list) {
    walk(d.data, d.path, false, '');
    check(Buffer.byteLength(JSON.stringify(d.data)) < 1024 * 1024, `${d.path} 超过 1 MiB`);
    void name;
  }
  check(plots.every((p) => p.polygonGeojson === null || typeof p.polygonGeojson === 'string'), 'polygonGeojson 应是 JSON 字符串或 null');
  check(raw.plots.indexOf('\r') === -1 && raw.plots.endsWith('}\n]\n'), '输出应使用 LF 换行');
}

finish();

// ---------------- 汇总（函数声明会提升，前置检查失败时可提前调用） ----------------
function finish() {
  console.log('校验结果：');
  for (const [name, n] of groups) console.log(`  ${n === 0 ? '通过' : `失败 ${n}`}  ${name}`);
  if (errors.length) {
    console.error(`\n共 ${errors.length} 处不满足（只列前 40 条）：`);
    for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`\n全部通过：${plots.length} 个地块，${[...byPath.keys()].length} 个文档。`);
}
