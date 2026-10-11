import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MAPS_API_KEY, MAPS_LOAD_TIMEOUT_MS, MapsError, MapsService } from './maps.service';

type W = Window & {
  google?: unknown;
  gm_authFailure?: () => void;
  __kebunsahMapsReady?: () => void;
};
const win = window as unknown as W;

function setup(key = 'test-key') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: MAPS_API_KEY, useValue: key }] });
  return TestBed.inject(MapsService);
}

const scripts = () =>
  Array.from(
    document.head.querySelectorAll<HTMLScriptElement>('script[src*="maps.googleapis.com"]'),
  );

describe('MapsService.load', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    scripts().forEach((s) => s.remove());
    delete win.google;
    delete win.gm_authFailure;
    delete win.__kebunsahMapsReady;
  });

  it('没有 key：no-key，不加任何 <script>', async () => {
    const maps = setup('');
    await expect(maps.load()).rejects.toMatchObject({ name: 'MapsError', key: 'no-key' });
    expect(scripts()).toHaveLength(0);
  });

  it('离线：offline，不加 <script>', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const maps = setup();
    await expect(maps.load()).rejects.toMatchObject({ key: 'offline' });
    expect(scripts()).toHaveLength(0);
  });

  it('成功：加一个带 key 与回调的 <script>，Google 调回调后 resolve；同时多次调用只加载一次', async () => {
    const maps = setup('abc 123');
    const first = maps.load();
    const second = maps.load();
    expect(scripts()).toHaveLength(1);
    const src = scripts()[0].src;
    expect(src).toContain('https://maps.googleapis.com/maps/api/js?key=abc%20123');
    expect(src).toContain('callback=__kebunsahMapsReady');
    expect(src).toContain('loading=async');
    expect(src).toContain('language=ms');
    win.__kebunsahMapsReady?.();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('已经有 google.maps.Map：直接成功，不再加 <script>', async () => {
    win.google = { maps: { Map: class {} } };
    const maps = setup();
    await expect(maps.load()).resolves.toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it('脚本加载出错：script，撤掉那个 <script>，再调用可以重来', async () => {
    const maps = setup();
    const first = maps.load();
    scripts()[0].dispatchEvent(new Event('error'));
    await expect(first).rejects.toMatchObject({ key: 'script' });
    expect(scripts()).toHaveLength(0);

    const retry = maps.load();
    expect(scripts()).toHaveLength(1);
    win.__kebunsahMapsReady?.();
    await expect(retry).resolves.toBeUndefined();
  });

  it('15 秒内没有回调：timeout；<script> 保留，重试复用它，不追加第二份；晚到的回调让重试成功', async () => {
    vi.useFakeTimers();
    const maps = setup();
    const settled = maps.load().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(MAPS_LOAD_TIMEOUT_MS);
    const err = await settled;
    expect(err).toBeInstanceOf(MapsError);
    expect(err).toMatchObject({ key: 'timeout' });
    expect(scripts()).toHaveLength(1);

    const retry = maps.load();
    expect(scripts()).toHaveLength(1);
    win.__kebunsahMapsReady?.();
    await expect(retry).resolves.toBeUndefined();
  });

  it('超时后保留的 <script> 之后才报错：撤掉它，再重试会加载新的一份', async () => {
    vi.useFakeTimers();
    const maps = setup();
    const settled = maps.load().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(MAPS_LOAD_TIMEOUT_MS);
    expect(await settled).toMatchObject({ key: 'timeout' });
    scripts()[0].dispatchEvent(new Event('error'));
    expect(scripts()).toHaveLength(0);

    const retry = maps.load();
    expect(scripts()).toHaveLength(1);
    win.__kebunsahMapsReady?.();
    await expect(retry).resolves.toBeUndefined();
  });

  it('Google 报告 key 被拒（gm_authFailure）：authFailed 变 true', async () => {
    const maps = setup();
    const p = maps.load();
    expect(maps.authFailed()).toBe(false);
    win.__kebunsahMapsReady?.();
    await p;
    win.gm_authFailure?.();
    expect(maps.authFailed()).toBe(true);
  });
});
