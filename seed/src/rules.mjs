// 规则引擎：CC-01 面积、CC-02 有效期、CC-03 姓名，加上"读出置信度"。
// 生成器用它算 ruleResults / gaps / 状态；validate.mjs 不引用本文件，另有一份独立实现来重算。
// 阈值来自 contract/schema.sql 的 rule_params（见 constants.mjs），比较一律用整数，避开浮点误差。
import { P } from './constants.mjs';
import { diffDays } from './dates.mjs';
import { toTenThousandths } from './units.mjs';
import { similarity } from './similarity.mjs';

const PARAMS_USED = {
  'CC-01': { tol_pct: P.areaTolerancePct, tol_min_ha: P.areaToleranceMinHa, fail_over_pct: P.areaFailOverPct },
  'CC-02': { warn_days: P.expiryWarnDays },
  'CC-03': { min_similarity: P.nameSimilarityMin },
};

const ha4 = (x) => x.toFixed(4);

// CC-01：地图面积比地契多出多少。多出不超过"地契面积的 10% 与 0.1 公顷中较大者"→ 通过；
// 超出 → 黄；多出超过 50% → 红。面积偏小不判（企划书 §8.6 未定，保守按通过）。
export function cc01({ titleHa, plotHa }) {
  const t = toTenThousandths(titleHa);
  const p = toTenThousandths(plotHa);
  const over = p - t;
  const tol = Math.max((t * P.areaTolerancePct) / 100, P.areaToleranceMinHa * 10000);
  let result = 'pass';
  if (over * 100 > t * P.areaFailOverPct) result = 'fail';
  else if (over > tol) result = 'warn';
  const overHa = over / 10000;
  const pct = (over / t) * 100;
  let detail;
  if (result === 'pass') detail = `Beza ${overHa.toFixed(2)} ha, dalam had yang dibenarkan`;
  else if (result === 'warn') detail = `Lebih ${overHa.toFixed(2)} ha (+${pct.toFixed(1)}%), melebihi had ${(tol / 10000).toFixed(3)} ha`;
  else detail = `Lebih ${pct.toFixed(0)}%, melebihi had ${P.areaFailOverPct}%`;
  return {
    ruleCode: 'CC-01', result,
    expectedValue: `${ha4(titleHa)} ha`, actualValue: `${ha4(plotHa)} ha`,
    paramsUsed: { ...PARAMS_USED['CC-01'] }, detail,
    meta: { titleHa, plotHa, overHa, pct },
  };
}

// CC-02：有效期。已过期(<0 天) → 红；不足 90 天(<90) → 黄；其余通过。到期当天按未过期。
// 缺 MPOB 执照记黄（团队约定，企划书屏 11 线框有"MPOB licence missing"一行）。
export function cc02({ asOf, licenceValidUntil, leaseExpiry = null, certExpiry = null }) {
  if (licenceValidUntil == null) {
    return {
      ruleCode: 'CC-02', result: 'warn',
      expectedValue: 'Lesen MPOB ada', actualValue: 'Tiada lesen MPOB',
      paramsUsed: { ...PARAMS_USED['CC-02'] }, detail: 'Lesen MPOB belum dimuat naik',
      meta: { kind: 'missing' },
    };
  }
  const items = [['MPOB', licenceValidUntil], ['sewaan', leaseExpiry], ['MSPO', certExpiry]]
    .filter(([, d]) => d != null)
    .map(([label, date]) => ({ label, date, days: diffDays(asOf, date) }));
  const worst = items.reduce((a, b) => (b.days < a.days ? b : a));
  let result = 'pass';
  let kind = 'ok';
  if (worst.days < 0) { result = 'fail'; kind = 'expired'; }
  else if (worst.days < P.expiryWarnDays) { result = 'warn'; kind = 'expiring'; }
  const detail = kind === 'expired'
    ? `${worst.label} tamat pada ${worst.date}, telah tamat tempoh ${-worst.days} hari`
    : `${worst.label} tamat pada ${worst.date}, ${worst.days} hari lagi`;
  return {
    ruleCode: 'CC-02', result,
    expectedValue: `>= ${P.expiryWarnDays} hari`,
    actualValue: kind === 'expired' ? `${worst.date} telah tamat` : `${worst.days} hari`,
    paramsUsed: { ...PARAMS_USED['CC-02'] }, detail,
    meta: { kind, days: worst.days, date: worst.date, label: worst.label },
  };
}

// CC-03：园主姓名与三处纸面对得上吗。地契取各持有人中最像的一位；
// 执照、MSPO 名单（有才比）；三段取最低。不采用"身份证哈希相同即同一人"的捷径（企划书里仍待确认）。
export function cc03({ operatorName, titleNames, licenceName = null, memberName = null }) {
  const parts = [
    { label: 'geran', name: titleNames.reduce((best, n) => (similarity(operatorName, n) > similarity(operatorName, best) ? n : best)) },
  ];
  if (licenceName != null) parts.push({ label: 'lesen MPOB', name: licenceName });
  if (memberName != null) parts.push({ label: 'senarai MSPO', name: memberName });
  const scored = parts.map((p) => ({ ...p, sim: similarity(operatorName, p.name) }));
  const worst = scored.reduce((a, b) => (b.sim < a.sim ? b : a));
  const result = worst.sim >= P.nameSimilarityMin ? 'pass' : 'fail';
  return {
    ruleCode: 'CC-03', result,
    expectedValue: `>= ${P.nameSimilarityMin.toFixed(2)}`, actualValue: worst.sim.toFixed(2),
    paramsUsed: { ...PARAMS_USED['CC-03'] },
    detail: result === 'pass'
      ? 'Nama pada geran, lesen dan senarai sepadan'
      : `Nama pada ${worst.label} ialah ${worst.name}, berbeza daripada pengusaha ${operatorName}`,
    meta: { sim: worst.sim, label: worst.label, name: worst.name },
  };
}

