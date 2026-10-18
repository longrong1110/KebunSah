import { InjectionToken } from '@angular/core';
import type { PendingPlot } from './pending-plot';

/** 手机里存「等着送」的草稿的地方。最早的排在前面 */
export interface PendingStore {
  list(): Promise<PendingPlot[]>;
  put(entry: PendingPlot): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryPendingStore implements PendingStore {
  private readonly rows = new Map<string, PendingPlot>();

  async list(): Promise<PendingPlot[]> {
    return [...this.rows.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async put(entry: PendingPlot): Promise<void> {
    this.rows.set(entry.id, entry);
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

const DB_NAME = 'kebunsah';
const STORE = 'pending';

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * IndexedDB 实现。照片是 Blob，IndexedDB 能直接存（localStorage 存不了）。
 * 浏览器不让用 IndexedDB 时（部分隐私模式）退回内存：这一次页面开着还能重试，刷新就没了。
 */
export class IdbPendingStore implements PendingStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly fallback = new MemoryPendingStore();
  private broken = false;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    return this.db;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    if (this.broken) return fallback();
    try {
      const db = await this.open();
      return await done(work(db.transaction(STORE, mode).objectStore(STORE)));
    } catch {
      this.broken = true;
      return fallback();
    }
  }

  list(): Promise<PendingPlot[]> {
    return this.run<PendingPlot[]>(
      'readonly',
      (s) => s.getAll() as IDBRequest<PendingPlot[]>,
      () => this.fallback.list(),
    ).then((rows) => [...rows].sort((a, b) => a.createdAt - b.createdAt));
  }

  put(entry: PendingPlot): Promise<void> {
    return this.run<unknown>(
      'readwrite',
      (s) => s.put(entry) as IDBRequest<unknown>,
      () => this.fallback.put(entry),
    ).then(() => undefined);
  }

  remove(id: string): Promise<void> {
    return this.run<unknown>(
      'readwrite',
      (s) => s.delete(id) as IDBRequest<unknown>,
      () => this.fallback.remove(id),
    ).then(() => undefined);
  }
}

export const PENDING_STORE = new InjectionToken<PendingStore>('PendingStore', {
  providedIn: 'root',
  factory: () => (typeof indexedDB === 'undefined' ? new MemoryPendingStore() : new IdbPendingStore()),
});
