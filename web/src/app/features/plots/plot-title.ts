import type { DocState } from '../../core/firebase/firestore-reader';
import { formatArea, formatDay } from '../../core/format';
import type { Dict } from '../../core/i18n/dict.ms';
import type { Lang } from '../../core/i18n/i18n.service';
import type { Load } from '../../core/load-state';
import type { PlotData, TitleData } from './plot-types';

// 一块地的标题与副标题。屏 2 的卡片和屏 9 的头部共用，两处写法一致。

/**
 * 标题：没有地契 → Lot baharu；title 读到了 → Lot {lotNo}, {district}；
 * title 确认不存在或迟迟读不到 → 退回 plots 上复制的 titleNo / nickname + district，不冒充「Lot baharu」；
 * 还在读 → heading 为 null、loading 为 true（调用方显示骨架）。
 */
export function plotHeading(
  t: Dict,
  p: PlotData,
  title: Load<DocState<TitleData>> | null,
): { heading: string | null; loading: boolean } {
  if (!p.landTitleId) return { heading: t.plots.newLot, loading: false };
  const lot = title?.kind === 'data' ? title.value.data : null;
  if (lot?.lotNo) {
    return { heading: t.plots.lot(lot.lotNo, lot.district ?? p.district ?? ''), loading: false };
  }
  if (title && title.kind !== 'loading') {
    const fallback = [p.titleNo ?? p.nickname, p.district].filter(Boolean).join(', ');
    return { heading: fallback || t.plots.notFilled, loading: false };
  }
  return { heading: null, loading: true };
}

/** 「4.23 ha · 2 Okt」：面积（没填写「Belum diisi」）加最近评估的日期（没有就省略） */
export function plotSubtitle(t: Dict, p: PlotData, lang: Lang): string {
  const area = formatArea(p.areaHaComputed, p.areaHaDeclared);
  const day = formatDay(p.lastAssessedAt, lang);
  return [area ? t.plots.areaHa(area) : t.plots.notFilled, day].filter(Boolean).join(' · ');
}
