import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  GeoError,
  GeolocationService,
  LOCATE_FALLBACK_MS,
  classifyGeoError,
} from './geolocation.service';

type Success = (pos: unknown) => void;
type Failure = (err: unknown) => void;

function stubGeolocation(impl: (ok: Success, fail: Failure, options: PositionOptions) => void) {
  const getCurrentPosition = vi.fn(impl);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  TestBed.resetTestingModule();
  return { service: TestBed.inject(GeolocationService), getCurrentPosition };
}

describe('GeolocationService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('成功：给出 [经度, 纬度] 与精度（米）', async () => {
    const { service } = stubGeolocation((ok) =>
      ok({ coords: { latitude: 4.325, longitude: 101.162, accuracy: 6.4 } }),
    );
    await expect(service.locate()).resolves.toEqual({ point: [101.162, 4.325], accuracyM: 6.4 });
  });

  it('要高精度、不用缓存的位置、15 秒超时', async () => {
    const { service, getCurrentPosition } = stubGeolocation((ok) =>
      ok({ coords: { latitude: 1, longitude: 2, accuracy: 3 } }),
    );
    await service.locate();
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });

  it('被拒绝（code 1）→ denied', async () => {
    const { service } = stubGeolocation((_ok, fail) => fail({ code: 1, message: 'User denied' }));
    await expect(service.locate()).rejects.toMatchObject({ name: 'GeoError', key: 'denied' });
  });

  it('超时（code 3）→ timeout', async () => {
    const { service } = stubGeolocation((_ok, fail) => fail({ code: 3 }));
    await expect(service.locate()).rejects.toMatchObject({ key: 'timeout' });
  });

  it('位置不可用（code 2）或别的错误 → unavailable', async () => {
    const { service } = stubGeolocation((_ok, fail) => fail({ code: 2 }));
    await expect(service.locate()).rejects.toMatchObject({ key: 'unavailable' });
    expect(classifyGeoError(new Error('boom'))).toBe('unavailable');
    expect(classifyGeoError(null)).toBe('unavailable');
  });

  it('用户一直不理会权限弹窗（回调永远不来）：20 秒后按超时处理；之后才到的结果丢弃', async () => {
    vi.useFakeTimers();
    let late!: Success;
    const { service } = stubGeolocation((ok) => (late = ok));
    const settled = service.locate().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(LOCATE_FALLBACK_MS);
    expect(await settled).toMatchObject({ key: 'timeout' });
    expect(() => late({ coords: { latitude: 1, longitude: 2, accuracy: 3 } })).not.toThrow();
    vi.useRealTimers();
  });

  it('浏览器没有定位功能 → unsupported（不抛 TypeError）', async () => {
    vi.stubGlobal('navigator', {});
    TestBed.resetTestingModule();
    const service = TestBed.inject(GeolocationService);
    const err = await service.locate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeoError);
    expect(err).toMatchObject({ key: 'unsupported' });
  });
});
