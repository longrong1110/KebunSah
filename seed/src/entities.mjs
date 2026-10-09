// 按场景造一个地块的"现实世界部分"：园主、地契、持有人、执照、几何。
// 证书／成员名单、文件、评估放在 build.mjs 里，因为它们要等所有地块定了才能造。
import { AS_OF, BAND, DISTRICTS, STATE, LOCALITIES, PLOT_NICKNAMES, EXPRESS_CONDITIONS, RESTRICTIONS, P } from './constants.mjs';
import { addDays, addMinutes, myt, toDmy } from './dates.mjs';
import { toHa, fromHa, round } from './units.mjs';
import { makePolygon, ringAreaHa } from './geo.mjs';
import { makeName, makeIdentity, makeFatherName, makeOtherName, nameVariant, pickEthnic } from './people.mjs';
import { cc01 } from './rules.mjs';

const TITLE_TYPES = [['GRN', 34], ['GM', 14], ['HSD', 10], ['HSM', 16], ['PN', 12], ['PM', 9], ['OTHER', 5]];
const LEASEHOLD = new Set(['PN', 'PM']);

// 地契面积：大多数 1–10 公顷（企划书 §8.10）
function drawTitleHa(rng, scen) {
  if (scen.area === 'pass_floor') return rng.float(0.45, 0.65);
  if (scen.area === 'warn') return rng.float(1.5, 9);
  if (scen.area === 'fail') return rng.float(1.2, 9);
  if (scen.geometry === 'point') return rng.float(0.8, 3.4);
  const [lo, hi] = rng.weighted([[[0.7, 1.0], 4], [[1.0, 4.0], 42], [[4.0, 10.0], 44], [[10.0, 14.0], 10]]);
  return rng.float(lo, hi);
}

// 纸面数字：ha 与 acre 写两位小数，sqm 取整到 10 平方米；再按公式换回公顷，才是规则比的那个数
function printArea(rng, desiredHa) {
  const unit = rng.weighted([['ha', 82], ['acre', 12], ['sqm', 6]]);
  const raw = fromHa(desiredHa, unit);
  const areaValue = unit === 'sqm' ? Math.round(raw / 10) * 10 : round(raw, 2);
  return { areaValue, areaUnit: unit, areaHa: toHa(areaValue, unit) };
}

function targetPlotHa(rng, scen, titleHa) {
  switch (scen.area) {
    case 'pass': return titleHa * (1 + rng.float(-0.05, 0.05));
    case 'pass_floor': return titleHa + rng.float(0.082, 0.092);
    case 'warn': return titleHa * (1 + rng.float(0.18, 0.42));
    case 'fail': return titleHa * (1 + rng.float(0.62, 1.0));
    default: throw new Error(`未知面积场景：${scen.area}`);
  }
}

// 安全带：结果离阈值要有距离，换一种比较写法也不会翻转
function bandOk(scen, titleHa, plotHa) {
  const r = cc01({ titleHa, plotHa });
  const { pct, overHa } = r.meta;
  const tolHa = Math.max(titleHa * (P.areaTolerancePct / 100), P.areaToleranceMinHa);
  switch (scen.area) {
    case 'pass': return r.result === 'pass' && Math.abs(pct) <= 7;
    case 'pass_floor': return r.result === 'pass' && pct > 10.5 && overHa <= 0.095;
    case 'warn': return r.result === 'warn' && pct >= 12 && pct <= 48 && overHa - tolHa >= 0.02;
    case 'fail': return r.result === 'fail' && pct >= 55;
    default: return false;
  }
}

