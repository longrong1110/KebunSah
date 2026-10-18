// 屏 8「确认字段」的纯逻辑：从 plots/{id}/documents 里挑出「读不准、还没人确认」的字段，按文件分组，算出要提交的值。
// 阈值与后端一致（core/params：confidence_min = 0.7，四舍五入到百分之一再比）。

export const CONFIDENCE_MIN = 0.7;

export interface ConfirmFieldData {
  rawText?: unknown;
  normalizedValue?: unknown;
  confidence?: unknown;
  confirmedValue?: unknown;
}

export interface ConfirmDocument {
  docType?: string;
  pageNo?: number;
  /** 重拍后旧文件是 false，不再看 */
  isCurrent?: boolean;
  fields?: Record<string, ConfirmFieldData | null>;
}

export type FieldKind = 'date' | 'area' | 'text';

export interface UnsureField {
  documentId: string;
  docType: string;
  pageNo: number;
  key: string;
  /** 纸面上的原文（后端已把身份证号打码） */
  rawText: string;
  /** 读出的值（输入框的初始值）；读不出来是空串 */
  value: string;
  kind: FieldKind;
}

export interface DocGroup {
  documentId: string;
  docType: string;
  pageNo: number;
  fields: UnsureField[];
}

const DOC_ORDER = ['land_title', 'mpob_licence', 'mspo_cert', 'mspo_member_list'];
const DATE_KEYS = new Set([
  'land_title.lease_expiry',
  'mpob_licence.valid_until',
  'mspo_cert.expiry_date',
]);
const MAX_RAW = 200;

export function fieldKind(key: string): FieldKind {
  if (DATE_KEYS.has(key)) return 'date';
  return key === 'land_title.area_value' ? 'area' : 'text';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 没人确认过、且读出置信度低于 0.7（或根本不是正常的数）的字段 */
function isUnsure(f: ConfirmFieldData): boolean {
  if (str(f.confirmedValue) !== '') return false;
  const c = f.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c)) return true;
  return Math.floor(c * 100 + 0.5) < Math.floor(CONFIDENCE_MIN * 100 + 0.5);
}

const docRank = (t: string): number => {
  const i = DOC_ORDER.indexOf(t);
  return i === -1 ? DOC_ORDER.length : i;
};

export function unsureFields(
  docs: readonly { id: string; data: ConfirmDocument | null }[],
): UnsureField[] {
  const out: UnsureField[] = [];
  for (const { id, data } of docs) {
    if (
      !data ||
      data.isCurrent === false ||
      typeof data.fields !== 'object' ||
      data.fields === null
    )
      continue;
    const docType = typeof data.docType === 'string' ? data.docType : '';
    const pageNo =
      typeof data.pageNo === 'number' && Number.isFinite(data.pageNo) ? data.pageNo : 1;
    for (const [key, f] of Object.entries(data.fields)) {
      if (!f || typeof f !== 'object' || !isUnsure(f)) continue;
      out.push({
        documentId: id,
        docType,
        pageNo,
        key,
        rawText: str(f.rawText).slice(0, MAX_RAW),
        value: str(f.normalizedValue),
        kind: fieldKind(key),
      });
    }
  }
  return out.sort(
    (a, b) =>
      docRank(a.docType) - docRank(b.docType) ||
      a.pageNo - b.pageNo ||
      a.documentId.localeCompare(b.documentId) ||
      a.key.localeCompare(b.key, undefined, { numeric: true }),
  );
}

export function groupByDocument(fields: readonly UnsureField[]): DocGroup[] {
  const groups = new Map<string, DocGroup>();
  for (const f of fields) {
    let g = groups.get(f.documentId);
    if (!g) {
      g = { documentId: f.documentId, docType: f.docType, pageNo: f.pageNo, fields: [] };
      groups.set(f.documentId, g);
    }
    g.fields.push(f);
  }
  return [...groups.values()];
}

/** 输入框状态的键 */
export const editKey = (f: Pick<UnsureField, 'documentId' | 'key'>): string =>
  `${f.documentId}|${f.key}`;

/** 要提交的内容：每个文件一份 { 字段键: 值 }；值取用户改过的，没改就是读出的值（等于「这些都对」）。两端去空白 */
export function toSubmit(
  groups: readonly DocGroup[],
  edits: Readonly<Record<string, string>>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const g of groups) {
    out[g.documentId] = Object.fromEntries(
      g.fields.map((f) => [f.key, (edits[editKey(f)] ?? f.value).trim()]),
    );
  }
  return out;
}

/** 有没有空值（空的不能提交：后端会拒绝，先在这里拦住） */
export function hasEmpty(payload: Record<string, Record<string, string>>): boolean {
  return Object.values(payload).some((fields) => Object.values(fields).some((v) => v === ''));
}
