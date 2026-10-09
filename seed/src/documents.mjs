// 一个地块的文件（照片）与读出的字段。
// fields{} 的键沿用企划书 §8.5 的 `<文件前缀>.<field_key>`（含点），值是 {rawText, normalizedValue, confidence, …}。
// 照片本身这次不生成，storagePath 只是约定好的路径（仿真证件照是 10/14 的另一项）。
import { addMinutes, toDmy } from './dates.mjs';
import { round } from './units.mjs';
import { maskIc } from './people.mjs';
import { MODEL_VERSION } from './constants.mjs';

const UNIT_WORD = { ha: 'Hektar', acre: 'Ekar', sqm: 'Meter Persegi', sqft: 'Kaki Persegi' };
const TENURE_WORD = { freehold: 'Milik Bebas', leasehold: 'Pajakan' };
const SPECIAL_WORD = { none: 'Tiada', malay_reservation: 'Rizab Melayu' };

// 故意读错：置信度低的字段，AI 读出的值常常就是错的。
// 数字改第一位（不会变成 0），日期改年份最后一位（始终是合法日期），姓名换一个字母。
function misreadNumber(s) {
  const at = s.search(/\d/);
  return s.slice(0, at) + String(((Number(s[at]) + 2) % 9) + 1) + s.slice(at + 1);
}

function misreadYear(iso) {
  return iso.slice(0, 3) + String((Number(iso[3]) + 3) % 10) + iso.slice(4);
}

function misreadName(s) {
  const pos = [...s].map((c, i) => (/[A-Z]/.test(c) ? i : -1)).filter((i) => i >= 0);
  const at = pos[Math.floor(pos.length / 2)];
  return s.slice(0, at) + (s[at] === 'O' ? 'Q' : 'O') + s.slice(at + 1);
}

