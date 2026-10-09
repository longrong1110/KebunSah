import { Injectable, computed, signal } from '@angular/core';

// 新建地块的"草稿"：屏 3 三份文档的状态与拍下的照片。
// **只存在本机内存里**：刷新就没了。照片上传和新建地块都要走后端 API，而 contract/api.md 的请求与响应
// 还没定，前端对 Firestore 只读，所以这一轮不做上传、不写库，也不自己发明接口。

/** 取自 contract/status.md 的 documents.doc_type（屏 3 只用前三个）；路由参数 :doc 也用原串 */
export const DOC_TYPES = ['land_title', 'mspo_cert', 'mpob_licence'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const isDocType = (v: unknown): v is DocType =>
  typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v);

/** documents.source 里的两个相关取值 */
export type DocSource = 'camera' | 'gallery';

export type DraftDoc =
  | { status: 'pending' }
  | { status: 'skipped' }
  | { status: 'captured'; blob: Blob; url: string; source: DocSource };

const fresh = (): Record<DocType, DraftDoc> => ({
  land_title: { status: 'pending' },
  mspo_cert: { status: 'pending' },
  mpob_licence: { status: 'pending' },
});

@Injectable({ providedIn: 'root' })
export class DraftService {
  private readonly docs = signal<Record<DocType, DraftDoc>>(fresh());

  /** 外勤替成员新建时，草稿属于哪位成员（只用来返回时带回 ?member；本轮不写库） */
  readonly memberId = signal<string | null>(null);

  /** 三份文档的当前状态，按固定顺序 */
  readonly entries = computed(() => DOC_TYPES.map((type) => ({ type, doc: this.docs()[type] })));

  /** 三张都已拍或已跳过，才能进下一步 */
  readonly allResolved = computed(() =>
    DOC_TYPES.every((t) => this.docs()[t].status !== 'pending'),
  );

  /** 「从相册选」默认给第一张待拍的；没有待拍的就是 null */
  readonly firstPending = computed(
    () => DOC_TYPES.find((t) => this.docs()[t].status === 'pending') ?? null,
  );

  doc(type: DocType): DraftDoc {
    return this.docs()[type];
  }

  /** 点「Tambah tanah」：得到一份全新的草稿 */
  begin(memberId: string | null): void {
    this.reset();
    this.memberId.set(memberId);
  }

  /** 离开流程（回到 /）：清空草稿并撤销所有预览 URL */
  reset(): void {
    for (const t of DOC_TYPES) this.release(this.docs()[t]);
    this.docs.set(fresh());
    this.memberId.set(null);
  }

  /** 屏 4 点了「Guna gambar」：这份文档变已拍；重拍则替换并撤销旧的预览 URL */
  capture(type: DocType, blob: Blob, source: DocSource): void {
    this.release(this.docs()[type]);
    this.docs.update((d) => ({
      ...d,
      [type]: { status: 'captured', blob, url: URL.createObjectURL(blob), source },
    }));
  }

  /** 没有这份文档：跳过。之后由后端评估给出缺口清单，不会卡住 */
  skip(type: DocType): void {
    this.release(this.docs()[type]);
    this.docs.update((d) => ({ ...d, [type]: { status: 'skipped' } }));
  }

  private release(doc: DraftDoc): void {
    if (doc.status === 'captured') URL.revokeObjectURL(doc.url);
  }
}
