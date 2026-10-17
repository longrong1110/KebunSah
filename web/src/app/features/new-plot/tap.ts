// 地图上「点按」怎么判断（纯函数，google-surface.ts 用）。
// 为什么不用 Google 的 click 事件：它会把紧跟的快速第二下当成双击吞掉（浏览器里实测过），
// 农户连点几个角点时会丢点。所以自己看 pointerdown／pointerup。

export interface PointerSample {
  x: number;
  y: number;
  /** performance.now() 的毫秒数 */
  t: number;
}

export interface Px {
  x: number;
  y: number;
}

/** 点按：手指（鼠标）按下与抬起离得不远、时间不长；拖动地图或拖把手不算 */
export const TAP_MAX_MOVE_PX = 8;
export const TAP_MAX_MS = 600;

/** 顶点把手的点击半径（把手图标 44×44 px）：点在已有把手上是选它，不是放新点 */
export const HANDLE_RADIUS_PX = 24;

export function isTap(down: PointerSample, up: PointerSample): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_MAX_MOVE_PX && up.t - down.t <= TAP_MAX_MS;
}

/** 点按位置是否落在任何一个已有把手的半径内（用几何判断，不依赖 Google 的 DOM） */
export function nearAnyHandle(p: Px, handles: readonly Px[], radius = HANDLE_RADIUS_PX): boolean {
  return handles.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < radius);
}

export interface PointerInput {
  pointerId: number;
  /** 触摸时每次按下的第一根手指为 true；鼠标恒为 true */
  isPrimary: boolean;
  /** 鼠标按键（0 = 左键）；触摸与笔恒为 0 */
  button: number;
  pointerType: string;
  x: number;
  y: number;
  t: number;
}

/**
 * 「单指点按」状态机：把 pointerdown／pointerup／pointercancel 变成「是不是一次点按」。
 * - 第二根手指按下（缩放）：作废这一次，直到所有手指抬起后的下一次按下才重新开始
 * - 鼠标的右键、中键不算
 * - 每次「第一根手指」按下时先清掉残留的指针 ID（某个 pointerup／pointercancel 没传过来时自愈）
 */
export class TapTracker {
  private readonly active = new Set<number>();
  private down: (PointerSample & { id: number }) | null = null;

  pointerDown(e: PointerInput): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary) this.active.clear();
    this.active.add(e.pointerId);
    this.down = this.active.size === 1 ? { x: e.x, y: e.y, t: e.t, id: e.pointerId } : null;
  }

  /** 这次抬起是不是一次点按 */
  pointerUp(e: PointerInput): boolean {
    const down = this.down;
    this.down = null;
    this.active.delete(e.pointerId);
    return !!down && down.id === e.pointerId && isTap(down, e);
  }

  pointerCancel(e: Pick<PointerInput, 'pointerId'>): void {
    this.active.delete(e.pointerId);
    this.down = null;
  }
}
