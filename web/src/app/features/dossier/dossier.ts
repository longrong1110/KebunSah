import { formatArea, formatIsoDay, formatYmd, titleCaseName } from '../../core/format';
import type { Dict } from '../../core/i18n/dict.ms';
import type { Lang } from '../../core/i18n/i18n.service';
import type { PersonData, PlotData, TitleData } from '../plots/plot-types';
import {
  areaCompare,
  bannerKey,
  checkedAt,
  concludedAssessment,
  forestNote,
  latestAssessment,
  openGaps,
  parseDays,
  type AssessmentData,
  type AssessmentItem,
  type BannerKey,
  worstResult,
} from '../result/assessment';
import { bannerLook } from '../result/banner-look';
import { forestLine, gapView } from '../result/gap-view';
import { parseRing, toSvgPoints } from '../result/polygon';

// 档案页（导出 PDF）的版面数据。buildDossier 把读到的原始文档变成「语言已经生成好」的段落与表格行，
// 模板只负责排版。隐私约束集中在这一个函数里（档案会离开系统）：
// 只用解析出的数字和词典造句，不读 ruleResults 的原始数值字符串、detail，gaps 的 description／suggestedAction／citation，
// summaryText、evidence，成员的证件信息，文档的存储路径与哈希，MSPO 证书的持有人名称；
// 自由文本字段（地契、成员、合作社名等）还要过 cleanText，含中文占位的整段丢掉。

export interface DossierDocument {
  docType?: string;
  pageNo?: number;
  isCurrent?: boolean;
  extractionStatus?: string;
}

export interface MpobLicenceData {
  licenceNo?: string | null;
  /** YYYY-MM-DD 字符串（种子的日期列保持字符串） */
  validUntil?: string | Date | null;
}

export interface MspoCertificateData {
  certNo?: string | null;
  expiryDate?: string | Date | null;
}

export interface DossierInput {
  plot: PlotData;
  /** null = 地契读不到或确认不存在 */
  title: TitleData | null;
  person: PersonData | null;
  coop: { name?: string | null } | null;
  mpob: MpobLicenceData | null;
  mspo: MspoCertificateData | null;
  assessments: readonly AssessmentItem[];
  documents: readonly DossierDocument[];
  generatedAt: Date;
}

export const DASH = '—';
/** 顶点表最多列这么多行，其余写「…dan n lagi」 */
export const MAX_VERTICES = 50;

const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const MAX_TEXT = 80;

/**
 * 自由文本字段能不能进档案：先去掉含中文的括号段（种子的「Koperasi … (虚构)」），
 * 剩下仍有中文、为空、或过长就不用。返回清理后的文字或 null。
 */
export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const stripped = value
    .replace(/\s*[(（][^)）]*[㐀-鿿豈-﫿][^)）]*[)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped || stripped.length > MAX_TEXT || CJK.test(stripped)) return null;
  return stripped;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---- 页头 ----

export interface DossierHeader {
  title: string;
  heading: string;
  generatedOn: string | null;
  coop: string | null;
  synthetic: string | null;
}

/**
 * 地块标题：有地契 → Lot {lotNo}, {daerah}；地契读不到 → plots 上复制的 titleNo + daerah；都没有 → Belum diisi；
 * 没登记地契 → Lot baharu。**不用 nickname**（像「Kebun Arwah Ayah」会带出对第三人的推断，档案要离开系统）。
 */
function headingOf(t: Dict, plot: PlotData, title: TitleData | null): string {
  if (!plot.landTitleId) return t.plots.newLot;
  const lot = cleanText(title?.lotNo);
  const district = cleanText(title?.district) ?? cleanText(plot.district) ?? '';
  if (lot) return t.plots.lot(lot, district);
  const fallback = [cleanText(plot.titleNo), cleanText(plot.district)].filter(Boolean).join(', ');
  return fallback || t.plots.notFilled;
}

// ---- 信息表 ----

export interface InfoRow {
  key: string;
  label: string;
  value: string;
}

