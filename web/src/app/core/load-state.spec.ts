import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { collectionConfirmed, docConfirmed, loadState$, type Load } from './load-state';

interface Snap {
  docs: { id: string }[];
  fromCache: boolean;
}

function setup() {
  const source = new Subject<Snap>();
  const seen: Load<Snap>[] = [];
  const sub = loadState$(source, collectionConfirmed).subscribe((s) => seen.push(s));
  const last = () => seen[seen.length - 1];
  return { source, seen, last, sub };
}

describe('loadState$', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('订阅时先是 loading', () => {
    const { last } = setup();
    expect(last().kind).toBe('loading');
  });

  it('缓存里的空快照不算确认：仍是 loading；10 秒后转 offline', () => {
    const { source, last } = setup();
    source.next({ docs: [], fromCache: true });
    expect(last().kind).toBe('loading');
    vi.advanceTimersByTime(9_999);
    expect(last().kind).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(last().kind).toBe('offline');
  });

  it('服务器确认的空集合：是 data（这才是「0」的事实）', () => {
    const { source, last } = setup();
    source.next({ docs: [], fromCache: false });
    expect(last()).toEqual({
      kind: 'data',
      value: { docs: [], fromCache: false },
      fromCache: false,
    });
  });

  it('缓存里有数据：算确认，data 并带 fromCache 标记', () => {
    const { source, last } = setup();
    source.next({ docs: [{ id: 'a' }], fromCache: true });
    const l = last();
    expect(l.kind).toBe('data');
    expect(l.kind === 'data' && l.fromCache).toBe(true);
  });

  it('已转成 offline 后，服务器的快照到了：恢复成 data', () => {
    const { source, last } = setup();
    source.next({ docs: [], fromCache: true });
    vi.advanceTimersByTime(10_000);
    expect(last().kind).toBe('offline');
    source.next({ docs: [], fromCache: true }); // 又一个空缓存快照：仍然 offline
    expect(last().kind).toBe('offline');
    source.next({ docs: [{ id: 'a' }], fromCache: false });
    expect(last().kind).toBe('data');
  });

  it('已经是 data，超时不会把它改成 offline', () => {
    const { source, last } = setup();
    source.next({ docs: [{ id: 'a' }], fromCache: false });
    vi.advanceTimersByTime(60_000);
    expect(last().kind).toBe('data');
  });

  it('订阅出错：error；之后超时不改变它', () => {
    const { source, last } = setup();
    source.error(new Error('permission-denied'));
    expect(last().kind).toBe('error');
    vi.advanceTimersByTime(60_000);
    expect(last().kind).toBe('error');
  });

  it('每次订阅各自计时：重新订阅后从头数 10 秒', () => {
    const first = setup();
    vi.advanceTimersByTime(8_000);
    first.sub.unsubscribe();

    const second = setup(); // 相当于换成员后 switchMap 到新订阅
    vi.advanceTimersByTime(8_000); // 对第二个订阅才过了 8 秒
    expect(second.last().kind).toBe('loading');
    vi.advanceTimersByTime(2_000);
    expect(second.last().kind).toBe('offline');
  });

  it('取消订阅后不再有计时器在跑', () => {
    const { source, sub, seen } = setup();
    sub.unsubscribe();
    const n = seen.length;
    vi.advanceTimersByTime(60_000);
    source.next({ docs: [{ id: 'a' }], fromCache: false });
    expect(seen.length).toBe(n);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('确认判定', () => {
  it('集合：不是缓存就算；缓存里非空也算；空缓存不算', () => {
    expect(collectionConfirmed({ fromCache: false, docs: [] })).toBe(true);
    expect(collectionConfirmed({ fromCache: true, docs: [1] })).toBe(true);
    expect(collectionConfirmed({ fromCache: true, docs: [] })).toBe(false);
  });

  it('文档：不是缓存就算（含服务器确认不存在）；缓存里有就算；缓存里的「不存在」不算', () => {
    expect(docConfirmed({ fromCache: false, data: null })).toBe(true);
    expect(docConfirmed({ fromCache: true, data: { a: 1 } })).toBe(true);
    expect(docConfirmed({ fromCache: true, data: null })).toBe(false);
  });
});
