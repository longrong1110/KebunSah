import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api.service';
import { stubHistory } from '../../../testing/back';
import { settle } from '../../../testing/fake-facade';
import { DraftService } from './draft.service';
import type { LngLat } from './geometry';
import { ReviewPage, submitErrorKey } from './review-page';
import { SubmitService } from './submit.service';

@Component({ template: '' })
class Blank {}

const RECT: LngLat[] = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];

async function setup(
  opts: { preload?: (d: DraftService) => void; run?: ReturnType<typeof vi.fn> } = {},
) {
  const run = opts.run ?? vi.fn(async () => 'plot-7');
  TestBed.configureTestingModule({
    providers: [
      { provide: SubmitService, useValue: { run } },
      provideRouter([
        { path: 'plots/new/map', component: Blank },
        { path: 'plots/:id/checking', component: Blank },
        { path: 'plots/new/review', component: ReviewPage },
      ]),
    ],
  });
  opts.preload?.(TestBed.inject(DraftService));
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/plots/new/review?member=p9', ReviewPage);
  await settle(harness.fixture);
  const el = harness.fixture.nativeElement as HTMLElement;
  return {
    run,
    el,
    fixture: harness.fixture,
    router: TestBed.inject(Router),
    draft: TestBed.inject(DraftService),
    text: (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    click: async (sel: string) => {
      el.querySelector<HTMLButtonElement>(sel)!.click();
      await settle(harness.fixture);
    },
  };
}

const withRect = (d: DraftService) => {
  for (const v of RECT) d.addVertex('map', v);
  d.skip('mspo_cert');
};

describe('submitErrorKey', () => {
  it('把 ApiError 码归成界面文案的几类', () => {
    const k = (code: string) => submitErrorKey(new ApiError(0, code));
    expect(k('network')).toBe('network');
    expect(k('not_configured')).toBe('notConfigured');
    expect(k('unauthenticated')).toBe('unauthenticated');
    expect(k('invalid_token')).toBe('unauthenticated');
    expect(k('forbidden')).toBe('forbidden');
    expect(k('geometry_invalid')).toBe('geometry');
    expect(k('point_area_too_large')).toBe('geometry');
    expect(k('http_error')).toBe('generic');
    expect(submitErrorKey(new Error('boom'))).toBe('generic');
  });
});

describe('ReviewPage（屏 6）', () => {
  it('画好的多边形：写明方式、面积与三份文档的状态，有「开始检查」按钮', async () => {
    const p = await setup({ preload: withRect });
    expect(p.text('#review-method')).toBe('Dilukis di peta');
    expect(p.text('#review-area')).toBe('Keluasan: ≈ 4.08 ha');
    expect(p.text('#review-summary')).toContain('Sijil MSPO Dilangkau');
    expect(p.text('#start')).toBe('Mulakan semakan');
    expect(p.el.querySelectorAll('.progress__seg--on')).toHaveLength(3);
    expect(p.el.querySelector('#review-error')).toBeNull();
  });

  it('只记一个点：写「Keluasan dinyatakan」', async () => {
    const p = await setup({
      preload: (d) => {
        d.setTab('point');
        d.setPoint([101.1, 4.3]);
        d.setDeclared('2,5');
      },
    });
    expect(p.text('#review-method')).toBe('Satu titik');
    expect(p.text('#review-area')).toBe('Keluasan dinyatakan: 2.5 ha');
  });

  it('点「开始检查」：提交成功就去屏 7，并清掉草稿', async () => {
    const p = await setup({ preload: withRect });
    await p.click('#start');
    expect(p.run).toHaveBeenCalledTimes(1);
    expect(p.router.url).toBe('/plots/plot-7/checking');
    expect(p.draft.geometry()).toBeNull(); // reset 过
  });

  it('提交中：按钮禁用、显示当前步骤，不能重复点', async () => {
    let release!: (id: string) => void;
    let report!: (p: { step: 'docs'; done: number; total: number }) => void;
    const run = vi.fn(
      (onProgress: typeof report) =>
        new Promise<string>((resolve) => {
          report = onProgress;
          release = resolve;
        }),
    );
    const p = await setup({ preload: withRect, run });
    await p.click('#start');
    report({ step: 'docs', done: 1, total: 2 });
    await settle(p.fixture);
    expect(p.el.querySelector<HTMLButtonElement>('#start')!.disabled).toBe(true);
    expect(p.text('#review-working')).toBe('Memuat naik dokumen (1/2)…');
    await p.click('#start');
    expect(run).toHaveBeenCalledTimes(1);
    release('plot-7');
    await settle(p.fixture);
    expect(p.router.url).toBe('/plots/plot-7/checking');
  });

  it('提交失败：留在本页，写明原因，按钮变「Cuba lagi」，草稿还在，可以重试', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'network'))
      .mockResolvedValueOnce('plot-7');
    const p = await setup({ preload: withRect, run });
    await p.click('#start');
    expect(p.router.url).toBe('/plots/new/review?member=p9');
    expect(p.el.querySelector('#review-error')?.getAttribute('role')).toBe('alert');
    expect(p.text('#review-error')).toContain('Tiada sambungan ke pelayan');
    expect(p.text('#start')).toBe('Cuba lagi');
    expect(p.draft.geometry()).not.toBeNull();
    await p.click('#start');
    expect(p.router.url).toBe('/plots/plot-7/checking');
    expect(p.el.querySelector('#review-error')).toBeNull();
  });

  it('草稿里没有可完成的几何（直接打开）：一句说明和回屏 5 的按钮，没有「开始检查」', async () => {
    const p = await setup();
    expect(p.text('#review-none')).toBe('Belum ada tanah direkodkan.');
    expect(p.el.querySelector('#start')).toBeNull();
    await p.click('#to-map');
    expect(p.router.url).toBe('/plots/new/map?member=p9');
  });

  it('返回：没有历史回屏 5（保留 ?member）', async () => {
    const p = await setup();
    await p.click('#back');
    expect(p.router.url).toBe('/plots/new/map?member=p9');
  });

  it('返回：有历史就后退，不再导航', async () => {
    const p = await setup();
    const back = stubHistory(true);
    await p.click('#back');
    expect(back).toHaveBeenCalledTimes(1);
    expect(p.router.url).toBe('/plots/new/review?member=p9');
  });
});
