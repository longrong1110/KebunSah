import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { FirestoreFacade } from './firestore-facade';
import { FIRESTORE_FACADE, FirestoreReader } from './firestore-reader';

function setup() {
  const unsubscribe = vi.fn();
  let emitCollection: Parameters<FirestoreFacade['watchCollection']>[1] = () => {};
  let failCollection: Parameters<FirestoreFacade['watchCollection']>[2] = () => {};
  let emitDoc: Parameters<FirestoreFacade['watchDoc']>[1] = () => {};
  const watchCollection = vi.fn<FirestoreFacade['watchCollection']>((_path, next, error) => {
    emitCollection = next;
    failCollection = error;
    return unsubscribe;
  });
  const watchDoc = vi.fn<FirestoreFacade['watchDoc']>((_path, next) => {
    emitDoc = next;
    return unsubscribe;
  });
  TestBed.configureTestingModule({
    providers: [{ provide: FIRESTORE_FACADE, useValue: { watchCollection, watchDoc } }],
  });
  return {
    reader: TestBed.inject(FirestoreReader),
    unsubscribe,
    watchCollection,
    watchDoc,
    emitCollection: (...a: Parameters<typeof emitCollection>) => emitCollection(...a),
    failCollection: (...a: Parameters<typeof failCollection>) => failCollection(...a),
    emitDoc: (...a: Parameters<typeof emitDoc>) => emitDoc(...a),
  };
}

describe('FirestoreReader', () => {
  it('是冷 Observable：不订阅就不开监听', () => {
    const { reader, watchCollection } = setup();
    reader.collection$('plots');
    expect(watchCollection).not.toHaveBeenCalled();
  });

  it('取消订阅时关掉监听，且只关一次', () => {
    const { reader, watchCollection, unsubscribe } = setup();
    const sub = reader.collection$('plots').subscribe();
    expect(watchCollection).toHaveBeenCalledTimes(1);
    expect(watchCollection.mock.calls[0][0]).toBe('plots');
    expect(unsubscribe).not.toHaveBeenCalled();
    sub.unsubscribe();
    sub.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('反复订阅、取消，不会累积监听', () => {
    const { reader, watchCollection, unsubscribe } = setup();
    for (let i = 0; i < 5; i++) reader.collection$('plots').subscribe().unsubscribe();
    expect(watchCollection).toHaveBeenCalledTimes(5);
    expect(unsubscribe).toHaveBeenCalledTimes(5);
  });

  it('把快照转成 {docs, fromCache}，并把缓存标记原样带出（空缓存不能当"确认为 0"）', () => {
    const { reader, emitCollection } = setup();
    const seen: unknown[] = [];
    reader.collection$<{ status: string }>('plots').subscribe((s) => seen.push(s));
    emitCollection({ docs: [], fromCache: true });
    emitCollection({ docs: [{ id: 'p1', data: { status: 'green' } }], fromCache: false });
    expect(seen).toEqual([
      { docs: [], fromCache: true },
      { docs: [{ id: 'p1', data: { status: 'green' } }], fromCache: false },
    ]);
  });

  it('等值过滤透传给 facade；不传时第四个参数是 undefined', () => {
    const { reader, watchCollection } = setup();
    reader.collection$('plots').subscribe().unsubscribe();
    expect(watchCollection.mock.calls[0][3]).toBeUndefined();

    const where = [{ field: 'operatorPersonId', value: 'p1' }] as const;
    reader.collection$('plots', { where }).subscribe().unsubscribe();
    expect(watchCollection.mock.calls[1][3]).toEqual(where);
  });

  it('监听出错时，错误传给订阅者', () => {
    const { reader, failCollection } = setup();
    const onError = vi.fn();
    reader.collection$('plots').subscribe({ error: onError });
    failCollection(new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('doc$：文档不存在 → data 为 null', () => {
    const { reader, emitDoc } = setup();
    const seen: unknown[] = [];
    reader.doc$('users/x').subscribe((s) => seen.push(s));
    emitDoc({ exists: false, doc: { id: 'x', data: undefined }, fromCache: false });
    expect(seen).toEqual([{ id: 'x', data: null, fromCache: false }]);
  });

  it('公开面只有 doc$ 与 collection$，没有写入口', () => {
    const methods = Object.getOwnPropertyNames(FirestoreReader.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(methods.sort()).toEqual(['collection$', 'doc$']);
  });
});