function infoRows(t: Dict, input: DossierInput): InfoRow[] {
  const { plot, title, person, coop } = input;
  const l = t.dossier.labels;
  const area = formatArea(plot.areaHaComputed, plot.areaHaDeclared);
  const name = cleanText(person?.fullName);
  const planted = plot.oilPalmPlantedYear;
  const tenure = typeof title?.tenure === 'string' ? t.dossier.tenure(title.tenure) : null;
  const landUse =
    typeof title?.landUseCategory === 'string' ? t.dossier.landUse(title.landUseCategory) : null;
  const country = cleanText(plot.countryCode);

  const rows: [string, string, string | null][] = [
    ['lot', l.lot, cleanText(title?.lotNo)],
    ['titleNo', l.titleNo, cleanText(title?.titleNo) ?? cleanText(plot.titleNo)],
    ['mukim', l.mukim, cleanText(title?.mukim)],
    ['district', l.district, cleanText(title?.district) ?? cleanText(plot.district)],
    ['state', l.state, cleanText(title?.state) ?? cleanText(plot.state)],
    ['country', l.country, country ? t.dossier.country(country) : null],
    ['operator', l.operator, name ? titleCaseName(name) : null],
    ['coop', l.coop, cleanText(coop?.name)],
    ['area', l.area, area ? t.plots.areaHa(area) : null],
    [
      'planted',
      l.planted,
      finite(planted) && Number.isInteger(planted) && planted >= 1900 && planted <= 2100
        ? String(planted)
        : null,
    ],
    ['tenure', l.tenure, tenure],
    ['landUse', l.landUse, landUse],
    ['boundaryDate', l.boundaryDate, formatYmd(plot.geometryRecordedAt)],
  ];
  return rows.map(([key, label, value]) => ({ key, label, value: value ?? DASH }));
}

// ---- 位置 ----

export interface VertexRow {
  no: number;
  lat: string;
  lng: string;
}

export interface LocationView {
  centroid: string | null;
  vertices: VertexRow[];
  /** 「…dan n lagi」，顶点没超过上限时为 null */
  more: string | null;
  /** 内联 SVG 的 points；多边形缺失或坏了为 null */
  svgPoints: string | null;
  /** 一个坐标都没有 */
  empty: boolean;
}

export const SVG_WIDTH = 240;
export const SVG_HEIGHT = 140;

function locationView(t: Dict, plot: PlotData): LocationView {
  const lat = plot.centroidLat;
  const lng = plot.centroidLng;
  const centroid =
    finite(lat) && finite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
      : null;
  const ring = parseRing(plot.polygonGeojson);
  const vertices = (ring ?? [])
    .slice(0, MAX_VERTICES)
    .map(([x, y], i): VertexRow => ({ no: i + 1, lat: y.toFixed(6), lng: x.toFixed(6) }));
  const extra = ring ? ring.length - MAX_VERTICES : 0;
  return {
    centroid,
    vertices,
    more: extra > 0 ? t.dossier.location.more(extra) : null,
    svgPoints: ring ? toSvgPoints(ring, SVG_WIDTH, SVG_HEIGHT) : null,
    empty: centroid === null && ring === null,
  };
}

// ---- 摘要 ----

export interface SummaryView {
  key: BannerKey;
  icon: string;
  tone: string;
  headline: string;
  sub: string;
  checkedOn: string | null;
}

// ---- 规则 ----

export interface RuleRow {
  /** 只有 CC-01／02／03 保留原编号；别的是后端写的任意字符串，换成序号，不进档案（与缺口同理） */
  code: string;
  name: string;
  label: string;
  icon: string;
  tone: string;
  /** 只用解析出的数字和词典造的一句话；解析不出就是 null */
  sentence: string | null;
}

type RuleResult = 'pass' | 'warn' | 'fail' | 'needs_review';

const RULE_LOOK: Record<RuleResult, { icon: string; tone: string }> = {
  pass: { icon: '✓', tone: 'ok' },
  warn: { icon: '⚠', tone: 'warn' },
  fail: { icon: '✕', tone: 'bad' },
  needs_review: { icon: '?', tone: 'review' },
};

