import { Signal, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, combineLatest, of, switchMap } from 'rxjs';
import {
  FirestoreReader,
  type CollectionState,
  type DocState,
} from '../../core/firebase/firestore-reader';
import { collectionConfirmed, docConfirmed, loadState$, type Load } from '../../core/load-state';
import type { PersonData, PlotData, TitleData } from '../plots/plot-types';
import type { AssessmentData } from '../result/assessment';

export interface CooperativeData {
  name?: string;
}

export type DashboardState = 'loading' | 'offline' | 'error' | 'ready';

/**
 * 看板要的五个订阅，要在注入上下文里调用。coopId 为 null 时一个都不订阅（不是管理员、没有绑定合作社）。
 * - plots：按 coopId 等值过滤；
 * - assessments：collection group，一次拿到所有地块的评估，在客户端按 plotId 与上面的地块对上（见 rows.ts）。
 *   代价：会把所有合作社、所有历史评估下载到浏览器，规则收紧时要单独规则（见 README 已知限制）；
 * - persons、titles：整个集合（只用 fullName、lotNo／district）；
 * - cooperatives/{coopId}：只用来显示合作社名。
 * 每个来源各自一个 Load、各自计时（10 秒没被服务器确认就算离线）；重试让它们都重新订阅。
 */
export function watchCoop(coopId: Signal<string | null>) {
  const reader = inject(FirestoreReader);
  const retry$ = new BehaviorSubject(0);
  const key$ = combineLatest([toObservable(coopId), retry$]);

  const plots = toSignal(
    key$.pipe(
      switchMap(([id]) =>
        id
          ? loadState$(
              reader.collection$<PlotData>('plots', { where: [{ field: 'coopId', value: id }] }),
              collectionConfirmed,
            )
          : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<PlotData>> | null },
  );

  const assessments = toSignal(
    key$.pipe(
      switchMap(([id]) =>
        id
          ? loadState$(
              reader.collection$<AssessmentData>('assessments', { group: true }),
              collectionConfirmed,
            )
          : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<AssessmentData>> | null },
  );

  const persons = toSignal(
    key$.pipe(
      switchMap(([id]) =>
        id ? loadState$(reader.collection$<PersonData>('persons'), collectionConfirmed) : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<PersonData>> | null },
  );

  const titles = toSignal(
    key$.pipe(
      switchMap(([id]) =>
        id ? loadState$(reader.collection$<TitleData>('titles'), collectionConfirmed) : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<TitleData>> | null },
  );

  const coop = toSignal(
    key$.pipe(
      switchMap(([id]) =>
        id
          ? loadState$(reader.doc$<CooperativeData>(`cooperatives/${id}`), docConfirmed)
          : of(null),
      ),
    ),
    { initialValue: null as Load<DocState<CooperativeData>> | null },
  );

  return { plots, assessments, persons, titles, coop, retry: () => retry$.next(retry$.value + 1) };
}

/**
 * 汇总：任何一个出错 → error；任何一个离线 → offline；四个数据订阅（地块、评估、成员、地契）都被服务器确认之前
 * 一律 loading——不然计数会先全是「Belum mula」再跳变；缓存里的空结果留在 loading，不当成「合作社没有地块」。
 * 合作社名（cooperatives/{id}）只是个标签，不参与。
 */
export function dashboardState(...sources: readonly (Load<unknown> | null)[]): DashboardState {
  if (sources.some((s) => s?.kind === 'error')) return 'error';
  if (sources.some((s) => s?.kind === 'offline')) return 'offline';
  if (sources.some((s) => s === null || s.kind === 'loading')) return 'loading';
  return 'ready';
}
