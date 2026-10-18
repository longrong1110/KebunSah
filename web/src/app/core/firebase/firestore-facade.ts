import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
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
  /** 文档的完整路径（集合订阅才带），如 plots/{id}/assessments/{aid}；collection group 查询靠它认父文档 */
  path?: string;
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
   * group 为 true 时，path 是**集合名**（如 'assessments'），订阅所有同名子集合（collection group 查询，只读）。
   */
  watchCollection(
    path: string,
    next: (snap: { docs: RawDoc[]; fromCache: boolean }) => void,
    error: (err: unknown) => void,
    filters?: readonly EqualityFilter[],
    group?: boolean,
  ): () => void;
}

let db: Firestore | null = null;

/**
 * 缓存存在 IndexedDB 里（多个标签页共用）：没信号时刷新页面，看过的地块和结果还在（屏 2 的「来自缓存」提示就是为这个）。
 * 初始化过了（热更新）或浏览器不让用 IndexedDB（部分隐私模式）就退回默认的内存缓存。
 */
function createDb(): Firestore {
  const app = getFirebaseApp();
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

function getDb(): Firestore {
  if (db) return db;
  db = createDb();
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
  watchCollection(path, next, error, filters, group) {
    const ref = group ? collectionGroup(getDb(), path) : collection(getDb(), path);
    const source = filters?.length
      ? query(ref, ...filters.map((f) => where(f.field, '==', f.value)))
      : ref;
    return onSnapshot(
      source,
      { includeMetadataChanges: true },
      (snap) =>
        next({
          docs: snap.docs.map((d) => ({
            id: d.id,
            data: convertTimestamps(d.data()),
            path: d.ref.path,
          })),
          fromCache: snap.metadata.fromCache,
        }),
      error,
    );
  },
};