/** 不认识的结果当「需复核」：不能被误当成通过 */
const resultOf = (v: unknown): RuleResult =>
  v === 'pass' || v === 'warn' || v === 'fail' ? v : 'needs_review';

function ruleSentence(
  t: Dict,
  lang: Lang,
  a: AssessmentData,
  code: string,
  result: RuleResult,
): string | null {
  const rows = (a.ruleResults ?? []).filter((r) => r.ruleCode === code);
  let rule: (typeof rows)[number] | undefined = rows[0];
  if (code === 'CC-01') {
    const c = areaCompare(a);
    const geran = c ? formatArea(c.geran, null) : null;
    const lukisan = c ? formatArea(c.lukisan, null) : null;
    return geran && lukisan ? t.dossier.rules.area(geran, lukisan) : null;
  }
  if (code === 'CC-02') {
    // 后端的 CC-02 每份文件一条（带 docType）；种子里只有一条却覆盖多份文件。
    // 到期类缺口不止一件时，分不清数字属于哪一份，宁可不写（与 gapFacts 同一条规则）；只有一件时取那一份的行
    const expiry = openGaps(a).filter((g) => g.known === 'expiring' || g.known === 'expired');
    if (expiry.length > 1) return null;
    const docType = expiry[0]?.docType;
    if (docType)
      rule =
        rows.find((r) => r.docType === docType) ??
        (rows.every((r) => !r.docType) ? rows[0] : undefined);
    const days = parseDays(rule?.actualValue);
    if (days !== null) return t.dossier.rules.validityDays(days);
    const date = formatIsoDay(rule?.actualValue, lang);
    return date ? t.dossier.rules.validityDate(date) : null;
  }
  if (code === 'CC-03') return t.dossier.rules.nameResult[result];
  return null;
}

const KNOWN_RULES = ['CC-01', 'CC-02', 'CC-03'];

function ruleRows(t: Dict, lang: Lang, a: AssessmentData): RuleRow[] {
  const seen = new Set<string>();
  const rows: RuleRow[] = [];
  for (const r of a.ruleResults ?? []) {
    const code = typeof r.ruleCode === 'string' ? r.ruleCode : '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const result = resultOf(worstResult(a, code)); // 同一编号有几行（CC-02 每份文件一行）时取最重的
    rows.push({
      code: KNOWN_RULES.includes(code) ? code : `rule-${rows.length + 1}`,
      name: t.dossier.rules.name(code),
      label: t.dossier.rules.result[result],
      ...RULE_LOOK[result],
      sentence: ruleSentence(t, lang, a, code, result),
    });
  }
  return rows;
}

// ---- 缺口 ----

/** 不带 gapCode／key：未知的 gapCode 是后端写的任意字符串，不该进档案 */
export interface OpenItem {
  title: string;
  detail: string;
  advice: string;
}

// ---- 森林 ----

export interface ForestView {
  line: string;
  prelim: string;
  cover: string | null;
  loss: string | null;
}

/** 最多 2 位小数、去尾零；0 是合法值（写「0」）；不是数字或越界返回 null（null 不当 0） */
function plain(v: unknown, max: number): string | null {
  if (!finite(v) || v < 0 || v > max) return null;
  return String(Math.round(v * 100) / 100);
}

function forestView(t: Dict, a: AssessmentData): ForestView {
  const note = forestNote(a);
  const cover = plain(a.forestCover2020Pct, 100);
  const loss = plain(a.forestLossAfter2020Ha, Number.MAX_SAFE_INTEGER);
  return {
    line: forestLine(t, note),
    prelim: t.result.forest.prelim,
    cover: cover === null ? null : t.dossier.forest.cover(cover),
    // 风险没写（unknown）时一句话是「belum dapat disemak」，再写「损失 0 ha」会自相矛盾：不写这行
    loss: loss === null || note.kind === 'unknown' ? null : t.dossier.forest.loss(loss),
  };
}

// ---- 文件 ----

export interface DocRow {
  type: string;
  name: string;
  pages: string;
  status: string | null;
  detail: string | null;
}

