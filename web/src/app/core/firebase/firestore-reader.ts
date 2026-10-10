import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { realFirestoreFacade, type EqualityFilter, type FirestoreFacade } from './firestore-facade';

export type { EqualityFilter } from './firestore-facade';

export const FIRESTORE_FACADE = new InjectionToken<FirestoreFacade>('FIRESTORE_FACADE', {
  providedIn: 'root',
  factory: () => realFirestoreFacade,
});

export interface DocState<T> {
  id: string;
  // null = 文档不存在（只有在 fromCache 为 false 时才是"确认不存在"）
  data: T | null;
  fromCache: boolean;
}

export interface CollectionState<T> {
  /** path：文档的完整路径（collection group 查询靠它认父文档，如 plots/{id}/assessments/{aid}） */
  docs: { id: string; data: T; path?: string }[];
  // true = 数据来自本地缓存，还没和服务器对过；此时空集合不能当"确认为 0"
  fromCache: boolean;
}

export interface CollectionOptions {
  /** 只读的等值过滤（field == value），多个条件是"并且" */
  where?: readonly EqualityFilter[];
  /**
   * true：path 是集合名，订阅所有同名子集合（collection group，只读）。
   * 例：collection$('assessments', { group: true }) 一次拿到所有地块的评估，不用每块地订阅一次。
   */
  group?: boolean;
}

// 前端读 Firestore 的唯一入口：只有订阅，没有任何写方法。
// 返回冷 Observable：订阅时才开监听，取消订阅（组件销毁、toSignal 销毁、takeUntilDestroyed）时关监听。
// 公开面只有 doc$ 与 collection$（有测试把关）：要加过滤、collection group，给 collection$ 加可选参数，不要加新方法。
@Injectable({ providedIn: 'root' })
export class FirestoreReader {
  private readonly facade = inject(FIRESTORE_FACADE);

  doc$<T = Record<string, unknown>>(path: string): Observable<DocState<T>> {
    return new Observable<DocState<T>>((subscriber) =>
      this.facade.watchDoc(
        path,
        (snap) =>
          subscriber.next({
            id: snap.doc.id,
            data: snap.exists ? (snap.doc.data as T) : null,
            fromCache: snap.fromCache,
          }),
        (err) => subscriber.error(err),
      ),
    );
  }

  collection$<T = Record<string, unknown>>(
    path: string,
    options?: CollectionOptions,
  ): Observable<CollectionState<T>> {
    return new Observable<CollectionState<T>>((subscriber) =>
      this.facade.watchCollection(
        path,
        (snap) =>
          subscriber.next({
            docs: snap.docs.map((d) => ({ id: d.id, data: d.data as T, path: d.path })),
            fromCache: snap.fromCache,
          }),
        (err) => subscriber.error(err),
        options?.where,
        options?.group,
      ),
    );
  }
}
