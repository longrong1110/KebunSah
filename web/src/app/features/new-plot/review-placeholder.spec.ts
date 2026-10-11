import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { stubHistory } from '../../../testing/back';
import { settle } from '../../../testing/fake-facade';
import { DraftService } from './draft.service';
import type { LngLat } from './geometry';
import { ReviewPlaceholder } from './review-placeholder';

@Component({ template: '' })
class Blank {}

const RECT: LngLat[] = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];

async function setup(preload?: (d: DraftService) => void) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'plots/new/map', component: Blank },
        { path: 'plots/new/review', component: ReviewPlaceholder },
      ]),
    ],
  });
  preload?.(TestBed.inject(DraftService));
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/plots/new/review?member=p9', ReviewPlaceholder);
  await settle(harness.fixture);
  const el = harness.fixture.nativeElement as HTMLElement;
  return {
    el,
    fixture: harness.fixture,
    router: TestBed.inject(Router),
    text: (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}

describe('ReviewPlaceholder（屏 6 的壳）', () => {
  it('画好的多边形：写明方式、面积与三份文档的状态', async () => {
    const p = await setup((d) => {
      for (const v of RECT) d.addVertex('map', v);
      d.skip('mspo_cert');
    });
    expect(p.text('#review-method')).toBe('Dilukis di peta');
    expect(p.text('#review-area')).toBe('Keluasan: ≈ 4.08 ha');
    expect(p.text('#review-summary')).toContain('Geran tanah —');
    expect(p.text('#review-summary')).toContain('Sijil MSPO Dilangkau');
    expect(p.text('#review-soon')).toContain('Langkah 3');
    expect(p.el.querySelectorAll('.progress__seg--on')).toHaveLength(3);
  });

  it('只记一个点：写「Keluasan dinyatakan」', async () => {
    const p = await setup((d) => {
      d.setTab('point');
      d.setPoint([101.1, 4.3]);
      d.setDeclared('2,5');
    });
    expect(p.text('#review-method')).toBe('Satu titik');
    expect(p.text('#review-area')).toBe('Keluasan dinyatakan: 2.5 ha');
  });

  it('草稿里没有可完成的几何（直接打开）：一句说明和回屏 5 的按钮，不报错', async () => {
    const p = await setup();
    expect(p.text('#review-none')).toBe('Belum ada tanah direkodkan.');
    p.el.querySelector<HTMLButtonElement>('#to-map')!.click();
    await settle(p.fixture);
    expect(p.router.url).toBe('/plots/new/map?member=p9');
  });

  it('返回：没有历史回屏 5（保留 ?member）', async () => {
    const p = await setup();
    p.el.querySelector<HTMLButtonElement>('#back')!.click();
    await settle(p.fixture);
    expect(p.router.url).toBe('/plots/new/map?member=p9');
  });

  it('返回：有历史就后退，不再导航', async () => {
    const p = await setup();
    const back = stubHistory(true);
    p.el.querySelector<HTMLButtonElement>('#back')!.click();
    await settle(p.fixture);
    expect(back).toHaveBeenCalledTimes(1);
    expect(p.router.url).toBe('/plots/new/review?member=p9');
  });
});
