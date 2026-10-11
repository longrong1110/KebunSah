import { signal } from '@angular/core';
import { vi } from 'vitest';
import type { LngLat, Ring } from '../app/features/new-plot/geometry';
import type { MapSurface, MapSurfaceHandlers } from '../app/features/new-plot/map-surface';
import { MapsError, type MapsErrorKey } from '../app/features/new-plot/maps.service';

// 屏 5 的页面测试用：整个替换 MapsService（`{ provide: MapsService, useValue: new FakeMaps() }`）。
// 页面只认 MapSurface 接口，所以这里不需要任何 Google 的东西；点按与拖动由测试直接调 handlers 触发。

export class FakeSurface implements MapSurface {
  vertices: Ring = [];
  draggable = false;
  point: LngLat | null = null;
  readonly fitted: (readonly LngLat[])[] = [];
  readonly panned: { p: LngLat; minZoom?: number }[] = [];
  destroyed = 0;

  constructor(readonly handlers: MapSurfaceHandlers) {}

  setVertices(ring: Ring, options: { draggable: boolean }): void {
    this.vertices = ring;
    this.draggable = options.draggable;
  }
  setPoint(p: LngLat | null): void {
    this.point = p;
  }
  fit(points: readonly LngLat[]): void {
    this.fitted.push(points);
  }
  panTo(p: LngLat, minZoom?: number): void {
    this.panned.push({ p, minZoom });
  }
  destroy(): void {
    this.destroyed++;
  }
}

export class FakeMaps {
  /** 与 MapsService 同名同类型：key 被拒的信号 */
  readonly authFailed = signal(false);
  readonly surfaces: FakeSurface[] = [];
  readonly load = vi.fn(() => this.nextLoad());

  /** 'auto'：马上成功；'hold'：挂起，等测试调 resolve()／reject() */
  mode: 'auto' | 'hold' = 'auto';
  failWith: MapsErrorKey | null = null;
  private waiting: { resolve: () => void; reject: (e: unknown) => void } | null = null;

  /** 当前（最新）那张地图 */
  get surface(): FakeSurface {
    const s = this.surfaces[this.surfaces.length - 1];
    if (!s) throw new Error('地图还没创建');
    return s;
  }

  createSurface(_el: HTMLElement, handlers: MapSurfaceHandlers): MapSurface {
    const s = new FakeSurface(handlers);
    this.surfaces.push(s);
    return s;
  }

  resolve(): void {
    this.waiting?.resolve();
    this.waiting = null;
  }

  reject(key: MapsErrorKey): void {
    this.waiting?.reject(new MapsError(key));
    this.waiting = null;
  }

  private nextLoad(): Promise<void> {
    if (this.failWith) return Promise.reject(new MapsError(this.failWith));
    if (this.mode === 'hold') {
      return new Promise<void>((resolve, reject) => (this.waiting = { resolve, reject }));
    }
    return Promise.resolve();
  }
}

/** 假的定位服务：`locate` 由测试决定成功还是失败 */
export function fakeGeolocation() {
  return { locate: vi.fn() };
}
