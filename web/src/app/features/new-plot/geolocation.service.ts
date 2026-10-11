import { Injectable } from '@angular/core';
import type { LngLat } from './geometry';

// 定位：一次性高精度读取（「Lokasi saya」「Tandakan sudut di sini」「Guna lokasi saya」用）。
// 不做持续跟踪、不在后台读；权限只在用户点按钮时才请求。失败归成几类固定的人话，不暴露原始错误。

/** 对应词典 newPlot.map.geo 里的键 */
export type GeoErrorKey = 'denied' | 'unsupported' | 'timeout' | 'unavailable';

export class GeoError extends Error {
  constructor(readonly key: GeoErrorKey) {
    super(key);
    this.name = 'GeoError';
  }
}

export interface GeoFix {
  point: LngLat;
  /** 水平精度（米）：真实位置有 ~68% 的把握落在这个半径内 */
  accuracyM: number;
}

/** GeolocationPositionError.code：1 被拒、2 不可用、3 超时；其余一律当「不可用」 */
export function classifyGeoError(err: unknown): GeoErrorKey {
  const code = (err as { code?: number } | null)?.code;
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 };

/**
 * 浏览器自带的 timeout 不含「等用户点允许」的时间：用户不理会权限弹窗时回调永远不来，按钮会一直转。
 * 所以再加一个略长的本地计时器，到点按超时处理（之后才到的结果丢弃）。
 */
export const LOCATE_FALLBACK_MS = 20_000;

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** 读一次当前位置。失败一律抛 GeoError。 */
  locate(): Promise<GeoFix> {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo?.getCurrentPosition) return Promise.reject(new GeoError('unsupported'));
    return new Promise<GeoFix>((resolve, reject) => {
      const timer = setTimeout(() => reject(new GeoError('timeout')), LOCATE_FALLBACK_MS);
      geo.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve({
            point: [pos.coords.longitude, pos.coords.latitude],
            accuracyM: pos.coords.accuracy,
          });
        },
        (err) => {
          clearTimeout(timer);
          reject(new GeoError(classifyGeoError(err)));
        },
        OPTIONS,
      );
    });
  }
}