function makeGeometry(rng, scen, titleHa, cellInfo) {
  const { lat, lng } = cellInfo;
  for (let attempt = 0; attempt < 40; attempt++) {
    const target = targetPlotHa(rng, scen, titleHa);
    const jitterLat = lat + rng.float(-0.0003, 0.0003);
    const jitterLng = lng + rng.float(-0.0003, 0.0003);
    if (scen.geometry === 'point') {
      const declared = round(target, 2);
      if (declared >= P.pointMaxHa || !bandOk(scen, titleHa, declared)) continue;
      return {
        geometryType: 'point', centroidLat: round(jitterLat, 6), centroidLng: round(jitterLng, 6),
        polygonGeojson: null, areaHaComputed: null, areaHaDeclared: declared, plotHa: declared, ring: null,
      };
    }
    if (target > 22) continue;
    const poly = makePolygon(rng, { centerLat: jitterLat, centerLng: jitterLng, targetHa: target });
    const areaHaComputed = round(ringAreaHa(poly.ring), 4);
    if (!bandOk(scen, titleHa, areaHaComputed)) continue;
    // 多边形必须装得进自己的格子，才不会压到邻居
    const xs = poly.ring.map((p) => p[0]), ys = poly.ring.map((p) => p[1]);
    const c = cellInfo.cell;
    if (Math.min(...xs) < c.minLng || Math.max(...xs) > c.maxLng || Math.min(...ys) < c.minLat || Math.max(...ys) > c.maxLat) continue;
    return {
      geometryType: 'polygon', centroidLat: poly.centroid[1], centroidLng: poly.centroid[0],
      polygonGeojson: JSON.stringify({ type: 'Polygon', coordinates: [poly.ring] }),
      areaHaComputed, areaHaDeclared: null, plotHa: areaHaComputed, ring: poly.ring,
    };
  }
  throw new Error(`造不出符合场景 ${scen.kind}（${scen.area}）的几何，地契 ${titleHa} ha`);
}

function makeTitleNo(rng, type, lotNo) {
  switch (type) {
    case 'GRN': return `GRN ${rng.int(10000, 99999)}`;
    case 'GM': return `GM ${rng.int(100, 9999)}`;
    case 'HSD': return `HSD ${rng.int(1000, 99999)}`;
    case 'HSM': return `HSM ${lotNo}/${rng.int(60, 99)}`;
    case 'PN': return `PN ${rng.int(1000, 99999)}`;
    case 'PM': return `PM ${rng.int(100, 9999)}`;
    default: return `Hak Milik ${rng.int(1000, 9999)}`;
  }
}

