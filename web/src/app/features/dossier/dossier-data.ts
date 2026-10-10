import { Signal, computed, inject } from '@angular/core';
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
import type { PageState } from '../result/result-data';
import type { DossierDocument, MpobLicenceData, MspoCertificateData } from './dossier';

type DocLoad<T> = Load<DocState<T>> | null;

/** 地块里没有这个 id（没登记地契、没有执照…）：直接给一个「确认不存在」，不去订阅，也不卡在加载 */
const absent = <T>(): DocLoad<T> => ({
  kind: 'data',
  value: { id: '', data: null, fromCache: false },
  fromCache: false,
});

/**
 * 档案页要的订阅，要在注入上下文里调用。
 * - 核心三个：plots/{id}、plots/{id}/assessments、plots/{id}/documents；
 * - 派生五个：按地块里的 id 再读 titles、persons、mpobLicences、mspoCertificates、cooperatives。
 *   地块还没读到之前不订阅（null）；地块里没有那个 id 就给「确认不存在」的占位。
 * 每个来源各自一个 Load、各自计时（10 秒没被服务器确认就算离线）；重试让它们全部重新订阅。
 * 组件销毁时 toSignal 自动取消所有订阅。
 */
export function watchDossier(id: Signal<string | null>) {
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
              reader.collection$<DossierDocument>(`plots/${plotId}/documents`),
              collectionConfirmed,
            )
          : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<DossierDocument>> | null },
  );

  const plotData = computed<PlotData | null>(() => {
    const p = plot();
    return p?.kind === 'data' ? p.value.data : null;
  });

  /** undefined = 地块还没读到；null = 地块里没有这个 id；字符串 = 要读的文档 id */
  const derived = <T>(pick: (p: PlotData) => string | null | undefined, collection: string) => {
    const ref = computed<string | null | undefined>(() => {
      const p = plotData();
      return p === null ? undefined : pick(p) || null;
    });
    return toSignal(
      combineLatest([toObservable(ref), retry$]).pipe(
        switchMap(([docId]) =>
          docId === undefined
            ? of(null)
            : docId === null
              ? of(absent<T>())
              : loadState$(reader.doc$<T>(`${collection}/${docId}`), docConfirmed),
        ),
      ),
      { initialValue: null as DocLoad<T> },
    );
  };

  return {
    plot,
    assessments,
    documents,
    title: derived<TitleData>((p) => p.landTitleId, 'titles'),
    person: derived<PersonData>((p) => p.operatorPersonId, 'persons'),
    mpob: derived<MpobLicenceData>((p) => p.mpobLicenceId, 'mpobLicences'),
    mspo: derived<MspoCertificateData>((p) => p.mspoCertificateId, 'mspoCertificates'),
    coop: derived<{ name?: string | null }>((p) => p.coopId, 'cooperatives'),
    retry: () => retry$.next(retry$.value + 1),
  };
}

/**
 * 汇总页面状态：任何一个出错 → error；地块文档服务器确认不存在 → notfound；任何一个离线 → offline；
 * 任何一个还没读到（含地块之外的派生文档）→ loading；其余 ready。
 * 缓存里的空结果不会走到 notfound／「没有文档」：docConfirmed／collectionConfirmed 把它们留在 loading。
 * 派生文档（地契、成员…）确认不存在不挡页面：对应字段在版面里写「—」。
 */
export function dossierState(
  plot: DocLoad<PlotData>,
  rest: readonly (Load<unknown> | null)[],
): PageState {
  const all = [plot, ...rest];
  if (all.some((s) => s?.kind === 'error')) return 'error';
  if (plot?.kind === 'data' && !plot.value.data) return 'notfound';
  if (all.some((s) => s?.kind === 'offline')) return 'offline';
  if (all.some((s) => s === null || s.kind === 'loading')) return 'loading';
  return 'ready';
}
