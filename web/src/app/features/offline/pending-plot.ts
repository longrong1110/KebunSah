import { ApiError } from '../../core/api/api.service';
import type { DocSource, DocType } from '../new-plot/draft.service';
import type { PlotGeometry } from '../new-plot/geometry';

// 没信号时「开始检查」不能直接交给后端：整份草稿（圈好的地块、拍好的照片）先存在手机里（IndexedDB），
// 有网了再自动送出去。这里是存的东西的形状，以及「这次失败值不值得以后再试」的判断。

export interface PendingPage {
  type: DocType;
  /** 一份文件的第几页（1–4） */
  pageNo: number;
  source: DocSource;
  blob: Blob;
}

/** 从草稿拍下来的快照：送出去需要的全部东西 */
export interface PendingSnapshot {
  memberId: string | null;
  geometry: PlotGeometry;
  pages: PendingPage[];
  /** 中途断网时后端已经建好的地块（重试不再新建） */
  plotId: string | null;
  /** 已经传好的页，键是 `${type}#${pageNo}`（重试不再重传） */
  uploaded: string[];
}

export interface PendingPlot extends PendingSnapshot {
  /** 本机生成的 id（和后端的地块 id 无关） */
  id: string;
  /** 存进手机的时间（毫秒），最早的先送 */
  createdAt: number;
  /** waiting：等着送；failed：后端明确拒绝了，不会自己好，要用户处理 */
  state: 'waiting' | 'failed';
  errorCode: string | null;
}

export const pageKey = (type: DocType, pageNo: number): string => `${type}#${pageNo}`;

/** 值得以后再试的失败：断网、还没登录、服务端暂时不可用、被限流。别的（400／403／404／422）是数据本身有问题，再试也一样 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return (
    ['network', 'unauthenticated', 'not_configured', 'invalid_token'].includes(err.code) ||
    err.status >= 500 ||
    err.status === 429
  );
}
