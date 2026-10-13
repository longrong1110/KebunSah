import { Signal, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, combineLatest, of, switchMap } from 'rxjs';
import {
  FirestoreReader,
  type CollectionState,
  type DocState,
} from '../../core/firebase/firestore-reader';
import { collectionConfirmed, docConfirmed, loadState$, type Load } from '../../core/load-state';
import type { PlotData } from './plot-types';

// 屏 7（评估中）、屏 9／10（结果、问题详情）、档案页共用的订阅与页面状态。
// 它们读的都是「一块地」：plots/{id}，加上它下面的 assessments／documents 子集合（档案页再读几个派生文档）。

export type PageState = 'loading' | 'offline' | 'error' | 'notfound' | 'ready';

export type DocLoad<T> = Load<DocState<T>> | null;
type CollectionLoad<T> = Load<CollectionState<T>> | null;

/**
 * 一块地的订阅，要在注入上下文里调用。
 * - plot：plots/{id}，实时订阅；id 为空不订阅（null）。
 * - subcollection(name)：plots/{id}/{name} 整个子集合（读数据层只有等值过滤、没有 orderBy，
 *   所以要「最新一次」之类的挑选由调用方在客户端做）。
 * 每个来源各自一个 Load、各自计时（10 秒没被服务器确认就算离线），不合并成一个，免得慢的拖住整页；
 * retry() 让用这个 watcher 建出来的**所有**订阅重新订阅（retry$ 也交出去，派生订阅要跟着重试）。
 * 组件销毁时 toSignal 自动取消订阅。
 */
export function watchPlot(id: Signal<string | null>) {
  const reader = inject(FirestoreReader);
  const retry$ = new BehaviorSubject(0);
  const id$ = combineLatest([toObservable(id), retry$]);

  const plot = toSignal(
    id$.pipe(
      switchMap(([plotId]) =>
        plotId ? loadState$(reader.doc$<PlotData>(`plots/${plotId}`), docConfirmed) : of(null),
      ),
    ),
    { initialValue: null as DocLoad<PlotData> },
  );

  const subcollection = <T>(name: string) =>
    toSignal(
      id$.pipe(
        switchMap(([plotId]) =>
          plotId
            ? loadState$(reader.collection$<T>(`plots/${plotId}/${name}`), collectionConfirmed)
            : of(null),
        ),
      ),
      { initialValue: null as CollectionLoad<T> },
    );

  return { reader, retry$, plot, subcollection, retry: () => retry$.next(retry$.value + 1) };
}

/**
 * 汇总页面状态：任何一个出错 → error；地块文档服务器确认不存在 → notfound（不管其余读到没有）；
 * 任何一个离线 → offline；任何一个还没读到 → loading；其余 ready。
 * 缓存里的空结果不会走到 notfound／「没有评估」：docConfirmed／collectionConfirmed 把它们留在 loading。
 * rest 是地块之外的其余订阅（评估、文档、档案页的派生文档……），顺序无关。
 */
export function pageState(
  plot: DocLoad<PlotData>,
  rest: readonly (Load<unknown> | null)[] = [],
): PageState {
  const all = [plot, ...rest];
  if (all.some((s) => s?.kind === 'error')) return 'error';
  if (plot?.kind === 'data' && !plot.value.data) return 'notfound';
  if (all.some((s) => s?.kind === 'offline')) return 'offline';
  if (all.some((s) => s === null || s.kind === 'loading')) return 'loading';
  return 'ready';
}
