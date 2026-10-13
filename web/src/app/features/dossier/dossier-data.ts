import { Signal, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, of, switchMap } from 'rxjs';
import { docConfirmed, loadState$ } from '../../core/load-state';
import type { PersonData, PlotData, TitleData } from '../plots/plot-types';
import { watchPlot, type DocLoad } from '../plots/plot-watch';
import type { AssessmentData } from '../result/assessment';
import type { DossierDocument, MpobLicenceData, MspoCertificateData } from './dossier';

/** 地块里没有这个 id（没登记地契、没有执照…）：直接给一个「确认不存在」，不去订阅，也不卡在加载 */
const absent = <T>(): DocLoad<T> => ({
  kind: 'data',
  value: { id: '', data: null, fromCache: false },
  fromCache: false,
});

/**
 * 档案页要的订阅，要在注入上下文里调用。
 * - 核心三个：plots/{id}、plots/{id}/assessments、plots/{id}/documents（订阅与重试的写法在 plots/plot-watch.ts）；
 * - 派生五个：按地块里的 id 再读 titles、persons、mpobLicences、mspoCertificates、cooperatives。
 *   地块还没读到之前不订阅（null）；地块里没有那个 id 就给「确认不存在」的占位。
 * 每个来源各自一个 Load、各自计时（10 秒没被服务器确认就算离线）；重试让它们全部重新订阅。
 * 组件销毁时 toSignal 自动取消所有订阅。
 */
export function watchDossier(id: Signal<string | null>) {
  const { reader, retry$, plot, subcollection, retry } = watchPlot(id);
  const assessments = subcollection<AssessmentData>('assessments');
  const documents = subcollection<DossierDocument>('documents');

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
    retry,
  };
}
