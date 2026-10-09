import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { realFirestoreFacade, type FirestoreFacade } from './firestore-facade';

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
  docs: { id: string; data: T }[];
  // true = 数据来自本地缓存，还没和服务器对过；此时空集合不能当"确认为 0"
  fromCache: boolean;
}

// 前端读 Firestore 的唯一入口：只有订阅，没有任何写方法。
// 返回冷 Observable：订阅时才开监听，取消订阅（组件销毁、toSignal 销毁、takeUntilDestroyed）时关监听。
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

  collection$<T = Record<string, unknown>>(path: string): Observable<CollectionState<T>> {
    return new Observable<CollectionState<T>>((subscriber) =>
      this.facade.watchCollection(
        path,
        (snap) =>
          subscriber.next({
            docs: snap.docs.map((d) => ({ id: d.id, data: d.data as T })),
            fromCache: snap.fromCache,
          }),
        (err) => subscriber.error(err),
      ),
    );
  }
}
