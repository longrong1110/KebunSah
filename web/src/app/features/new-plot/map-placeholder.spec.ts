import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { stubHistory } from '../../../testing/back';
import { settle } from '../../../testing/fake-facade';
import { MapPlaceholder } from './map-placeholder';

@Component({ template: '' })
class Blank {}

async function setup(url = '/plots/new/map?member=p9') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'plots/new', component: Blank },
        { path: 'plots/new/map', component: MapPlaceholder },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, MapPlaceholder);
  await settle(harness.fixture);
  return {
    el: harness.fixture.nativeElement as HTMLElement,
    fixture: harness.fixture,
    router: TestBed.inject(Router),
  };
}

describe('MapPlaceholder（屏 5 占位）', () => {
  it('写明「Peta akan datang」', async () => {
    const p = await setup();
    expect(p.el.querySelector('#map-soon')?.textContent).toContain('Peta akan datang');
  });

  it('返回：没有历史就回屏 3，保留 ?member', async () => {
    const p = await setup();
    p.el.querySelector<HTMLButtonElement>('#back')!.click();
    await settle(p.fixture);
    expect(p.router.url).toBe('/plots/new?member=p9');
  });

  it('返回：有历史就后退，不再导航', async () => {
    const p = await setup();
    const back = stubHistory(true);
    p.el.querySelector<HTMLButtonElement>('#back')!.click();
    await settle(p.fixture);
    expect(back).toHaveBeenCalledTimes(1);
    expect(p.router.url).toBe('/plots/new/map?member=p9');
  });
});
