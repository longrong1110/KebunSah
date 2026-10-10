import { Observable, catchError, map, merge, of, scan, startWith, timer } from 'rxjs';

// 一次订阅的"加载状态"：加载中 / 服务器确认过的数据 / 连不上（离线）/ 出错。
// 屏 2 的两个列表（成员、地块）共用。核心原则：**服务器没确认的空结果不能显示成「0」**——
// 本地缓存给的第一个快照常常是空集合，那只说明"手机里还没有"，不说明"服务器上没有"。

/** 多久没拿到服务器确认的快照，就按"连不上"处理 */
export const LOAD_TIMEOUT_MS = 10_000;

export type Load<T> =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'error' }
  | { kind: 'data'; value: T; fromCache: boolean };

/** 集合快照是否算确认：不是缓存，或者缓存里确实有东西（空缓存不算） */
export const collectionConfirmed = (v: { fromCache: boolean; docs: readonly unknown[] }) =>
  !v.fromCache || v.docs.length > 0;

/** 单个文档快照是否算确认：不是缓存，或者缓存里确实有这个文档（缓存里的"不存在"不算） */
export const docConfirmed = (v: { fromCache: boolean; data: unknown }) =>
  !v.fromCache || v.data !== null;

type Event<T> = { kind: 'value'; value: T } | { kind: 'error' } | { kind: 'timeout' };
interface Acc<T> {
  load: Load<T>;
  timedOut: boolean;
}

/**
 * 把一个快照流包成加载状态流。每次订阅各自计时（切换成员时 switchMap 到新的订阅，计时重新开始）：
 * - 确认过的快照 → data；
 * - 没确认且超时前 → loading；超时后 → offline（之后服务器的快照到了会恢复成 data）；
 * - 订阅出错 → error；已经是 data 的，超时不会把它改成 offline。
 */
export function loadState$<T extends { fromCache: boolean }>(
  source$: Observable<T>,
  confirmed: (value: T) => boolean,
  timeoutMs = LOAD_TIMEOUT_MS,
): Observable<Load<T>> {
  const events$ = merge(
    source$.pipe(
      map((value): Event<T> => ({ kind: 'value', value })),
      catchError(() => of<Event<T>>({ kind: 'error' })),
    ),
    timer(timeoutMs).pipe(map((): Event<T> => ({ kind: 'timeout' }))),
  );

  return events$.pipe(
    scan(
      (acc: Acc<T>, event: Event<T>): Acc<T> => {
        switch (event.kind) {
          case 'error':
            return { ...acc, load: { kind: 'error' } };
          case 'timeout':
            return {
              timedOut: true,
              load: acc.load.kind === 'loading' ? { kind: 'offline' } : acc.load,
            };
          case 'value':
            if (confirmed(event.value)) {
              return {
                ...acc,
                load: { kind: 'data', value: event.value, fromCache: event.value.fromCache },
              };
            }
            return { ...acc, load: acc.timedOut ? { kind: 'offline' } : { kind: 'loading' } };
        }
      },
      { load: { kind: 'loading' }, timedOut: false } as Acc<T>,
    ),
    map((acc) => acc.load),
    startWith<Load<T>>({ kind: 'loading' }),
  );
}
