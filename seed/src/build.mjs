// 把场景、实体、文件、评估组装成全部集合。纯函数，不碰文件系统；写盘在 generate.mjs。
// 每个地块造完都会用规则引擎重算一遍状态，和场景里的目标状态对不上就直接抛错。
import {
  SEED, AS_OF, DEMO_COOP_ID, DEMO_OFFICER_UID, RULE_PARAMS, MSPO_SCHEMES, MSPO_STANDARD, MSPO_CERT_BODY,
  MODEL_VERSION, RULES_VERSION,
} from './constants.mjs';
import { createRng } from './rng.mjs';
import { addDays, addMinutes, addYears, myt } from './dates.mjs';
import { round } from './units.mjs';
import { createCellAllocator, bbox } from './geo.mjs';
import { aggregate, cc01, cc02, cc03, deriveGaps, isUnconfirmedLow, summarize, toNeedsReview } from './rules.mjs';
import { stripMeta, firestoreProblems } from './shape.mjs';
import { buildDemo, DEMO_IDS, DEMO_CREATED } from './demo.mjs';
import { makeScenarios, TARGET_COUNTS } from './scenarios.mjs';
import { makePlotSpec } from './entities.mjs';
import { buildDocuments } from './documents.mjs';

const base = { isSynthetic: true };
const CELL_STEP = 0.007;

function forestFor(rng, status) {
  if (status === 'red') {
    const roll = rng.next();
    if (roll < 0.35) return { cover: round(rng.float(8, 25), 2), loss: round(rng.float(0.2, 1.6), 4), risk: 'high' };
    if (roll < 0.6) return { cover: round(rng.float(3, 12), 2), loss: round(rng.float(0.05, 0.4), 4), risk: 'medium' };
  }
  return { cover: round(rng.float(0, status === 'red' ? 3 : 6), 2), loss: 0, risk: 'low' };
}

// 用规则引擎对一个地块的原始数据算出：三条规则结果、缺口、状态、小结
function evaluate({ operatorName, titleHa, plotHa, licenceValidUntil, leaseExpiry, certExpiry, titleNames, licenceName, memberName, inMspo }, critical, evidenceIds, nameKey) {
  let r1 = cc01({ titleHa, plotHa });
  let r2 = cc02({ asOf: AS_OF, licenceValidUntil, leaseExpiry, certExpiry });
  let r3 = cc03({ operatorName, titleNames, licenceName, memberName });
  if (isUnconfirmedLow(critical.area)) r1 = toNeedsReview(r1, critical.area, 'land_title');
  if (critical.validUntil && isUnconfirmedLow(critical.validUntil)) r2 = toNeedsReview(r2, critical.validUntil, 'mpob_licence');
  if (isUnconfirmedLow(critical.name)) r3 = toNeedsReview(r3, critical.name, 'land_title');
  if (evidenceIds) {
    r1.evidence = [{ documentId: evidenceIds.titleP1, fieldKey: 'land_title.area_value' }];
    r2.evidence = evidenceIds.licence ? [{ documentId: evidenceIds.licence, fieldKey: 'mpob_licence.valid_until' }] : [];
    r3.evidence = [{ documentId: evidenceIds.titleP2, fieldKey: nameKey }];
  }
  const results = [r1, r2, r3];
  const gaps = deriveGaps(results, { notInMspo: !inMspo });
  const status = aggregate(results, gaps);
  return { results, gaps, status };
}

