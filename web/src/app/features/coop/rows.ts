import type { DocState } from '../../core/firebase/firestore-reader';
import { formatDay, formatYmd, titleCaseName } from '../../core/format';
import type { Dict } from '../../core/i18n/dict.ms';
import type { GapCode } from '../../core/i18n/gap-text';
import type { Lang } from '../../core/i18n/i18n.service';
import type { Load } from '../../core/load-state';
import { matchesQuery } from '../../core/people-search';
import { plotHeading } from '../plots/plot-title';
import type { PersonData, PlotData, PlotItem, TitleData } from '../plots/plot-types';
import {
  assessmentTime,
  bannerKey,
  checkedAt,
  concludedAssessment,
  forestNote,
  latestAssessment,
  openGaps,
  type AssessmentData,
  type AssessmentItem,
  type BannerKey,
  type GapItem,
} from '../result/assessment';
import { gapView } from '../result/gap-view';

// 合作社看板（屏 11）的纯逻辑：把四个订阅读到的东西对成「一块地一行」，再排序、筛选、计数、导出 CSV。
// 行是语言无关的（桶、问题类别、缺口……），文案在 rowTexts() 里按语言生成；表格与 CSV 用同一个函数，所以永远一致。

/** 状态桶，同时就是排序顺序（红色最前）和左栏状态筛选的显示顺序 */
export const BUCKETS = ['red', 'needs_review', 'yellow', 'pending', 'running', 'green'] as const;

