import { formatArea, formatIsoDay } from '../../core/format';
import { isGapCode, type GapCode, type GapFacts } from '../../core/i18n/gap-text';
import type { Lang } from '../../core/i18n/i18n.service';

// 屏 9／屏 10 读到的评估文档形状与纯逻辑。字段名是 seed 的临时约定（camelCase），合同还没有示例。
// 时间在读数据层已统一转成 Date。
//
// 这里**故意只声明界面用得到的字段**：ruleResults[].detail、gaps[].description／suggestedAction／citation、
// summaryText、evidence、inputSnapshot、errorMessage 都不声明，也就不会被不小心渲染出来——
// 它们可能含第三人的姓名或「已故父亲」这类推断，种子里还是中文占位。

export interface RuleResultData {
  ruleCode?: string;
  /** pass／warn／fail／needs_review（种子校验器的取值，合同未定义） */
  result?: string;
  expectedValue?: string | null;
  actualValue?: string | null;
}

export interface GapData {
  gapCode?: string;
  severity?: string;
  docType?: string | null;
  status?: string;
}

export interface AssessmentData {
  /** queued → running → done／failed（contract/status.md） */
  runStatus?: string;
  /** green／yellow／red／needs_review */
  result?: string;
  createdAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  forestRisk?: string | null;
  forestLossAfter2020Ha?: number | null;
  ruleResults?: RuleResultData[];
  gaps?: GapData[];
}

export interface AssessmentItem {
  id: string;
  data: AssessmentData;
}

const validTime = (d: unknown): number | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;

/** 一次评估的时间：createdAt，缺则 startedAt、finishedAt */
export function assessmentTime(a: AssessmentData): number | null {
  return validTime(a.createdAt) ?? validTime(a.startedAt) ?? validTime(a.finishedAt);
}

/**
 * 最新一次评估，不论状态：最新一次若还在跑或失败了，就如实显示那个状态，
 * 不拿更早的 done 当成当前结论。没有时间的排最后；时间相同按 id，保证每次选出同一条。
 */
export function latestAssessment(items: readonly AssessmentItem[]): AssessmentItem | null {
  const sorted = [...items].sort((x, y) => {
    const tx = assessmentTime(x.data);
    const ty = assessmentTime(y.data);
    if (tx !== null && ty !== null && tx !== ty) return ty - tx;
    if (tx !== null && ty === null) return -1;
    if (tx === null && ty !== null) return 1;
    return x.id.localeCompare(y.id);
  });
  return sorted[0] ?? null;
}

// ---- 横幅 ----

export type BannerKey = 'green' | 'yellow' | 'red' | 'needs_review' | 'pending' | 'running';

const RESULTS = ['green', 'yellow', 'red', 'needs_review'] as const;

/**
 * 结论横幅。没有评估一律「还没开始」，不凭 plots.status 下结论（没有评估数据撑着，说「全部通过」会误导）。
 * 有评估时以评估为准（plots.status 是后端同步的副本）：还在跑 → running；失败或结论缺失／未知 → 需人工复核。
 */
export function bannerKey(a: AssessmentData | null): BannerKey {
  if (!a) return 'pending';
  if (a.runStatus === 'queued' || a.runStatus === 'running') return 'running';
  if (a.runStatus === 'failed') return 'needs_review';
  return (RESULTS as readonly unknown[]).includes(a.result)
    ? (a.result as BannerKey)
    : 'needs_review';
}

/**
 * 能下结论的评估：有评估，且不是还在跑（queued／running）或失败（failed）的。
 * 事项列表、通过的检查、评估日期、森林初筛都只对它显示：失败的一次不该配上「Disemak pada …」和「通过」。
 */
export function concludedAssessment(a: AssessmentData | null): AssessmentData | null {
  if (a === null) return null;
  return a.runStatus === 'queued' || a.runStatus === 'running' || a.runStatus === 'failed'
    ? null
    : a;
}

/** 横幅下面「Disemak pada …」用的时间：finishedAt，缺则 startedAt */
export function checkedAt(a: AssessmentData): Date | null {
  const t = validTime(a.finishedAt) ?? validTime(a.startedAt);
  return t === null ? null : new Date(t);
}

// ---- 缺口 ----

export interface GapItem {
  /** 屏 10 的路由参数：gapCode；同一评估里 gapCode 重复时加 ~docType，仍重复再加 ~序号（不用点号：带点的末段在 PWA 里不当导航请求） */
  key: string;
  /** 原始 gapCode（缺失时为 'unknown'） */
  code: string;
  /** 已知的 gapCode，未知为 null（走通用兜底文案） */
  known: GapCode | null;
  docType: string | null;
  severity: string;
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const rank = (s: string) => SEVERITY_RANK[s] ?? 3;

/**
 * 还没解决的缺口（status = open；没写 status 也算没解决，因为看不出已解决），
 * 按轻重（high → medium → low → 其他）再按原顺序排。key 按原顺序生成，不随轻重变化。
 */
export function openGaps(a: AssessmentData): GapItem[] {
  const open = (a.gaps ?? []).filter((g) => g.status === undefined || g.status === 'open');
  const items = open.map((g, index) => {
    const code = typeof g.gapCode === 'string' && g.gapCode ? g.gapCode : 'unknown';
    const docType = typeof g.docType === 'string' && g.docType ? g.docType : null;
    const severity = typeof g.severity === 'string' ? g.severity : '';
    return { code, docType, severity, index };
  });
  const codeCount = new Map<string, number>();
  for (const i of items) codeCount.set(i.code, (codeCount.get(i.code) ?? 0) + 1);

  const seen = new Map<string, number>();
  const keyed = items.map((i) => {
    let key = (codeCount.get(i.code) ?? 0) > 1 ? `${i.code}~${i.docType ?? '-'}` : i.code;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) key = `${key}~${n + 1}`;
    return { key, i };
  });

