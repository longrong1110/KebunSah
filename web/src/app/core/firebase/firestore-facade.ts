import {
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import { getFirebaseApp, wiredFlag } from './firebase';
import { convertTimestamps } from './timestamps';

// Firestore 的只读外观：前端只能订阅，没有任何写入口。
// 项目铁律：前端对 Firestore 一律只读，写入只走后端 API。组件不直接碰 firebase/firestore，
// scripts/check-readonly.mjs 也会把关。

export interface RawDoc {
  id: string;
  data: Record<string, unknown> | undefined;
}

/** 只读的等值过滤：field == value。别的运算符、orderBy 都不提供（见下） */
export interface EqualityFilter {
  field: string;
  value: string | number | boolean | null;
}

export interface FirestoreFacade {
  watchDoc(
    path: string,
    next: (snap: { exists: boolean; doc: RawDoc; fromCache: boolean }) => void,
    error: (err: unknown) => void,
  ): () => void;
  /**
   * filters 放在最后一个可选参数：已有的调用与测试里的假实现（path, next, error）不受影响。
   * 排序一律在客户端做：where + orderBy 另一个字段在生产环境需要复合索引，而模拟器不校验索引，等于埋雷。
   */
  watchCollection(
    path: string,
    next: (snap: { docs: RawDoc[]; fromCache: boolean }) => void,
    error: (err: unknown) => void,
    filters?: readonly EqualityFilter[],
  ): () => void;
}

let db: Firestore | null = null;

function getDb(): Firestore {
  if (db) return db;
  db = getFirestore(getFirebaseApp());
  const emu = environment.emulators;
  const g = globalThis as Record<string, unknown>;
  if (emu && !g[wiredFlag('firestore')]) {
    connectFirestoreEmulator(db, emu.firestoreHost, emu.firestorePort);
    g[wiredFlag('firestore')] = true;
  }
  return db;
}

export const realFirestoreFacade: FirestoreFacade = {
  watchDoc(path, next, error) {
    return onSnapshot(
      doc(getDb(), path),
      { includeMetadataChanges: true },
      (snap) =>
        next({
          exists: snap.exists(),
          doc: { id: snap.id, data: convertTimestamps(snap.data()) },
          fromCache: snap.metadata.fromCache,
        }),
      error,
    );
  },
  watchCollection(path, next, error, filters) {
    const ref = collection(getDb(), path);
    const source = filters?.length
      ? query(ref, ...filters.map((f) => where(f.field, '==', f.value)))
      : ref;
    return onSnapshot(
      source,
      { includeMetadataChanges: true },
      (snap) =>
        next({
          docs: snap.docs.map((d) => ({ id: d.id, data: convertTimestamps(d.data()) })),
          fromCache: snap.metadata.fromCache,
        }),
      error,
    );
  },
};
