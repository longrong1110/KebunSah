import {
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import { getFirebaseApp, wiredFlag } from './firebase';

// Firestore 的只读外观：前端只能订阅，没有任何写入口。
// 项目铁律：前端对 Firestore 一律只读，写入只走后端 API。组件不直接碰 firebase/firestore，
// scripts/check-readonly.mjs 也会把关。

export interface RawDoc {
  id: string;
  data: Record<string, unknown> | undefined;
}

export interface FirestoreFacade {
  watchDoc(
    path: string,
    next: (snap: { exists: boolean; doc: RawDoc; fromCache: boolean }) => void,
    error: (err: unknown) => void,
  ): () => void;
  watchCollection(
    path: string,
    next: (snap: { docs: RawDoc[]; fromCache: boolean }) => void,
    error: (err: unknown) => void,
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
          doc: { id: snap.id, data: snap.data() },
          fromCache: snap.metadata.fromCache,
        }),
      error,
    );
  },
  watchCollection(path, next, error) {
    return onSnapshot(
      collection(getDb(), path),
      { includeMetadataChanges: true },
      (snap) =>
        next({
          docs: snap.docs.map((d) => ({ id: d.id, data: d.data() })),
          fromCache: snap.metadata.fromCache,
        }),
      error,
    );
  },
};