function randomDate(rng, fromYear, toYear) {
  const y = rng.int(fromYear, toYear), m = rng.int(1, 12), d = rng.int(1, 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function uniqueValue(rng, used, make, what) {
  for (let i = 0; i < 100; i++) {
    const v = make();
    if (!used.has(v)) { used.add(v); return v; }
  }
  throw new Error(`造不出不重复的${what}`);
}

// used: 全局去重表 { names, titleNos, lots, licences, icHashes }
export function makePlotSpec({ index, scen, rng, alloc, used }) {
  const district = rng.weighted(DISTRICTS.map((d) => [d, d.weight]));

  // ---- 园主 ----
  const ethnic = pickEthnic(rng);
  const gender = rng.chance(0.72) ? 'male' : 'female';
  const operatorName = uniqueValue(rng, used.names, () => makeName(rng, ethnic, gender), '姓名');
  const bornYear = rng.chance(0.1) ? rng.int(2000, 2003) : rng.int(1950, 1999);
  const operatorIdentity = (() => {
    for (let i = 0; i < 20; i++) {
      const ident = makeIdentity(rng, { bornYear, gender });
      if (!used.icHashes.has(ident.icHash)) { used.icHashes.add(ident.icHash); return ident; }
    }
    throw new Error('造不出不重复的身份证哈希');
  })();

  // ---- 地契 ----
  const titleType = rng.weighted(TITLE_TYPES);
  const tenure = LEASEHOLD.has(titleType) ? 'leasehold' : 'freehold';
  const lotNo = uniqueValue(rng, used.lots, () => `${district.name}:${rng.int(20, 9999)}`, '地段号').split(':')[1];
  const titleNo = uniqueValue(rng, used.titleNos, () => makeTitleNo(rng, titleType, lotNo), '地契号');
  const print = printArea(rng, drawTitleHa(rng, scen));
  const special = rng.chance(0.06);
  const mukim = rng.pick(district.mukim);
  const titleData = {
    titleType, titleNo, lotNo, mukim, district: district.name, state: STATE,
    locality: rng.chance(0.8) ? rng.pick(LOCALITIES) : null,
    areaValue: print.areaValue, areaUnit: print.areaUnit, areaHa: print.areaHa,
    landUseCategory: 'agriculture', tenure,
    leaseExpiry: tenure === 'leasehold' ? addDays(AS_OF, rng.int(1100, 30000)) : null,
    dateFirstAlienation: randomDate(rng, 1955, 2010),
    expressConditions: rng.pick(EXPRESS_CONDITIONS), restrictionsInInterest: rng.pick(RESTRICTIONS),
    annualRentRm: round(rng.float(10, 400), 2),
    specialAreaType: special ? 'malay_reservation' : 'none',
    specialAreaGazette: special ? `Warta Kerajaan No. ${rng.int(100, 2999)} bertarikh ${toDmy(randomDate(rng, 1960, 2005))}` : null,
    standardSheetNo: rng.chance(0.55) ? `${rng.int(1, 99)}-${rng.int(1, 99)}` : null,
    certifiedPlanNo: rng.chance(0.55) ? `PA ${rng.digits(6)}` : null,
    sourceDocumentPath: null,
    verificationLevel: scen.lowConf?.confirmed || rng.chance(0.4) ? 'confirmed' : 'extracted',
  };

  // ---- 持有人 ----
  let variantName = null;
  if (scen.nameVariant) variantName = nameVariant(rng, operatorName);
  const variantAt = variantName ? scen.nameVariant : null;
  const proprietors = [];
  if (scen.deceased) {
    const fatherName = makeFatherName(rng, operatorName, ethnic);
    const ident = makeIdentity(rng, { bornYear: rng.int(1930, 1952), gender: 'male' });
    proprietors.push({ nameAsPrinted: fatherName, ...ident, personId: null, isOperator: false });
  } else {
    const others = Array.from({ length: scen.coOwners }, () => {
      const name = makeOtherName(rng, operatorName, ethnic);
      return { nameAsPrinted: name, ...makeIdentity(rng, { bornYear: rng.int(1945, 1995), gender: rng.chance(0.5) ? 'male' : 'female' }), personId: null, isOperator: false };
    });
    const me = {
      nameAsPrinted: variantAt === 'title' ? variantName : operatorName,
      ...operatorIdentity, personId: null, isOperator: true, // personId 稍后填
    };
    const at = rng.int(0, others.length);
    others.splice(at, 0, me);
    proprietors.push(...others);
  }
  const n = proprietors.length;
  proprietors.forEach((p, i) => {
    p.seq = i + 1;
    p.shareText = n > 1 ? `1/${n}` : null;
  });

  // ---- 执照 ----
  let licence = null;
  if (scen.licence !== 'missing') {
    const days = scen.licence === 'ok' ? rng.int(BAND.expiryOkMinDays, 900)
      : scen.licence === 'expiring' ? rng.int(...BAND.expiringDays)
        : -rng.int(...BAND.expiredDays);
    const licenceNo = uniqueValue(rng, used.licences, () => `8102${rng.digits(8)}`, '执照号');
    licence = {
      licenceNo, licenceType: 'SH',
      holderName: variantAt === 'licence' ? variantName : operatorName,
      holderIcHash: operatorIdentity.icHash, holderIcLast4: operatorIdentity.icLast4,
      validUntil: addDays(AS_OF, days),
      lotText: `Lot ${lotNo}, ${mukim}, ${district.name}`,
      sourceDocumentPath: null,
      verificationLevel: scen.lowConf?.confirmed || rng.chance(0.4) ? 'confirmed' : 'extracted',
    };
  }

  // ---- 几何：占一个格子 ----
  const cellInfo = alloc.take(district.anchor);
  const geometry = makeGeometry(rng, scen, titleData.areaHa, cellInfo);

  // ---- 时间 ----
  const day = addDays(AS_OF, -rng.int(1, 18));
  const hhmm = `${String(rng.int(8, 17)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}`;
  const geometryRecordedAt = myt(day, hhmm);
  const capturedAt = addMinutes(geometryRecordedAt, -rng.int(8, 45));
  const plotCreatedAt = addMinutes(capturedAt, -rng.int(2, 10));
  const startedAt = addMinutes(geometryRecordedAt, rng.int(3, 40));
  const finishedAt = addMinutes(startedAt, rng.int(1, 3));

  return {
    index, scen, district, ethnic, gender,
    operator: { name: operatorName, ...operatorIdentity },
    titleData, proprietors, licence,
    variantName, variantAt,
    geometry,
    nickname: rng.pick(PLOT_NICKNAMES),
    plantedYear: rng.int(1998, 2018),
    times: { plotCreatedAt, capturedAt, geometryRecordedAt, startedAt, finishedAt },
  };
}
