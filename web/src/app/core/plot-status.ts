// 地块状态：值取自 contract/status.md 的 plots.status，不另起别名。
// 标签与图标取自企划书 v3 的「状态与文案规范」：状态永远是「颜色 + 图标 + 文字」三件套，不只靠颜色。

export const PLOT_STATUSES = ['green', 'yellow', 'red', 'needs_review', 'pending'] as const;
export type PlotStatus = (typeof PLOT_STATUSES)[number];

export interface StatusView {
  label: string;
  icon: string;
  /** 对应 styles.scss 里的 .tone-* */
  tone: 'ok' | 'warn' | 'bad' | 'review' | 'idle';
}

export const STATUS_VIEW: Record<PlotStatus, StatusView> = {
  green: { label: 'Lengkap', icon: '✓', tone: 'ok' },
  yellow: { label: 'Perlu semakan', icon: '⚠', tone: 'warn' },
  red: { label: 'Perlu tindakan', icon: '✕', tone: 'bad' },
  // ui-rules-1.png 里没有这个状态，临时标签；10/15 fe/polish 统一
  needs_review: { label: 'Perlu semakan pegawai', icon: '?', tone: 'review' },
  pending: { label: 'Belum mula', icon: '○', tone: 'idle' },
};

export interface StatusCounts {
  total: number;
  byStatus: Record<PlotStatus, number>;
  /** 不认识的状态值：单独数出来，不吞掉，总数才对得上 */
  unknown: number;
}

export function countByStatus(docs: readonly { data: { status?: unknown } }[]): StatusCounts {
  const byStatus = Object.fromEntries(PLOT_STATUSES.map((s) => [s, 0])) as Record<
    PlotStatus,
    number
  >;
  let unknown = 0;
  for (const d of docs) {
    const s = d.data.status;
    if (typeof s === 'string' && (PLOT_STATUSES as readonly string[]).includes(s))
      byStatus[s as PlotStatus]++;
    else unknown++;
  }
  return { total: docs.length, byStatus, unknown };
}

export const ROLE_LABEL: Record<string, string> = {
  smallholder: 'Pekebun kecil',
  field_officer: 'Pegawai lapangan',
  coop_admin: 'Pentadbir koperasi',
};
