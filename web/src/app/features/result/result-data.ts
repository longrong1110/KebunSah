import { Signal, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, combineLatest, of, switchMap } from 'rxjs';
import {
  FirestoreReader,
  type CollectionState,
  type DocState,
} from '../../core/firebase/firestore-reader';
import { collectionConfirmed, docConfirmed, loadState$, type Load } from '../../core/load-state';
import type { PlotData } from '../plots/plot-types';
import type { AssessmentData } from './assessment';

export type PageState = 'loading' | 'offline' | 'error' | 'notfound' | 'ready';

/**
 * 屏 9、屏 10 共用的订阅：plots/{id} 和 plots/{id}/assessments。要在注入上下文里调用。
 * 两个订阅各自一个 Load，各自计时（10 秒没被服务器确认就算离线），不合并成一个，免得慢的拖住整页；
 * 页面状态由 pageState() 汇总。重试会让两个订阅都重新订阅。组件销毁时 toSignal 自动取消订阅。
 *
 * assessments 子集合只能订阅整个集合（读数据层只有等值过滤、没有 orderBy），「最新一次」在客户端挑。
 */
export function watchPlotAssessment(id: Signal<string | null>) {
  const reader = inject(FirestoreReader);
  const retry$ = new BehaviorSubject(0);
  const id$ = combineLatest([toObservable(id), retry$]);

  const plot = toSignal(
    id$.pipe(
      switchMap(([plotId]) =>
        plotId ? loadState$(reader.doc$<PlotData>(`plots/${plotId}`), docConfirmed) : of(null),
      ),
    ),
    { initialValue: null as Load<DocState<PlotData>> | null },
  );

  const assessments = toSignal(
    id$.pipe(
      switchMap(([plotId]) =>
        plotId
          ? loadState$(
              reader.collection$<AssessmentData>(`plots/${plotId}/assessments`),
              collectionConfirmed,
            )
          : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<AssessmentData>> | null },
  );

  return {
    plot,
    assessments,
    retry: () => retry$.next(retry$.value + 1),
  };
}

/**
 * 汇总页面状态：任何一个出错 → error；地块文档服务器确认不存在 → notfound（不管评估读到没有）；
 * 任何一个离线 → offline；还没读到 → loading；其余 ready。
 * 缓存里的空结果不会走到 notfound／「没有评估」：docConfirmed／collectionConfirmed 把它们留在 loading。
 */
export function pageState(
  plot: Load<DocState<PlotData>> | null,
  assessments: Load<CollectionState<AssessmentData>> | null,
): PageState {
  if (plot?.kind === 'error' || assessments?.kind === 'error') return 'error';
  if (plot?.kind === 'data' && !plot.value.data) return 'notfound';
  if (plot?.kind === 'offline' || assessments?.kind === 'offline') return 'offline';
  if (!plot || !assessments || plot.kind === 'loading' || assessments.kind === 'loading') {
    return 'loading';
  }
  return 'ready';
}
