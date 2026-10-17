import { Signal } from '@angular/core';
import { watchPlot } from '../plots/plot-watch';
import type { AssessmentData } from './assessment';

/**
 * 屏 9、屏 10 共用的订阅：plots/{id} 和 plots/{id}/assessments。要在注入上下文里调用。
 * 订阅与重试的写法在 plots/plot-watch.ts；页面状态汇总用同一处的 pageState()。
 *
 * assessments 子集合只能订阅整个集合（读数据层只有等值过滤、没有 orderBy），「最新一次」在客户端挑。
 */
export function watchPlotAssessment(id: Signal<string | null>) {
  const w = watchPlot(id);
  return {
    plot: w.plot,
    assessments: w.subcollection<AssessmentData>('assessments'),
    retry: w.retry,
  };
}
