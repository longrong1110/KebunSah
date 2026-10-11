import type { LngLat, Ring } from './geometry';

// 屏 5 的地图只通过这个接口被页面使用：页面和测试都不碰 `google.maps`，换底图只改实现（google-surface.ts）。
// 顶点数组（DraftService 里）是唯一的事实来源：这里只负责「显示」和「把点按、拖动报告出来」。

export interface MapSurfaceHandlers {
  /** 点按空地（不是点在把手上、也不是拖动地图）；坐标是 [经度, 纬度] */
  onTap(p: LngLat): void;
  /** 拖动第 index 个把手，拖动过程中连续回调，抬手时再回调一次最终位置 */
  onVertexMove(index: number, p: LngLat): void;
}

export interface MapSurface {
  /** 画这一圈顶点（多边形 + 把手）。draggable 为 false 时把手不可拖动（走角点页签） */
  setVertices(ring: Ring, options: { draggable: boolean }): void;
  /** 「Satu titik」页签的那个点；null 清掉 */
  setPoint(p: LngLat | null): void;
  /** 让这些点都进入视野（一个点就移过去并放大到至少 17） */
  fit(points: readonly LngLat[]): void;
  /** 地图移到这里，缩放至少到 minZoom */
  panTo(p: LngLat, minZoom?: number): void;
  /** 离开页面时释放监听与把手 */
  destroy(): void;
}