// scenarios 只给测试用：注入一份故意有毛病的场景表，确认自检会抛错
export function build({ seed = SEED, scenarios: injected = null } = {}) {
  const root = createRng(seed);
  const demo = buildDemo();

  // ---------- 全局去重表与格子分配 ----------
  const used = { names: new Set(), titleNos: new Set(), lots: new Set(), licences: new Set(), icHashes: new Set() };
  for (const p of demo.persons) { used.names.add(p.data.fullName); used.icHashes.add(p.data.icHash); }
  for (const t of demo.titles) { used.titleNos.add(t.data.titleNo); used.lots.add(`${t.data.district}:${t.data.lotNo}`); }
  for (const l of demo.mpobLicences) used.licences.add(l.data.licenceNo);
  const alloc = createCellAllocator(CELL_STEP);
  for (const p of demo.plots) {
    const ring = JSON.parse(p.data.polygonGeojson).coordinates[0];
    const b = bbox(ring);
    alloc.reserve({ minLng: b.minLng - 0.0005, maxLng: b.maxLng + 0.0005, minLat: b.minLat - 0.0005, maxLat: b.maxLat + 0.0005 });
  }

  // ---------- 场景 → 每个地块的现实部分 ----------
  const scenarios = injected ?? makeScenarios(root.fork('scenarios'));
  const specs = scenarios.map((scen, i) => makePlotSpec({ index: i, scen, rng: root.fork(`plot-${i}`), alloc, used }));

  // ---------- MSPO 团体证书与成员名单 ----------
  const mspoRng = root.fork('mspo');
  const certs = MSPO_SCHEMES.map((s, i) => {
    const rng = root.fork(`cert-${i}`);
    let certNo;
    do { certNo = `MSPO ${rng.int(100000, 899999)}`; } while (certNo === 'MSPO 900001');
    return { ...s, id: rng.uuid(), certNo, members: [] };
  });
  const pickCert = () => mspoRng.weighted(certs.map((c) => [c, c.weight]));
  for (const spec of specs) {
    spec.docCert = pickCert(); // 不在名单的园主也拍过证书，只是名单里找不到他
    if (spec.scen.inMspo) {
      spec.cert = spec.docCert;
      spec.cert.members.push(spec);
      spec.memberNo = spec.cert.members.length;
      spec.memberId = root.fork(`member-${spec.index}`).uuid();
    } else {
      spec.cert = null;
    }
  }
  for (const c of certs) {
    const total = c.members.reduce((s, sp) => s + sp.titleData.areaHa, 0);
    c.data = {
      certNo: c.certNo, certificateHolder: c.holder,
      certificationUnit: `${c.unit} (${c.members.length} members)`,
      standard: MSPO_STANDARD, scope: 'estate',
      startDate: c.start, firstCertifiedDate: c.first, expiryDate: addDays(addYears(c.start, 5), -1),
      membersCount: c.members.length,
      plantedHa: round(total * 0.93, 2), hcvHa: round(total * 0.02, 2),
      infrastructureOtherHa: round(total - round(total * 0.93, 2) - round(total * 0.02, 2), 2), totalAreaHa: round(total, 2),
      certBody: MSPO_CERT_BODY, emspoTrackId: null, spocNo: null, sourceDocumentPath: null, verificationLevel: 'extracted',
      ...base, createdAt: DEMO_CREATED, updatedAt: DEMO_CREATED,
    };
  }

  // ---------- 集合 ----------
  const out = {
    persons: [...demo.persons], cooperatives: [demo.cooperative], users: [...demo.users],
    titles: [...demo.titles], mpobLicences: [...demo.mpobLicences],
    mspoCertificates: [demo.mspoCertificate], mspoMembers: [...demo.mspoMembers],
    plots: [...demo.plots], documents: [...demo.yellowDocuments], assessments: [...demo.assessments], config: [],
  };

  // 3 个园主账号，对应 3 个演示园主；uid 就是 users 文档 id，load-emulator.mjs 会在 Auth 模拟器里按这个 uid 预建账号
  ['1', '2', '3'].forEach((n, i) => {
    out.users.push({
      path: `users/demo-smallholder-${n}`,
      data: {
        phone: `+6010000001${n}`, role: 'smallholder', language: 'ms', personId: DEMO_IDS.person[i], coopId: DEMO_COOP_ID,
        lastLoginAt: null, ...base, createdAt: DEMO_CREATED,
      },
    });
  });

  // ---------- 演示地块的评估核对 + 绿/红补文件 ----------
  const demoStatuses = ['green', 'yellow', 'red'];
  demo.plots.forEach((plot, i) => {
    const plotId = plot.path.split('/')[1];
    const a = demo.assessments[i].data;
    const title = demo.titles[i].data;
    const licence = demo.mpobLicences[i].data;
    const facts = demo.facts[i];
    // 存下来的评估必须聚合出演示地块的状态；再用原始数据让规则引擎独立重算一遍
    if (aggregate(a.ruleResults, a.gaps) !== demoStatuses[i]) throw new Error(`演示地块 ${i + 1} 的评估聚合出来不是 ${demoStatuses[i]}`);
    const recomputed = evaluate({
      operatorName: facts.operatorName, titleHa: title.areaHa, plotHa: plot.data.areaHaComputed,
      licenceValidUntil: licence.validUntil, leaseExpiry: null, certExpiry: facts.memberName ? '2029-02-28' : null,
      titleNames: facts.titleNames, licenceName: facts.licenceName, memberName: facts.memberName, inMspo: Boolean(facts.memberName),
    }, {
      area: { confidence: 0.93 }, name: { confidence: 0.9 },
      validUntil: { confidence: i === 1 ? 0.64 : 0.9, ...(i === 1 ? { confirmedValue: licence.validUntil } : {}) },
    }, null, null);
    if (recomputed.status !== demoStatuses[i]) throw new Error(`演示地块 ${i + 1} 用规则重算得到 ${recomputed.status}，应为 ${demoStatuses[i]}`);

    if (i === 1) {
      // 黄色演示地块原有 3 个文件，原样保留；评估证据指向它们
      a.ruleResults[0].evidence = [{ documentId: DEMO_IDS.yellowDocs[0], fieldKey: 'land_title.area_value' }];
      a.ruleResults[1].evidence = [{ documentId: DEMO_IDS.yellowDocs[2], fieldKey: 'mpob_licence.valid_until' }];
      a.ruleResults[2].evidence = [{ documentId: DEMO_IDS.yellowDocs[1], fieldKey: 'land_title.proprietor_1_name' }];
      return;
    }

    // 绿、红原本没有文件，补上地契两页与执照（不含证书／名单页，保持和 schema 演示一致的轻量）
    const proprietors = title.proprietors.map((p) => ({ ...p, isOperator: p.personId === plot.data.operatorPersonId }));
    const rec = plot.data.geometryRecordedAt;
    const idRng = root.fork(`demo-doc-ids-${i}`);
    const docs = buildDocuments({
      rng: root.fork(`demo-doc-fields-${i}`), plotId,
      spec: { scen: { lowConf: null, boundaryConf: false }, times: { capturedAt: addMinutes(rec, -20), geometryRecordedAt: rec }, proprietors },
      title, licence, cert: null, member: null, inMspo: false, uploader: DEMO_OFFICER_UID, newId: () => idRng.uuid(),
    });
    out.documents.push(...docs.docs);
    title.sourceDocumentPath = `plots/${plotId}/documents/${docs.ids.titleP1}`;
    licence.sourceDocumentPath = `plots/${plotId}/documents/${docs.ids.licence}`;
    a.ruleResults[0].evidence = [{ documentId: docs.ids.titleP1, fieldKey: 'land_title.area_value' }];
    a.ruleResults[1].evidence = [{ documentId: docs.ids.licence, fieldKey: 'mpob_licence.valid_until' }];
    a.ruleResults[2].evidence = [{ documentId: docs.ids.titleP2, fieldKey: docs.nameKey }];
  });

  // ---------- 生成的 197 个地块 ----------
  const statusCount = { green: 0, yellow: 0, red: 0, needs_review: 0 };
  for (const spec of specs) {
    const { scen, times, geometry } = spec;
    const rng = root.fork(`final-${spec.index}`);
    const ids = {
      plot: rng.uuid(), person: rng.uuid(), title: rng.uuid(), licence: spec.licence ? rng.uuid() : null,
      assessment: rng.uuid(),
    };
    const idGen = root.fork(`docids-${spec.index}`);
    const uploader = DEMO_OFFICER_UID;

    const title = spec.titleData;
    const operatorProp = spec.proprietors.find((p) => p.isOperator);
    if (operatorProp) operatorProp.personId = ids.person;

    const member = spec.cert ? {
      memberNo: spec.memberNo,
      memberName: spec.variantAt === 'member' ? spec.variantName : spec.operator.name,
      plotNo: `P${spec.memberNo}`,
      landTitleText: `Lot ${title.lotNo} No. ${title.titleNo} - ${title.areaHa.toFixed(3)}ha, ${title.district}, Agriculture. ${title.tenure === 'freehold' ? 'Perpetuity ownership.' : 'Leasehold tenure.'}`,
      mpobLicenceNo: spec.licence ? spec.licence.licenceNo : null,
    } : null;

    const docsOut = buildDocuments({
      rng: root.fork(`fields-${spec.index}`), plotId: ids.plot, spec, title, licence: spec.licence,
      cert: spec.docCert.data, member, inMspo: scen.inMspo, uploader, newId: () => idGen.uuid(),
    });

    const ev = evaluate({
      operatorName: spec.operator.name, titleHa: title.areaHa, plotHa: geometry.plotHa,
      licenceValidUntil: spec.licence ? spec.licence.validUntil : null, leaseExpiry: title.leaseExpiry,
      certExpiry: spec.cert ? spec.cert.data.expiryDate : null,
      titleNames: spec.proprietors.map((p) => p.nameAsPrinted),
      licenceName: spec.licence ? spec.licence.holderName : null, memberName: member ? member.memberName : null,
      inMspo: scen.inMspo,
    }, docsOut.critical, docsOut.ids, docsOut.nameKey);

    // 状态必须等于场景的目标状态；有些场景还要求"只有这一处毛病"
    if (ev.status !== scen.target) {
      throw new Error(`地块 #${spec.index}（plotId ${ids.plot}，${scen.kind}）目标 ${scen.target}，规则引擎算出 ${ev.status}：${JSON.stringify(ev.results.map((r) => [r.ruleCode, r.result, r.detail]))}`);
    }
    if (scen.target === 'green' && ev.gaps.length) throw new Error(`green 地块 #${spec.index} 不应有缺口`);
    if (scen.target === 'needs_review' && !(ev.results.filter((r) => r.result === 'needs_review').length === 1 && ev.results.filter((r) => r.result === 'pass').length === 2 && ev.gaps.length === 1)) {
      throw new Error(`needs_review 地块 #${spec.index} 应当只有一条规则读不准、其余通过`);
    }
    statusCount[ev.status]++;

    const forest = forestFor(rng, ev.status);
    const docPath = (key) => `plots/${ids.plot}/documents/${docsOut.ids[key]}`;

    out.persons.push({ path: `persons/${ids.person}`, data: { fullName: spec.operator.name, icHash: spec.operator.icHash, icLast4: spec.operator.icLast4, ...base, createdAt: addMinutes(times.plotCreatedAt, -1) } });
    out.titles.push({
      path: `titles/${ids.title}`,
      data: {
        ...title, sourceDocumentPath: docPath('titleP1'),
        proprietors: spec.proprietors.map((p) => ({ seq: p.seq, nameAsPrinted: p.nameAsPrinted, icHash: p.icHash, icLast4: p.icLast4, shareText: p.shareText, personId: p.personId })),
        ...base, createdAt: addMinutes(times.capturedAt, 2), updatedAt: times.finishedAt,
      },
    });
    if (spec.licence) {
      out.mpobLicences.push({
        path: `mpobLicences/${ids.licence}`,
        data: { ...spec.licence, holderPersonId: ids.person, sourceDocumentPath: docPath('licence'), ...base, createdAt: addMinutes(times.capturedAt, 2), updatedAt: times.finishedAt },
      });
    }
    if (member) {
      out.mspoMembers.push({
        path: `mspoCertificates/${spec.cert.id}/members/${spec.memberId}`,
        data: { certificateId: spec.cert.id, ...member, personId: ids.person, landTitleId: ids.title, ...base, createdAt: addMinutes(times.capturedAt, 2) },
      });
    }
    out.plots.push({
      path: `plots/${ids.plot}`,
      data: {
        nickname: spec.nickname, operatorPersonId: ids.person, coopId: DEMO_COOP_ID, landTitleId: ids.title,
        mpobLicenceId: ids.licence, mspoCertificateId: spec.cert ? spec.cert.id : null, mspoMemberId: spec.cert ? spec.memberId : null,
        countryCode: 'MY', geometryType: geometry.geometryType, centroidLat: geometry.centroidLat, centroidLng: geometry.centroidLng,
        polygonGeojson: geometry.polygonGeojson, areaHaComputed: geometry.areaHaComputed, areaHaDeclared: geometry.areaHaDeclared,
        oilPalmPlantedYear: spec.plantedYear, status: ev.status,
        geometryRecordedAt: times.geometryRecordedAt, lastAssessedAt: times.finishedAt,
        state: title.state, district: title.district, titleNo: title.titleNo,
        ...base, createdAt: times.plotCreatedAt, updatedAt: times.finishedAt,
      },
    });
    out.documents.push(...docsOut.docs);
    out.assessments.push({
      path: `plots/${ids.plot}/assessments/${ids.assessment}`,
      data: {
        plotId: ids.plot, runStatus: 'done', result: ev.status, startedAt: times.startedAt, finishedAt: times.finishedAt,
        modelVersion: MODEL_VERSION, rulesVersion: RULES_VERSION, inputSnapshot: null, forestDataset: null,
        forestCover2020Pct: forest.cover, forestLossAfter2020Ha: forest.loss, forestRisk: forest.risk,
        summaryText: summarize(ev.status, ev.gaps), summaryLang: 'ms', errorMessage: null,
        ruleResults: ev.results.map(stripMeta), gaps: ev.gaps,
        ...base, createdAt: times.startedAt,
      },
    });
  }

  for (const c of certs) {
    out.mspoCertificates.push({ path: `mspoCertificates/${c.id}`, data: c.data });
  }
  out.config.push({ path: 'config/ruleParams', data: { ...RULE_PARAMS, updatedAt: DEMO_CREATED } });

  // ---------- 总体核对 ----------
  const counts = { green: 0, yellow: 0, red: 0, needs_review: 0 };
  for (const p of out.plots) counts[p.data.status]++;
  for (const k of Object.keys(TARGET_COUNTS)) {
    if (counts[k] !== TARGET_COUNTS[k]) throw new Error(`状态计数不对：${k} 要 ${TARGET_COUNTS[k]}，实际 ${counts[k]}`);
  }
  const seen = new Set();
  for (const [name, list] of Object.entries(out)) {
    for (const d of list) {
      if (seen.has(d.path)) throw new Error(`重复的文档路径：${d.path}`);
      seen.add(d.path);
      const problems = firestoreProblems(d.data, d.path);
      if (problems.length) throw new Error(`${name} 里有 Firestore 写不进去的值：${problems.join('；')}`);
    }
  }

  const manifest = {
    seed, asOf: AS_OF, statusCounts: counts,
    collections: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
    note: '全部为虚构的模拟数据（isSynthetic = true）。由 seed/generate.mjs 生成，勿手改。',
  };
  return { collections: out, manifest, generatedStatusCount: statusCount };
}
