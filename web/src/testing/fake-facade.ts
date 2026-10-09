import type { ComponentFixture } from '@angular/core/testing';
import type {
  EqualityFilter,
  FirestoreFacade,
  RawDoc,
} from '../app/core/firebase/firestore-facade';

// 测试用的假 Firestore facade：按路径记录监听，按需发快照，并能数出还有几个监听没取消。
type CollNext = Parameters<FirestoreFacade['watchCollection']>[1];
type DocNext = Parameters<FirestoreFacade['watchDoc']>[1];

interface Watcher<N> {
  path: string;
  next: N;
  error: (err: unknown) => void;
  active: boolean;
  filters?: readonly EqualityFilter[];
}

const lastSegment = (path: string) => path.split('/').pop() ?? '';
const sameFilters = (a?: readonly EqualityFilter[], b?: readonly EqualityFilter[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export class FakeFacade implements FirestoreFacade {
  readonly collections: Watcher<CollNext>[] = [];
  readonly docs: Watcher<DocNext>[] = [];

  watchCollection(
    path: string,
    next: CollNext,
    error: (err: unknown) => void,
    filters?: readonly EqualityFilter[],
  ): () => void {
    const w: Watcher<CollNext> = { path, next, error, filters, active: true };
    this.collections.push(w);
    return () => (w.active = false);
  }

  watchDoc(path: string, next: DocNext, error: (err: unknown) => void): () => void {
    const w: Watcher<DocNext> = { path, next, error, active: true };
    this.docs.push(w);
    return () => (w.active = false);
  }

  /** 还没取消的监听数（集合＋文档） */
  get activeCount(): number {
    return (
      this.collections.filter((w) => w.active).length + this.docs.filter((w) => w.active).length
    );
  }

  activeCollections(path?: string): Watcher<CollNext>[] {
    return this.collections.filter((w) => w.active && (path === undefined || w.path === path));
  }

  activeDocs(path?: string): Watcher<DocNext>[] {
    return this.docs.filter((w) => w.active && (path === undefined || w.path === path));
  }

  /** 给某个文档路径的所有活跃监听发快照。data 为 null 表示文档不存在 */
  emitDoc(path: string, data: Record<string, unknown> | null, fromCache = false): void {
    for (const w of this.activeDocs(path)) {
      const doc: RawDoc = { id: lastSegment(path), data: data ?? undefined };
      w.next({ exists: data !== null, doc, fromCache });
    }
  }

  /** 给某个集合的活跃监听发快照；传 where 就只发给过滤条件一致的那个监听 */
  emitCollection(
    path: string,
    docs: { id: string; data: Record<string, unknown> }[],
    options: { fromCache?: boolean; where?: readonly EqualityFilter[] } = {},
  ): void {
    for (const w of this.activeCollections(path)) {
      if (options.where && !sameFilters(w.filters, options.where)) continue;
      w.next({ docs, fromCache: options.fromCache ?? false });
    }
  }

  failCollection(path: string, err: unknown = new Error('permission-denied')): void {
    for (const w of this.activeCollections(path)) w.error(err);
  }

  failDoc(path: string, err: unknown = new Error('permission-denied')): void {
    for (const w of this.activeDocs(path)) w.error(err);
  }
}

/** 让 effect、toObservable、toSignal 的链条都跑完：连续几轮 detectChanges + whenStable */
export async function settle(fixture: ComponentFixture<unknown>, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}
