// 缺口（assessments.gaps[]）文案的类型。词典里每个已知的 gapCode 有一组函数，
// 数字来自 ruleResults，由 features/result/assessment.ts 解析好再传进来。
// 放在单独的叶子文件里，词典和评估逻辑都能 import，不形成循环。

/** 种子里出现的缺口类别（合同还没定义，是临时约定）；不在这里的 gapCode 走通用兜底文案 */
export const GAP_CODES = [
  'area_mismatch',
  'expiring',
  'expired',
  'name_mismatch',
  'not_in_mspo',
  'low_confidence',
  'missing_doc',
] as const;
export type GapCode = (typeof GAP_CODES)[number];

export const isGapCode = (v: unknown): v is GapCode =>
  typeof v === 'string' && (GAP_CODES as readonly string[]).includes(v);

/** 文案要用的数字。解析不出来就是 null，文案函数据此退回不带数字的句子（不能出现 NaN、0 或空值） */
export interface GapFacts {
  /** 地契面积，已格式化，如 "3.04" */
  geran: string | null;
  /** 地图量出的面积，已格式化 */
  lukisan: string | null;
  /** 距到期的天数 */
  days: number | null;
  /** 到期日，已按当前语言格式化，如 "30 Apr 2026" */
  date: string | null;
}

/** 句中的文件名：首字母小写；首词是全大写缩写（MPOB、MSPO）的不动。「Geran tanah」→「geran tanah」，「MPOB licence」不变 */
export function inlineDocName(name: string): string {
  const first = name.split(' ')[0];
  return /^[A-Z]{2,}$/.test(first) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

export interface GapCtx {
  /** 文件名（已按语言翻译，句首用）；缺口没有 docType 时是通用的「Dokumen」 */
  doc: string;
  /** 句中用的文件名：首字母小写（「geran tanah」），首词是缩写（MPOB、MSPO）的不动 */
  docInline: string;
  docType: string | null;
  facts: GapFacts;
}

export interface GapText {
  title: (c: GapCtx) => string;
  detail: (c: GapCtx) => string;
  /** 「可能原因」：不责怪用户 */
  cause: string;
  advice: (c: GapCtx) => string;
  /** 屏 9 卡片上那一个按钮的文字 */
  button: string;
}