// 置信度低于 0.7 且用户没确认 → 这条规则读不准，只能"需人工复核"
export function isUnconfirmedLow(field) {
  if (!field || field.confirmedValue != null) return false;
  return Math.round(field.confidence * 100) < Math.round(P.confidenceMin * 100);
}

export function toNeedsReview(base, field, docType) {
  return {
    ...base,
    result: 'needs_review',
    actualValue: `keyakinan bacaan ${field.confidence.toFixed(2)}`,
    detail: 'Bacaan gambar kurang jelas, perlu disahkan',
    meta: { ...base.meta, kind: 'low_confidence', docType },
  };
}

// 聚合：有 fail → red；否则有 needs_review → needs_review；否则有 warn 或 open gap → yellow；否则 green
export function aggregate(ruleResults, gaps) {
  if (ruleResults.some((r) => r.result === 'fail')) return 'red';
  if (ruleResults.some((r) => r.result === 'needs_review')) return 'needs_review';
  if (ruleResults.some((r) => r.result === 'warn') || gaps.some((g) => g.status === 'open')) return 'yellow';
  return 'green';
}

const GAP_BASE = { citation: null, status: 'open' };

// 从非通过的规则结果推出缺口；不在 MSPO 名单是单独一条（没有对应规则）。
export function deriveGaps(ruleResults, { notInMspo }) {
  const gaps = [];
  for (const r of ruleResults) {
    if (r.result === 'pass') continue;
    const m = r.meta;
    if (r.result === 'needs_review') {
      gaps.push({
        gapCode: 'low_confidence', severity: 'medium', docType: m.docType,
        description: 'Tulisan pada gambar kurang jelas, nilai perlu disahkan',
        suggestedAction: 'Sahkan nilai di skrin semakan, atau ambil gambar semula yang lebih jelas.',
        ...GAP_BASE,
      });
    } else if (r.ruleCode === 'CC-01') {
      gaps.push({
        gapCode: 'area_mismatch', severity: r.result === 'fail' ? 'high' : 'medium', docType: null,
        description: `Luas pada peta lebih besar ${m.overHa.toFixed(2)} ha (${m.pct.toFixed(0)}%) daripada geran`,
        suggestedAction: 'Lukis semula sempadan, atau semak sama ada tanah telah dipecahkan atau ada geran bersebelahan.',
        ...GAP_BASE,
      });
    } else if (r.ruleCode === 'CC-02') {
      if (m.kind === 'missing') {
        gaps.push({
          gapCode: 'missing_doc', severity: 'medium', docType: 'mpob_licence',
          description: 'Lesen MPOB belum dimuat naik',
          suggestedAction: 'Ambil gambar lesen MPOB dan muat naik.', ...GAP_BASE,
        });
      } else if (m.kind === 'expired') {
        gaps.push({
          gapCode: 'expired', severity: 'high', docType: 'mpob_licence',
          description: `Lesen MPOB telah tamat tempoh ${-m.days} hari`,
          suggestedAction: 'Perbaharui lesen dahulu (fi lewat dikenakan), kemudian muat naik lesen baharu.', ...GAP_BASE,
        });
      } else {
        gaps.push({
          gapCode: 'expiring', severity: 'medium', docType: 'mpob_licence',
          description: `Lesen MPOB tamat dalam ${m.days} hari`,
          suggestedAction: 'Mohon pembaharuan lebih awal, kemudian muat naik lesen baharu.', ...GAP_BASE,
        });
      }
    } else if (r.ruleCode === 'CC-03') {
      gaps.push({
        gapCode: 'name_mismatch', severity: 'high', docType: 'land_title',
        description: `Nama pada ${m.label} ialah ${m.name}, berbeza daripada pengusaha`,
        suggestedAction: 'Sediakan dokumen pusaka (surat kuasa mentadbir atau perintah faraid) atau surat kuasa wakil daripada semua waris, kemudian muat naik salinan yang jelas pada skrin Dokumen.', ...GAP_BASE,
      });
    }
  }
  if (notInMspo) {
    gaps.push({
      gapCode: 'not_in_mspo', severity: 'medium', docType: 'mspo_member_list',
      description: 'Pengusaha tiada dalam senarai ahli skim kumpulan MSPO',
      suggestedAction: 'Sahkan dengan koperasi sama ada sudah menyertai skim kumpulan MSPO.', ...GAP_BASE,
    });
  }
  return gaps;
}

// 马来语小结：green 一句；其余把缺口描述连起来
export function summarize(status, gaps) {
  if (status === 'green') return 'Semua semakan lulus.';
  return gaps.map((g) => `${g.description}.`).join(' ');
}
