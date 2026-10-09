// 地块状态：值取自 contract/status.md 的 plots.status，不另起别名。
// 状态永远是「颜色 + 图标 + 文字」三件套，不只靠颜色（企划书 v3 的「状态与文案规范」）。
// 文字在词典里（随语言切换）：t().status[key]；这里只管图标与色调。

export const PLOT_STATUSES = ['green', 'yellow', 'red', 'needs_review', 'pending'] as const;
export type PlotStatus = (typeof PLOT_STATUSES)[number];

export interface StatusView {
  icon: string;
  /** 对应 styles.scss 里的 .tone-* */
  tone: 'ok' | 'warn' | 'bad' | 'review' | 'idle';
}

export const STATUS_VIEW: Record<PlotStatus, StatusView> = {
  green: { icon: '✓', tone: 'ok' },
  yellow: { icon: '⚠', tone: 'warn' },
  red: { icon: '✕', tone: 'bad' },
  needs_review: { icon: '?', tone: 'review' },
  pending: { icon: '○', tone: 'idle' },
};

/** 不认识的状态值：显示中性芯片，不崩，也不会被当成绿色 */
export const UNKNOWN_STATUS_VIEW: StatusView = { icon: '?', tone: 'idle' };

export type StatusKey = PlotStatus | 'unknown';

/** 任意值 → 词典键 + 图标 + 色调；不是合同里的五个值就归为 unknown */
export function statusOf(status: unknown): { key: StatusKey } & StatusView {
  if (typeof status === 'string' && (PLOT_STATUSES as readonly string[]).includes(status)) {
    return { key: status as PlotStatus, ...STATUS_VIEW[status as PlotStatus] };
  }
  return { key: 'unknown', ...UNKNOWN_STATUS_VIEW };
}

export interface StatusCounts {
  total: number;
  byStatus: Record<PlotStatus, number>;
  /** 不认识的状态值：单独数出来，不吞掉，总数才对得上 */
  unknown: number;
}

// 合作社看板（屏 11）要用：按状态计数
export function countByStatus(docs: readonly { data: { status?: unknown } }[]): StatusCounts {
  const byStatus = Object.fromEntries(PLOT_STATUSES.map((s) => [s, 0])) as Record<
    PlotStatus,
    number
  >;
  let unknown = 0;
  for (const d of docs) {
    const s = statusOf(d.data.status);
    if (s.key === 'unknown') unknown++;
    else byStatus[s.key]++;
  }
  return { total: docs.length, byStatus, unknown };
}