export function buildDocuments({ rng, plotId, spec, title, licence, cert, member, inMspo, uploader, newId }) {
  const { scen, times, proprietors } = spec;
  const conf = () => round(rng.float(0.86, 0.99), 2);
  const F = (rawText, normalizedValue, confidence = conf()) => ({ rawText, normalizedValue, confidence });
  const same = (v) => F(String(v), String(v));

  const docs = [];
  const ids = {};
  const make = (key, docType, pageNo, fields) => {
    const docId = newId();
    ids[key] = docId;
    docs.push({
      path: `plots/${plotId}/documents/${docId}`,
      data: {
        plotId, docType, pageNo, isCurrent: true,
        storagePath: `seed/${plotId}/${docType}-${pageNo}.jpg`,
        mimeType: 'image/jpeg', sha256: null, source: 'seed', uploadedBy: uploader,
        capturedAt: times.capturedAt, extractionStatus: 'extracted', extractedAt: addMinutes(times.capturedAt, rng.int(1, 3)),
        modelVersion: MODEL_VERSION, fields, isSynthetic: true, createdAt: addMinutes(times.capturedAt, 1),
      },
    });
    return docs[docs.length - 1].data;
  };

  // ---- 地契第 1 页 ----
  const areaValueStr = String(title.areaValue);
  const t1 = {
    'land_title.title_type': same(title.titleType),
    'land_title.title_no': same(title.titleNo),
    'land_title.lot_no': same(title.lotNo),
    'land_title.mukim': same(title.mukim),
    'land_title.district': same(title.district),
    'land_title.state': same(title.state),
    ...(title.locality ? { 'land_title.locality': same(title.locality) } : {}),
    'land_title.area_value': F(`${areaValueStr} ${UNIT_WORD[title.areaUnit]}`, title.areaValue.toFixed(4)),
    'land_title.area_unit': F(UNIT_WORD[title.areaUnit], title.areaUnit),
    'land_title.land_use_category': F('Pertanian', title.landUseCategory),
    'land_title.tenure': F(TENURE_WORD[title.tenure], title.tenure),
    ...(title.leaseExpiry ? { 'land_title.lease_expiry': F(toDmy(title.leaseExpiry), title.leaseExpiry) } : {}),
    ...(title.dateFirstAlienation ? { 'land_title.date_first_alienation': F(toDmy(title.dateFirstAlienation), title.dateFirstAlienation) } : {}),
    ...(title.expressConditions ? { 'land_title.express_conditions': same(title.expressConditions) } : {}),
    ...(title.annualRentRm != null ? { 'land_title.annual_rent_rm': F(`RM ${title.annualRentRm.toFixed(2)}`, title.annualRentRm.toFixed(2)) } : {}),
    'land_title.special_area_type': F(SPECIAL_WORD[title.specialAreaType], title.specialAreaType),
    ...(title.standardSheetNo ? { 'land_title.standard_sheet_no': same(title.standardSheetNo) } : {}),
    ...(title.certifiedPlanNo ? { 'land_title.certified_plan_no': same(title.certifiedPlanNo) } : {}),
  };
  const p1 = make('titleP1', 'land_title', 1, t1);

  // ---- 地契第 2 页：登记持有人 ----
  const t2 = {};
  for (const p of proprietors) {
    t2[`land_title.proprietor_${p.seq}_name`] = F(p.nameAsPrinted, p.nameAsPrinted);
    t2[`land_title.proprietor_${p.seq}_ic`] = F(maskIc(p.icLast4), p.icLast4);
    if (p.shareText) t2[`land_title.proprietor_${p.seq}_share`] = F(p.shareText, p.shareText);
  }
  const p2 = make('titleP2', 'land_title', 2, t2);
  const opSeq = (proprietors.find((p) => p.isOperator) ?? proprietors[0]).seq;
  const nameKey = `land_title.proprietor_${opSeq}_name`;

  // ---- MPOB 执照 ----
  let p3 = null;
  if (licence) {
    p3 = make('licence', 'mpob_licence', 1, {
      'mpob_licence.licence_no': same(licence.licenceNo),
      'mpob_licence.holder_name': same(licence.holderName),
      'mpob_licence.holder_ic': F(maskIc(licence.holderIcLast4), licence.holderIcLast4),
      'mpob_licence.valid_until': F(toDmy(licence.validUntil), licence.validUntil),
      ...(licence.lotText ? { 'mpob_licence.lot_text': same(licence.lotText) } : {}),
    });
  }

  // ---- MSPO 证书与成员名单 ----
  if (cert) {
    make('cert', 'mspo_cert', 1, {
      'mspo_cert.cert_no': same(cert.certNo),
      'mspo_cert.certificate_holder': same(cert.certificateHolder),
      'mspo_cert.certification_unit': same(cert.certificationUnit),
      'mspo_cert.standard': same(cert.standard),
      'mspo_cert.scope': same(cert.scope),
      'mspo_cert.start_date': F(toDmy(cert.startDate), cert.startDate),
      'mspo_cert.expiry_date': F(toDmy(cert.expiryDate), cert.expiryDate),
      'mspo_cert.members_count': same(cert.membersCount),
    });
    // 名单里找不到这位园主 → 读不出任何行，fields 为空（企划书 §8.5："找不到就记为不在名单上"）
    make('memberList', 'mspo_member_list', 1, inMspo && member ? {
      'mspo_member_list.member_no': same(member.memberNo),
      'mspo_member_list.member_name': same(member.memberName),
      'mspo_member_list.plot_no': same(member.plotNo),
      'mspo_member_list.land_title_text': same(member.landTitleText),
      ...(member.mpobLicenceNo ? { 'mspo_member_list.mpob_licence_no': same(member.mpobLicenceNo) } : {}),
    } : {});
  }

  // ---- 低置信度：按场景改写关键字段 ----
  const critical = {
    area: { doc: p1, key: 'land_title.area_value', docType: 'land_title' },
    validUntil: licence ? { doc: p3, key: 'mpob_licence.valid_until', docType: 'mpob_licence' } : null,
    name: { doc: p2, key: nameKey, docType: 'land_title' },
  };
  const confirmedAt = addMinutes(times.capturedAt, rng.int(5, 30));
  if (scen.lowConf) {
    const kind = scen.lowConf.field;
    const target = critical[kind];
    const field = target.doc.fields[target.key];
    const truth = field.normalizedValue;
    field.confidence = round(rng.float(0.4, 0.69), 2);
    if (scen.lowConf.confirmed) {
      // AI 读错了，外勤改正：规则取确认后的值
      if (kind === 'area') {
        field.normalizedValue = misreadNumber(truth);
        field.rawText = `${misreadNumber(areaValueStr)} ${UNIT_WORD[title.areaUnit]}`;
      } else if (kind === 'validUntil') {
        field.normalizedValue = misreadYear(truth);
        field.rawText = toDmy(field.normalizedValue);
      } else {
        field.normalizedValue = misreadName(truth);
        field.rawText = field.normalizedValue;
      }
      field.confirmedValue = truth;
      field.confirmedBy = uploader;
      field.confirmedAt = confirmedAt;
    } else {
      target.doc.extractionStatus = 'needs_review';
    }
  }
  if (scen.boundaryConf) {
    // 恰好 0.70：不算"低于 0.7"，不需要确认。挑一个没被低置信度占用的关键字段。
    const kind = ['area', 'validUntil'].find((k) => critical[k] && scen.lowConf?.field !== k) ?? 'name';
    critical[kind].doc.fields[critical[kind].key].confidence = 0.7;
  }

  return {
    docs, ids,
    critical: {
      area: critical.area.doc.fields[critical.area.key],
      validUntil: critical.validUntil ? critical.validUntil.doc.fields[critical.validUntil.key] : null,
      name: critical.name.doc.fields[critical.name.key],
    },
    nameKey,
  };
}
