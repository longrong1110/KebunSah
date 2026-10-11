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
import type { AssessmentData } from '../result/assessment';
import type { CheckingDocument } from './checking';

/**
 * 屏 7 要的三个订阅，要在注入上下文里调用：plots/{id}、plots/{id}/assessments、plots/{id}/documents。
 * 都是实时订阅（评估从 queued → running → done 页面自己变）。每个来源各自一个 Load、各自计时
 * （10 秒没被服务器确认就算离线）；重试让三个都重新订阅。组件销毁时 toSignal 自动取消订阅。
 * 页面状态汇总用 dossierState（出错 → 地块不存在 → 离线 → 加载中 → 就绪），与档案页是同一条规则。
 */
export function watchChecking(id: Signal<string | null>) {
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

  const documents = toSignal(
    id$.pipe(
      switchMap(([plotId]) =>
        plotId
          ? loadState$(
              reader.collection$<CheckingDocument>(`plots/${plotId}/documents`),
              collectionConfirmed,
            )
          : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<CheckingDocument>> | null },
  );

  return { plot, assessments, documents, retry: () => retry$.next(retry$.value + 1) };
}
