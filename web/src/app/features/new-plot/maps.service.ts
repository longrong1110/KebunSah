import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { GoogleSurface } from './google-surface';
import type { MapSurface, MapSurfaceHandlers } from './map-surface';

// Google Maps JS 的加载（只在进屏 5 时才动态加 <script>，不进初始包）与创建地图。
// 页面只和 MapsService、MapSurface 打交道，测试里整个换成假的（src/testing/fake-maps.ts）。

/** 对应词典 newPlot.map.state 里的键 */
export type MapsErrorKey = 'no-key' | 'offline' | 'timeout' | 'script';

export class MapsError extends Error {
  constructor(readonly key: MapsErrorKey) {
    super(key);
    this.name = 'MapsError';
  }
}

/** Maps 浏览器 key。生产文件里是空串（没配置）；测试里可以换 */
export const MAPS_API_KEY = new InjectionToken<string>('MAPS_API_KEY', {
  providedIn: 'root',
  factory: () => environment.mapsApiKey,
});

export const MAPS_LOAD_TIMEOUT_MS = 15_000;

const CALLBACK = '__kebunsahMapsReady';

type MapsWindow = Window & {
  google?: { maps?: { Map?: unknown } };
  gm_authFailure?: () => void;
  [CALLBACK]?: () => void;
};

@Injectable({ providedIn: 'root' })
export class MapsService {
  private readonly doc = inject(DOCUMENT);
  private readonly key = inject(MAPS_API_KEY);
  private pending: Promise<void> | null = null;
  private script: HTMLScriptElement | null = null;

  /**
   * Google 在 key 被拒（过期、没开 API、来源不对…）时只调用 window.gm_authFailure，脚本本身仍然加载成功，
   * 所以这是另一个信号：页面看到它为 true 就显示「key 被拒」。重试没有用（key 的问题不会因重试好转）。
   */
  readonly authFailed = signal(false);

  /** 加载 Google Maps JS；已经加载过直接成功；同时多次调用只加载一次；失败后可以重试 */
  load(): Promise<void> {
    const win = this.doc.defaultView as MapsWindow | null;
    if (win?.google?.maps?.Map) return Promise.resolve();
    if (this.pending) return this.pending;
    if (!win) return Promise.reject(new MapsError('script'));
    if (!this.key) return Promise.reject(new MapsError('no-key'));
    if (win.navigator && win.navigator.onLine === false)
      return Promise.reject(new MapsError('offline'));

    win.gm_authFailure = () => this.authFailed.set(true);
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new MapsError('timeout')), MAPS_LOAD_TIMEOUT_MS);
      win[CALLBACK] = () => {
        clearTimeout(timer);
        resolve();
      };
      const script = this.script ?? this.addScript();
      script.onerror = () => {
        clearTimeout(timer);
        reject(new MapsError('script'));
      };
    });
    this.pending = promise.catch((err: unknown) => {
      this.pending = null;
      // 脚本加载出错：撤掉 <script> 与回调，下次 load() 重新来。
      // 超时则保留它们：慢网络下脚本可能还会到，重试时复用同一份，不再追加第二份（Google 会报「重复加载」）
      if (err instanceof MapsError && err.key === 'script') {
        this.script?.remove();
        this.script = null;
        delete win[CALLBACK];
      }
      throw err;
    });
    return this.pending;
  }

  private addScript(): HTMLScriptElement {
    const script = this.doc.createElement('script');
    // v=quarterly：季度更新的稳定通道，不用 weekly（上线前不想被每周变更影响）。language：控件文字跟当时的界面语言（之后切换不重载）
    const language = this.doc.documentElement.lang === 'en' ? 'en' : 'ms';
    script.src =
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(this.key) +
      `&v=quarterly&loading=async&region=MY&language=${language}&callback=${CALLBACK}`;
    script.async = true;
    // 常驻的出错监听：超时后保留的 <script> 若之后才报错（慢网络下浏览器很久后才放弃），撤掉它，下次 load() 重新添加；
    // 不然「Cuba lagi」会一直复用一个永远等不到回调的死元素
    script.addEventListener('error', () => {
      if (this.script !== script) return;
      script.remove();
      this.script = null;
      delete (this.doc.defaultView as MapsWindow | null)?.[CALLBACK];
    });
    this.doc.head.appendChild(script);
    this.script = script;
    return script;
  }

  /** 在 el 里创建卫星地图；必须在 load() 成功之后调用 */
  createSurface(el: HTMLElement, handlers: MapSurfaceHandlers): MapSurface {
    return new GoogleSurface(el, handlers);
  }
}