const DOC_ORDER = ['land_title', 'mpob_licence', 'mspo_cert', 'mspo_member_list'] as const;

/** 有 failed → failed，有 needs_review → needs_review，全部 extracted → extracted，否则不写 */
function aggregateStatus(
  docs: readonly DossierDocument[],
): 'extracted' | 'needs_review' | 'failed' | null {
  if (docs.some((d) => d.extractionStatus === 'failed')) return 'failed';
  if (docs.some((d) => d.extractionStatus === 'needs_review')) return 'needs_review';
  if (docs.length > 0 && docs.every((d) => d.extractionStatus === 'extracted')) return 'extracted';
  return null;
}

/** 日期列在种子里是 YYYY-MM-DD 字符串；真实后端若写成 Timestamp（读层转成 Date），也照样显示 */
const isoDay = (v: unknown): string | null =>
  v instanceof Date ? formatYmd(v) : typeof v === 'string' ? v : null;

function docRows(t: Dict, lang: Lang, input: DossierInput): DocRow[] {
  const rows: DocRow[] = [];
  for (const type of DOC_ORDER) {
    const current = input.documents.filter((d) => d.docType === type && d.isCurrent !== false);
    if (current.length === 0) continue;
    const status = aggregateStatus(current);

    let detail: string | null = null;
    if (type === 'mpob_licence') {
      detail =
        t.dossier.docs.licence(
          cleanText(input.mpob?.licenceNo),
          formatIsoDay(isoDay(input.mpob?.validUntil), lang),
        ) || null;
    } else if (type === 'mspo_cert') {
      detail =
        t.dossier.docs.cert(
          cleanText(input.mspo?.certNo),
          formatIsoDay(isoDay(input.mspo?.expiryDate), lang),
        ) || null;
    }

    rows.push({
      type,
      name: t.result.docName(type),
      pages: t.dossier.docs.pages(current.length),
      status: status ? t.dossier.docs.status[status] : null,
      detail,
    });
  }
  return rows;
}

// ---- 汇总 ----

export interface DossierModel {
  header: DossierHeader;
  summary: SummaryView;
  info: InfoRow[];
  location: LocationView;
  /** 有结论才有下面三段；没有评估／还在检查／失败时为 null，页面不写任何结论 */
  checks: RuleRow[] | null;
  open: OpenItem[] | null;
  forest: ForestView | null;
  documents: DocRow[];
  disclaimer: string;
}

export function buildDossier(t: Dict, lang: Lang, input: DossierInput): DossierModel {
  const latest = latestAssessment(input.assessments)?.data ?? null;
  const key = bannerKey(latest);
  const done = concludedAssessment(latest);

  const gaps = done ? openGaps(done) : [];
  const open: OpenItem[] | null = done
    ? gaps.map((g) => {
        const v = gapView(t, lang, done, g);
        return { title: v.title, detail: v.detail, advice: v.advice };
      })
    : null;

  const checkedDate = done ? checkedAt(done) : null;
  const day = checkedDate ? formatIsoDay(formatYmd(checkedDate), lang) : null;
  const banner = t.result.banner[key];

  return {
    header: {
      title: t.dossier.title,
      heading: headingOf(t, input.plot, input.title),
      generatedOn: formatYmd(input.generatedAt)
        ? t.dossier.generatedOn(formatYmd(input.generatedAt) as string)
        : null,
      coop: cleanText(input.coop?.name),
      synthetic: input.plot.isSynthetic === true ? t.dossier.synthetic : null,
    },
    summary: {
      key,
      ...bannerLook(key),
      headline: banner.headline,
      sub: key === 'pending' ? t.dossier.notChecked : banner.sub(gaps.length),
      checkedOn: day ? t.result.checkedOn(day) : null,
    },
    info: infoRows(t, input),
    location: locationView(t, input.plot),
    checks: done ? ruleRows(t, lang, done) : null,
    open,
    forest: done ? forestView(t, done) : null,
    documents: docRows(t, lang, input),
    disclaimer: t.dossier.disclaimer,
  };
}
