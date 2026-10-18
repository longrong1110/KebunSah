import { Injectable, computed, signal } from '@angular/core';
import { GeometryDraft, LngLat, MapTab, Ring, evaluate } from './geometry';

// 新建地块的"草稿"：屏 3 三份文档的状态与拍下的照片，屏 5 圈出的地块（各页签的输入与当前页签的结果）。
// **只存在本机内存里**：刷新就没了。屏 6「开始检查」才把它们交给后端（SubmitService）；
// 提交到一半失败时，已经建好的地块和已传好的照片记在这里，重试不会重复建、重复传。

/** 取自 contract/status.md 的 documents.doc_type（屏 3 只用前三个）；路由参数 :doc 也用原串 */
export const DOC_TYPES = ['land_title', 'mspo_cert', 'mpob_licence'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const isDocType = (v: unknown): v is DocType =>
  typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v);

/** documents.source 里的两个相关取值 */
export type DocSource = 'camera' | 'gallery';

/** 一份文件最多几页（后端 pageNo 的上限也是 4） */
export const MAX_PAGES = 4;

export interface DraftPage {
  blob: Blob;
  /** 预览用的 blob URL，不用了要撤销 */
  url: string;
  source: DocSource;
}

export type DraftDoc =
  | { status: 'pending' }
  | { status: 'skipped' }
  // blob／url／source 是第一页（老代码按「一份文件一张照片」读的就是它）；pages 是全部页，按顺序
  | { status: 'captured'; blob: Blob; url: string; source: DocSource; pages: DraftPage[] };

const captured = (pages: DraftPage[]): DraftDoc => ({
  status: 'captured',
  blob: pages[0].blob,
  url: pages[0].url,
  source: pages[0].source,
  pages,
});

const fresh = (): Record<DocType, DraftDoc> => ({
  land_title: { status: 'pending' },
  mspo_cert: { status: 'pending' },
  mpob_licence: { status: 'pending' },
});

const freshGeometry = (): GeometryDraft => ({
  tab: 'map',
  mapRing: [],
  walkRing: [],
  point: null,
  declared: '',
});

@Injectable({ providedIn: 'root' })
export class DraftService {
  private readonly docs = signal<Record<DocType, DraftDoc>>(fresh());
  private readonly geo = signal<GeometryDraft>(freshGeometry());

  /** 外勤替成员新建时，草稿属于哪位成员（带回 ?member，提交时作为 memberId） */
  readonly memberId = signal<string | null>(null);

  /** 提交进度之一：后端已经建好的地块 id（重试不再新建）。草稿重新开始时清掉 */
  readonly plotId = signal<string | null>(null);

  /** 提交进度之二：已经传到后端的照片，键是「文件类型#第几页」（按 Blob 本身认，换了照片就是另一个 Blob，会重新上传） */
  readonly uploaded = new Map<string, Blob>();

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

  /** 这份文件已拍的所有页（没拍是空表） */
  pagesOf(type: DocType): readonly DraftPage[] {
    const d = this.docs()[type];
    return d.status === 'captured' ? d.pages : [];
  }

  // ---- 屏 5：圈地块。几何只存中性的 [经度, 纬度]，以后接 API 时再映射成合同字段 ----

  /** 各页签的工作状态（页签切换不丢各自的输入） */
  readonly geometryDraft = this.geo.asReadonly();

  /** 当前页签能不能完成、为什么不能、面积是多少 */
  readonly evaluation = computed(() => evaluate(this.geo()));

  /** 当前页签可以完成时的结果（屏 5「Selesai」与占位页读它），否则 null */
  readonly geometry = computed(() => this.evaluation().geometry);

  setTab(tab: MapTab): void {
    this.geo.update((g) => (g.tab === tab ? g : { ...g, tab }));
  }

  /** A 页签点一下、B 页签记一个角点：加到 ring 末尾 */
  addVertex(tab: 'map' | 'walk', p: LngLat): void {
    this.geo.update((g) =>
      tab === 'map' ? { ...g, mapRing: [...g.mapRing, p] } : { ...g, walkRing: [...g.walkRing, p] },
    );
  }

  /** 拖动 A 页签的把手：第 index 个顶点换位置；下标越界忽略 */
  moveVertex(index: number, p: LngLat): void {
    this.geo.update((g) => {
      if (!Number.isInteger(index) || index < 0 || index >= g.mapRing.length) return g;
      const ring: Ring = g.mapRing.map((v, i) => (i === index ? p : v));
      return { ...g, mapRing: ring };
    });
  }

  /** 「Padam titik」：撤销当前页签最后放的一个点（C 页签是清掉那个点，手填面积保留） */
  removeLast(): void {
    this.geo.update((g) => {
      if (g.tab === 'map') return { ...g, mapRing: g.mapRing.slice(0, -1) };
      if (g.tab === 'walk') return { ...g, walkRing: g.walkRing.slice(0, -1) };
      return { ...g, point: null };
    });
  }

  /** 当前页签有没有可以撤销的点 */
  readonly canUndo = computed(() => {
    const g = this.geo();
    return g.tab === 'map'
      ? g.mapRing.length > 0
      : g.tab === 'walk'
        ? g.walkRing.length > 0
        : g.point !== null;
  });

  setPoint(p: LngLat | null): void {
    this.geo.update((g) => ({ ...g, point: p }));
  }

  setDeclared(text: string): void {
    this.geo.update((g) => (g.declared === text ? g : { ...g, declared: text }));
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
    this.geo.set(freshGeometry());
    this.memberId.set(null);
    this.plotId.set(null);
    this.uploaded.clear();
  }

  /** 这份文档只有这一张照片：替换掉原来所有页并撤销旧的预览 URL（一张照片的旧用法；加页用 addPage） */
  capture(type: DocType, blob: Blob, source: DocSource): void {
    this.release(this.docs()[type]);
    this.docs.update((d) => ({
      ...d,
      [type]: captured([{ blob, url: URL.createObjectURL(blob), source }]),
    }));
  }

  /** 屏 3／屏 4：给这份文件加一页（最多 MAX_PAGES 页）。已经满了返回 false，什么都不做 */
  addPage(type: DocType, blob: Blob, source: DocSource): boolean {
    const pages = this.pagesOf(type);
    if (pages.length >= MAX_PAGES) return false;
    const page: DraftPage = { blob, url: URL.createObjectURL(blob), source };
    this.docs.update((d) => ({ ...d, [type]: captured([...pages, page]) }));
    return true;
  }

  /** 撤掉第 index 页（拍错了、不想要了）：撤销预览 URL；一页都不剩就回到「待拍」。下标越界忽略 */
  removePage(type: DocType, index: number): void {
    const pages = this.pagesOf(type);
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) return;
    URL.revokeObjectURL(pages[index].url);
    const rest = pages.filter((_, i) => i !== index);
    this.docs.update((d) => ({
      ...d,
      [type]: rest.length > 0 ? captured(rest) : { status: 'pending' },
    }));
  }

  /** 没有这份文档：跳过。之后由后端评估给出缺口清单，不会卡住 */
  skip(type: DocType): void {
    this.release(this.docs()[type]);
    this.docs.update((d) => ({ ...d, [type]: { status: 'skipped' } }));
  }

  private release(doc: DraftDoc): void {
    if (doc.status === 'captured') for (const p of doc.pages) URL.revokeObjectURL(p.url);
  }
}