  return keyed
    .sort((x, y) => rank(x.i.severity) - rank(y.i.severity) || x.i.index - y.i.index)
    .map(({ key, i }) => ({
      key,
      code: i.code,
      known: isGapCode(i.code) ? i.code : null,
      docType: i.docType,
      severity: i.severity,
    }));
}

// ---- 字符串里的数值 ----
// ruleResults 的 expectedValue／actualValue 是给人看的字符串（"3.0400 ha"、"58 天"、"2026-04-30 已过期"）。
// 解析要严格：认不出就返回 null，宁可退回不带数字的句子，也不显示 NaN、0 或错的数。

/** "3.0400 ha"、"3.04" → 3.04；其余（含 "2026-04-30"、负数）→ null */
export function parseHa(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:ha)?\s*$/i.exec(v);
  return m ? Number(m[1]) : null;
}

/** "58 天"、"58 hari"、"58 days" → 58；其余 → null */
export function parseDays(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d+)\s*(?:天|hari|days?)\s*$/i.exec(v);
  return m ? Number(m[1]) : null;
}

const ruleOf = (a: AssessmentData, code: string): RuleResultData | undefined =>
  a.ruleResults?.find((r) => r.ruleCode === code);

// ---- 面积对照（屏 10） ----

export interface AreaCompare {
  /** 地契面积（公顷） */
  geran: number;
  /** 地图量出的面积（公顷） */
  lukisan: number;
  /** lukisan − geran */
  diffHa: number;
  /** |差| ÷ 地契面积，百分数；地契面积为 0 时为 null（不能除） */
  pct: number | null;
}

/** 取评估时的 CC-01 快照（可能与 plots.areaHaComputed 的当前值不同，界面上标了评估日期）。读不全返回 null */
export function areaCompare(a: AssessmentData): AreaCompare | null {
  const rule = ruleOf(a, 'CC-01');
  const geran = parseHa(rule?.expectedValue);
  const lukisan = parseHa(rule?.actualValue);
  if (geran === null || lukisan === null) return null;
  const diffHa = lukisan - geran;
  return {
    geran,
    lukisan,
    diffHa,
    pct: geran > 0 ? Math.round((Math.abs(diffHa) / geran) * 100) : null,
  };
}

/** 「+0.5 ha (31%)」。差小到四舍五入成 0 公顷时返回 null（不显示）；百分比算不出就只写公顷 */
export function formatDiff(c: AreaCompare): string | null {
  const ha = formatArea(Math.abs(c.diffHa), null);
  if (ha === null) return null;
  const sign = c.diffHa > 0 ? '+' : '−';
  return c.pct === null ? `${sign}${ha} ha` : `${sign}${ha} ha (${c.pct}%)`;
}

/** 缺口文案用的数字。只给相关类别取数，别的类别全是 null，避免串味 */
export function gapFacts(a: AssessmentData, gap: GapItem, lang: Lang): GapFacts {
  const facts: GapFacts = { geran: null, lukisan: null, days: null, date: null };
  if (gap.known === 'area_mismatch') {
    const c = areaCompare(a);
    if (c) {
      facts.geran = formatArea(c.geran, null);
      facts.lukisan = formatArea(c.lukisan, null);
    }
  } else if (gap.known === 'expiring' || gap.known === 'expired') {
    // CC-02 每次评估只有一条（合同 UNIQUE (assessment_id, rule_code)），却同时覆盖 MPOB 执照、MSPO 证书等多种文件：
    // 同一评估里不止一件到期类缺口时，分不清它说的是哪一份——宁可不带数字，也不能把别的文件的天数写到这份头上
    const expiry = openGaps(a).filter((g) => g.known === 'expiring' || g.known === 'expired');
    if (expiry.length <= 1) {
      const rule = ruleOf(a, 'CC-02');
      facts.days = parseDays(rule?.actualValue);
      facts.date = formatIsoDay(rule?.actualValue, lang);
    }
  }
  return facts;
}

// ---- 通过的检查 ----

/** 通过的规则编号（去重，保持原顺序）。缺失的规则不算通过 */
export function passedRules(a: AssessmentData): string[] {
  const codes = (a.ruleResults ?? [])
    .filter((r) => r.result === 'pass' && typeof r.ruleCode === 'string' && r.ruleCode)
    .map((r) => r.ruleCode as string);
  return [...new Set(codes)];
}

// ---- 森林初筛 ----

export type ForestNote =
  { kind: 'low' } | { kind: 'loss'; ha: string | null } | { kind: 'unknown' };

/**
 * 只是初筛，不夸大：「没有损失」要风险为 low 且损失明确为 0 才说；
 * 有损失（哪怕风险写 low，数据矛盾）或风险为 medium／high 一律按有损失处理；其余（缺失、unknown、null）不当成 0。
 */
export function forestNote(a: AssessmentData): ForestNote {
  const loss = a.forestLossAfter2020Ha;
  if (typeof loss === 'number' && Number.isFinite(loss) && loss > 0) {
    return { kind: 'loss', ha: formatArea(loss, null) };
  }
  if (a.forestRisk === 'medium' || a.forestRisk === 'high') return { kind: 'loss', ha: null };
  if (a.forestRisk === 'low' && loss === 0) return { kind: 'low' };
  return { kind: 'unknown' };
}
