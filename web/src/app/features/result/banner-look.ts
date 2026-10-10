import { statusOf } from '../../core/plot-status';
import type { BannerKey } from './assessment';

/**
 * 结论的图标与色调（颜色＋图标＋文字三件套里的前两件）：四种结论与「还没开始」沿用 statusOf，
 * 「检查中」是线框外的状态，用中性色。屏 9 的横幅和看板的状态芯片共用。
 */
export function bannerLook(key: BannerKey): { icon: string; tone: string } {
  if (key === 'running') return { icon: '…', tone: 'idle' };
  const s = statusOf(key);
  return { icon: s.icon, tone: s.tone };
}