/** 问题类型：缺口类别按 gapCode 归并（expired／expiring 同类），再加一个由森林初筛派生的类别（不是缺口） */
export const ISSUE_CATEGORIES = [
  'area',
  'expiry',
  'name',
  'missing',
  'mspo',
  'unclear',
  'forest',
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

const GAP_CATEGORY: Record<GapCode, Exclude<IssueCategory, 'forest'>> = {
  area_mismatch: 'area',
  expired: 'expiry',
  expiring: 'expiry',
  name_mismatch: 'name',
  missing_doc: 'missing',
  not_in_mspo: 'mspo',
  low_confidence: 'unclear',
};

const isBucket = (v: unknown): v is BannerKey =>
  typeof v === 'string' && (BUCKETS as readonly string[]).includes(v);
const isCategory = (v: unknown): v is IssueCategory =>
  typeof v === 'string' && (ISSUE_CATEGORIES as readonly string[]).includes(v);

export interface DashboardRow {
  id: string;
  plot: PlotData;
  /** titles/{landTitleId} 里读到的（对不上为 null） */
  title: TitleData | null;
  /** 词首大写的成员姓名；读不到为 null */
  member: string | null;
  bucket: BannerKey;
  /** 能下结论的评估（有评估且不是还在跑／失败的），否则 null；缺口、森林初筛都只对它显示 */
  concluded: AssessmentData | null;
  /** 未解决的缺口，已按轻重排好 */
  gaps: GapItem[];
  forestLoss: boolean;
  categories: IssueCategory[];
  /** 最新评估的时间，缺则取 plots.lastAssessedAt */
  updated: Date | null;
}

export interface BuildInput {
  plots: readonly PlotItem[];
  /** 订阅到的所有评估（collection group），data.plotId 指向地块；对不上这些地块的忽略 */
  assessments: readonly AssessmentItem[];
  persons: readonly { id: string; data: PersonData }[];
  titles: readonly { id: string; data: TitleData }[];
}

const validDate = (d: unknown): Date | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;

const ASSESSMENT_PATH = /^plots\/([^/]+)\/assessments\/[^/]+$/;

/**
 * 评估属于哪块地：优先看文档路径 plots/{plotId}/assessments/{id}（企划书 §8.9 里评估的权威位置，不依赖字段），
 * 路径没有（测试替身、将来换了摆法）再退回文档里的 plotId 字段（合同的 plot_id）。两者都没有返回 null。
 */
export function plotIdOf(a: AssessmentItem): string | null {
  const fromPath = a.path ? ASSESSMENT_PATH.exec(a.path)?.[1] : undefined;
  if (fromPath) return fromPath;
  return typeof a.data.plotId === 'string' && a.data.plotId ? a.data.plotId : null;
}

/** 一块地一行。每块地取最新一次评估；没有评估是 pending（沿用屏 9 的 bannerKey，不凭 plots.status 下结论） */
export function buildRows(input: BuildInput): DashboardRow[] {
  const byPlot = new Map<string, AssessmentItem[]>();
  for (const a of input.assessments) {
    const plotId = plotIdOf(a);
    if (plotId === null) continue;
    const list = byPlot.get(plotId);
    if (list) list.push(a);
    else byPlot.set(plotId, [a]);
  }
  const names = new Map(input.persons.map((p) => [p.id, p.data.fullName]));
  const titles = new Map(input.titles.map((t) => [t.id, t.data]));

  return input.plots.map((p) => {
    const latest = latestAssessment(byPlot.get(p.id) ?? [])?.data ?? null;
    const concluded = concludedAssessment(latest);
    const gaps = concluded ? openGaps(concluded) : [];
    const forestLoss = concluded ? forestNote(concluded).kind === 'loss' : false;

    const found = new Set<IssueCategory>();
    for (const g of gaps) if (g.known) found.add(GAP_CATEGORY[g.known]);
    if (forestLoss) found.add('forest');

    const name = p.data.operatorPersonId ? names.get(p.data.operatorPersonId) : undefined;
    const time = latest ? (checkedAt(latest) ?? timeToDate(assessmentTime(latest))) : null;

    return {
      id: p.id,
      plot: p.data,
      title: p.data.landTitleId ? (titles.get(p.data.landTitleId) ?? null) : null,
      member: typeof name === 'string' && name.trim() ? titleCaseName(name) : null,
      bucket: bannerKey(latest),
      concluded,
      gaps,
      forestLoss,
      categories: ISSUE_CATEGORIES.filter((c) => found.has(c)),
      updated: time ?? validDate(p.data.lastAssessedAt),
    };
  });
}

const timeToDate = (t: number | null): Date | null => (t === null ? null : new Date(t));

/** 红色最前（red → needs_review → yellow → pending → running → green）；同桶按时间新→旧，没有时间的排最后，再按 id */
export function sortRows(rows: readonly DashboardRow[]): DashboardRow[] {
  const order = (b: BannerKey) => BUCKETS.indexOf(b);
  return [...rows].sort((a, b) => {
    if (a.bucket !== b.bucket) return order(a.bucket) - order(b.bucket);
    const ta = a.updated?.getTime() ?? null;
    const tb = b.updated?.getTime() ?? null;
    if (ta !== null && tb !== null && ta !== tb) return tb - ta;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    return a.id.localeCompare(b.id);
  });
}

// ---- 筛选 ----

export interface DashboardFilter {
  /** 状态单选；null = 全部 */
  status: BannerKey | null;
  /** 问题类型多选：同类 OR（地块有其中任一类未解决的问题） */
  issues: IssueCategory[];
  /** 成员姓名搜索 */
  q: string;
}

export const EMPTY_FILTER: DashboardFilter = { status: null, issues: [], q: '' };

export const isFilterEmpty = (f: DashboardFilter) =>
  f.status === null && f.issues.length === 0 && f.q.trim() === '';

/** 状态、问题类型、成员三类条件 AND；成员名读不到的地块搜不到（也不泄露 id） */
export function filterRows(rows: readonly DashboardRow[], f: DashboardFilter): DashboardRow[] {
  return rows.filter(
    (r) =>
      (f.status === null || r.bucket === f.status) &&
      (f.issues.length === 0 || f.issues.some((i) => r.categories.includes(i))) &&
      matchesQuery(r.member ?? '', f.q),
  );
}

/** 每个桶有多少块地（恒为全部，不随筛选联动） */
export function countBuckets(rows: readonly DashboardRow[]): Record<BannerKey, number> {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<BannerKey, number>;
  for (const r of rows) out[r.bucket]++;
  return out;
}

/** 每类问题涉及多少块地 */
export function countIssues(rows: readonly DashboardRow[]): Record<IssueCategory, number> {
  const out = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c, 0])) as Record<
    IssueCategory,
    number
  >;
  for (const r of rows) for (const c of r.categories) out[c]++;
  return out;
}

