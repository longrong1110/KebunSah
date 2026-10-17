import { Signal } from '@angular/core';
import { watchPlot } from '../plots/plot-watch';
import type { AssessmentData } from '../result/assessment';
import type { CheckingDocument } from './checking';

/**
 * 屏 7 要的三个订阅，要在注入上下文里调用：plots/{id}、plots/{id}/assessments、plots/{id}/documents。
 * 都是实时订阅（评估从 queued → running → done 页面自己变）；订阅、重试与计时的写法在 plots/plot-watch.ts。
 * 页面状态汇总用同一处的 pageState（出错 → 地块不存在 → 离线 → 加载中 → 就绪）。
 */
export function watchChecking(id: Signal<string | null>) {
  const w = watchPlot(id);
  return {
    plot: w.plot,
    assessments: w.subcollection<AssessmentData>('assessments'),
    documents: w.subcollection<CheckingDocument>('documents'),
    retry: w.retry,
  };
}
