import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, vi } from 'vitest';
import { BackNavigator } from './back-navigator';

@Component({ template: '' })
class Blank {}

async function setup(url = '/b?member=m9') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'a', component: Blank },
        { path: 'b', component: Blank },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return {
    nav: TestBed.inject(BackNavigator),
    router: TestBed.inject(Router),
    location: TestBed.inject(Location),
  };
}

const setHistoryLength = (n: number) =>
  Object.defineProperty(window.history, 'length', { value: n, configurable: true });
const setNavigation = (canGoBack: boolean) =>
  Object.defineProperty(window, 'navigation', { value: { canGoBack }, configurable: true });

describe('BackNavigator', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window.history as unknown as Record<string, unknown>)['length'];
    delete (window as unknown as Record<string, unknown>)['navigation'];
  });

  describe('canGoBack', () => {
    it('测试环境里没有 Navigation API、history.length 是 1：没有上一条', async () => {
      const { nav } = await setup();
      expect(nav.canGoBack()).toBe(false);
    });

    it('没有 Navigation API：history.length > 1 就算有', async () => {
      const { nav } = await setup();
      setHistoryLength(3);
      expect(nav.canGoBack()).toBe(true);
    });

    it('有 Navigation API：以它为准，不看 history.length（后者含「前进」条目，会误判）', async () => {
      const { nav } = await setup();
      setHistoryLength(3);
      setNavigation(false); // 当前页之前没有同源条目，只是后面还有前进条目
      expect(nav.canGoBack()).toBe(false);
      setHistoryLength(1);
      setNavigation(true);
      expect(nav.canGoBack()).toBe(true);
    });
  });

  describe('back', () => {
    it('有历史：Location.back()，不再导航，URL 不变', async () => {
      const { nav, router, location } = await setup();
      setHistoryLength(3);
      const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
      const navigate = vi.spyOn(router, 'navigate');
      nav.back(['/a'], { queryParamsHandling: 'preserve' });
      expect(back).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe('/b?member=m9');
    });

    it('没有历史：替换成兜底路径（replaceUrl），extras 生效（保留 ?member）', async () => {
      const { nav, router, location } = await setup();
      const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
      const navigate = vi.spyOn(router, 'navigate');
      nav.back(['/a'], { queryParamsHandling: 'preserve' });
      await vi.waitFor(() => expect(router.url).toBe('/a?member=m9'));
      expect(back).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/a'], {
        queryParamsHandling: 'preserve',
        replaceUrl: true,
      });
    });

    it('兜底路径是 []（相对当前页）时也能带 queryParams', async () => {
      const { nav, router } = await setup();
      nav.back([], { queryParams: { member: null }, queryParamsHandling: 'merge' });
      await vi.waitFor(() => expect(router.url).toBe('/b'));
    });

    it('一次后退还没生效时忽略重复点击（连点两次会各退一步，从屏 4 退过屏 3 到屏 2）', async () => {
      const { nav, location } = await setup();
      setHistoryLength(3);
      const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
      nav.back(['/a']);
      nav.back(['/a']);
      nav.back(['/a']);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it('后退生效（路由器跑完一次导航）后，下一次点击又能后退', async () => {
      const { nav, router, location } = await setup();
      setHistoryLength(3);
      const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
      nav.back(['/a']);
      await router.navigateByUrl('/a'); // 模拟后退触发的那次导航完成
      nav.back(['/a']);
      expect(back).toHaveBeenCalledTimes(2);
    });

    it('万一没有任何导航发生，800ms 后也解除，按钮不会永远失灵', async () => {
      vi.useFakeTimers();
      const { nav, location } = await setup();
      setHistoryLength(3);
      const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
      nav.back(['/a']);
      nav.back(['/a']);
      expect(back).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(800);
      nav.back(['/a']);
      expect(back).toHaveBeenCalledTimes(2);
    });
  });
});