/** 查询参数 → 筛选条件。非法值（未知状态、未知类别）忽略，类别去重并按固定顺序 */
export function parseFilter(get: (key: string) => string | null): DashboardFilter {
  const status = get('status');
  const wanted = new Set(
    (get('issue') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(isCategory),
  );
  return {
    status: isBucket(status) ? status : null,
    issues: ISSUE_CATEGORIES.filter((c) => wanted.has(c)),
    q: (get('q') ?? '').slice(0, 100),
  };
}

/** 筛选条件 → 查询参数（空值为 null，navigate 时会从地址里去掉） */
export function filterToParams(f: DashboardFilter): {
  status: string | null;
  issue: string | null;
  q: string | null;
} {
  return {
    status: f.status,
    // 按固定顺序输出，同一组条件永远得到同一个地址
    issue: f.issues.length ? ISSUE_CATEGORIES.filter((c) => f.issues.includes(c)).join(',') : null,
    q: f.q.trim() ? f.q : null,
  };
}

// ---- 文案 ----

/** 状态标签：沿用词典的 status（Lengkap／Perlu semakan／Perlu tindakan／…）；「检查中」是线框外的状态 */
export function bucketLabel(t: Dict, key: BannerKey): string {
  return key === 'running' ? t.result.banner.running.headline : t.status[key];
}

/** 行标题：规则同屏 2 的卡片（Lot {lotNo}, {district}／Lot baharu／回退） */
export function rowHeading(t: Dict, row: DashboardRow): string {
  const load: Load<DocState<TitleData>> | null = row.plot.landTitleId
    ? {
        kind: 'data',
        value: { id: row.plot.landTitleId, data: row.title, fromCache: false },
        fromCache: false,
      }
    : null;
  return plotHeading(t, row.plot, load).heading ?? t.plots.notFilled;
}

/** 主问题：最重的未解决缺口（多于一件带「+n」）；没有缺口但森林初筛有损失，就写森林；都没有为 null */
export function mainIssue(
  t: Dict,
  lang: Lang,
  row: DashboardRow,
): { text: string; more: number } | null {
  const first = row.gaps[0];
  if (first && row.concluded) {
    return { text: gapView(t, lang, row.concluded, first).title, more: row.gaps.length - 1 };
  }
  return row.forestLoss ? { text: t.coop.forestIssue, more: 0 } : null;
}

export interface RowTexts {
  plot: string;
  district: string;
  member: string | null;
  status: string;
  /** 「Keluasan tidak sepadan」，多于一件时「Keluasan tidak sepadan (+1)」 */
  mainIssue: string | null;
  /** 「3 Okt」 */
  updated: string | null;
  /** 「2026-10-03」 */
  updatedYmd: string | null;
}

export function rowTexts(t: Dict, lang: Lang, row: DashboardRow): RowTexts {
  const main = mainIssue(t, lang, row);
  return {
    plot: rowHeading(t, row),
    district: row.title?.district ?? row.plot.district ?? '',
    member: row.member,
    status: bucketLabel(t, row.bucket),
    mainIssue: main ? (main.more > 0 ? `${main.text} (+${main.more})` : main.text) : null,
    updated: formatDay(row.updated, lang),
    updatedYmd: formatYmd(row.updated),
  };
}

// ---- CSV ----

const FORMULA_START = /^[=+\-@\t\r]/;
/** UTF-8 的 BOM（U+FEFF）：用码点构造，免得源码里的不可见字符被编辑器或格式化工具误删 */
const BOM = String.fromCharCode(0xfeff);

/**
 * 一个 CSV 单元格：以 = + - @ Tab CR 开头的文本前面加 '（防公式注入：Excel 会把它们当公式执行，
 * 而成员姓名、地块标题都来自数据库，不能信）；含逗号、引号、换行的加引号并把引号写两遍（RFC 4180）。
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 带 BOM（Excel 才认中文／马来语的重音），CRLF 换行，末尾带一个换行 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/**
 * 看板「Export summary (CSV)」的内容：当前筛选后的表格。列：Plot、District、Member、Status、Main issue、Updated。
 * **永不含**证件信息、评估说明文字、plotId、gapCode；成员姓名是表格里本来就有的。
 */
export function summaryCsv(t: Dict, lang: Lang, rows: readonly DashboardRow[]): string {
  const c = t.coop.csv;
  const body = rows.map((r) => {
    const x = rowTexts(t, lang, r);
    return [x.plot, x.district, x.member ?? '', x.status, x.mainIssue ?? '', x.updatedYmd ?? ''];
  });
  return toCsv([c.plot, c.district, c.member, c.status, c.mainIssue, c.updated], body);
}
