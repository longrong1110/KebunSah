import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ApiService } from '../../core/api/api.service';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { plot } from '../../../testing/assessment-fixtures';
import { stubHistory } from '../../../testing/back';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { ConfirmPage, confirmErrorKey } from './confirm-page';

@Component({ template: '' })
class Blank {}

const DOCS = [
  {
    id: 'lic1',
    data: {
      docType: 'mpob_licence',
      pageNo: 1,
      isCurrent: true,
      fields: {
        'mpob_licence.valid_until': {
          rawText: '0?/12/2026',
          normalizedValue: '0?/12/2026',
          confidence: 0.2,
        },
        'mpob_licence.holder_name': {
          rawText: 'TAN AH KOW',
          normalizedValue: 'TAN AH KOW',
          confidence: 0.95,
        },
      },
    },
  },
  {
    id: 'title1',
    data: {
      docType: 'land_title',
      pageNo: 1,
      isCurrent: true,
      fields: {
        'land_title.area_value': {
          rawText: '3.O4 Hektar',
          normalizedValue: '3.0400',
          confidence: 0.55,
        },
        'land_title.lot_no': { rawText: '2217', normalizedValue: '2217', confidence: 0.99 },
      },
    },
  },
];

async function setup(
  opts: { docs?: unknown[]; api?: Partial<Record<string, unknown>>; url?: string } = {},
) {
  const facade = new FakeFacade();
  const api = {
    confirmFields: vi.fn(async () => undefined),
    assess: vi.fn(async () => 'a-1'),
    documentImage: vi.fn(async () => ({ url: 'https://photo/1.jpg', expiresAt: '' })),
    ...opts.api,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'plots/:id', component: Blank },
        { path: 'plots/:id/checking', component: Blank },
        { path: 'plots/:id/confirm', component: ConfirmPage },
      ]),
      { provide: FIRESTORE_FACADE, useValue: facade },
      { provide: ApiService, useValue: api },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(opts.url ?? '/plots/p1/confirm', ConfirmPage);
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  facade.emitDoc('plots/p1', plot());
  facade.emitCollection(
    'plots/p1/documents',
    (opts.docs ?? DOCS) as { id: string; data: Record<string, unknown> }[],
  );
  await settle(fixture);
  return {
    api,
    el,
    facade,
    fixture,
    router: TestBed.inject(Router),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    all: (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)],
    text: (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    type: async (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle(fixture);
    },
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
  };
}

describe('confirmErrorKey', () => {
  it('把 ApiError 归成界面文案的几类；400 是值的格式不对', () => {
    expect(confirmErrorKey(new ApiError(400, 'invalid_value'))).toBe('format');
    expect(confirmErrorKey(new ApiError(400, 'unknown_field'))).toBe('format');
    expect(confirmErrorKey(new ApiError(0, 'network'))).toBe('network');
    expect(confirmErrorKey(new ApiError(0, 'not_configured'))).toBe('notConfigured');
    expect(confirmErrorKey(new ApiError(401, 'invalid_token'))).toBe('unauthenticated');
    expect(confirmErrorKey(new ApiError(403, 'forbidden'))).toBe('forbidden');
    expect(confirmErrorKey(new ApiError(500, 'http_error'))).toBe('generic');
    expect(confirmErrorKey(new Error('boom'))).toBe('generic');
  });
});

describe('ConfirmPage（屏 8）', () => {
  it('只列读不准的字段，按文件分组（地契在前），读得准的不出现；写明纸面原文', async () => {
    const t = await setup();
    const groups = t.all('.confirm-doc');
    expect(groups.map((g) => g.getAttribute('data-doc'))).toEqual(['title1', 'lic1']);
    expect(groups[0].textContent).toContain('Geran tanah');
    expect(groups[0].textContent).toContain('Keluasan tanah');
    expect(groups[0].textContent).toContain('Kami baca: “3.O4 Hektar”');
    expect(groups[1].textContent).toContain('Lesen sah sehingga');
    expect(t.el.textContent).not.toContain('Nombor lot'); // lot_no 置信度 0.99：不打扰
    expect(t.el.textContent).not.toContain('Pemegang lesen');
    expect(t.all('input.field')).toHaveLength(2);
  });

  it('输入框里是读出的值；读不出来的是空的，并提示照着文件输入', async () => {
    const t = await setup({
      docs: [
        {
          id: 'd',
          data: {
            docType: 'mpob_licence',
            fields: {
              'mpob_licence.valid_until': { rawText: '', normalizedValue: '', confidence: 0.1 },
            },
          },
        },
      ],
    });
    expect(t.el.querySelector<HTMLInputElement>('input.field')!.value).toBe('');
    expect(t.el.textContent).toContain('Kami tidak dapat membaca yang ini');
  });

  it('全部确认：没改的按读出的值提交，改过的按改的；每个文件一次；再重新评估，去屏 7', async () => {
    const t = await setup();
    await t.type('#field-lic1-mpob_licence-valid_until', '2026-12-05');
    await t.click('#confirm-save');
    expect(t.api.confirmFields).toHaveBeenCalledTimes(2);
    expect(t.api.confirmFields).toHaveBeenCalledWith('title1', {
      'land_title.area_value': '3.0400',
    });
    expect(t.api.confirmFields).toHaveBeenCalledWith('lic1', {
      'mpob_licence.valid_until': '2026-12-05',
    });
    expect(t.api.assess).toHaveBeenCalledWith('p1');
    expect(t.router.url).toBe('/plots/p1/checking');
  });

  it('有空值：不提交，写明；填上之后提示消失', async () => {
    const t = await setup();
    await t.type('#field-lic1-mpob_licence-valid_until', '   ');
    await t.click('#confirm-save');
    expect(t.api.confirmFields).not.toHaveBeenCalled();
    expect(t.text('#confirm-error')).toContain('Sila isi setiap nilai');
    expect(t.q('#field-lic1-mpob_licence-valid_until')?.getAttribute('aria-invalid')).toBe('true');
    await t.type('#field-lic1-mpob_licence-valid_until', '2026-12-05');
    expect(t.q('#confirm-error')).toBeNull();
  });

  it('后端说格式不对（400）：留在本页，写明怎么写，已填的不丢，可以再提交', async () => {
    const confirmFields = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, 'invalid_value'))
      .mockResolvedValue(undefined);
    const t = await setup({ api: { confirmFields } });
    await t.type('#field-lic1-mpob_licence-valid_until', 'next week');
    await t.click('#confirm-save');
    expect(t.router.url).toBe('/plots/p1/confirm');
    expect(t.text('#confirm-error')).toContain('format');
    expect(t.api.assess).not.toHaveBeenCalled();
    expect(
      t.el.querySelector<HTMLInputElement>('#field-lic1-mpob_licence-valid_until')!.value,
    ).toBe('next week');
    await t.type('#field-lic1-mpob_licence-valid_until', '2026-12-05');
    await t.click('#confirm-save');
    expect(t.router.url).toBe('/plots/p1/checking');
  });

  it('断网：写明原因，按钮可再点', async () => {
    const t = await setup({
      api: { confirmFields: vi.fn().mockRejectedValue(new ApiError(0, 'network')) },
    });
    await t.click('#confirm-save');
    expect(t.text('#confirm-error')).toContain('Tiada sambungan ke pelayan');
    expect((t.q('#confirm-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('评估已经在跑（409）：当作成功，去屏 7', async () => {
    const assess = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'assessment_in_progress', { assessmentId: 'a-0' }));
    const t = await setup({ api: { assess } });
    await t.click('#confirm-save');
    expect(t.router.url).toBe('/plots/p1/checking');
  });

  it('没有要确认的字段：一句说明，按钮是「Semak semula」，只重新评估', async () => {
    const t = await setup({
      docs: [
        {
          id: 'd',
          data: { docType: 'land_title', fields: { 'land_title.lot_no': { confidence: 0.99 } } },
        },
      ],
    });
    expect(t.q('#confirm-none')).not.toBeNull();
    expect(t.text('#confirm-save')).toBe('Semak semula');
    await t.click('#confirm-save');
    expect(t.api.confirmFields).not.toHaveBeenCalled();
    expect(t.api.assess).toHaveBeenCalledWith('p1');
    expect(t.router.url).toBe('/plots/p1/checking');
  });

  it('看原件：点一下取网址并显示，再点收起；照片没传上来（404）写明没有', async () => {
    const t = await setup();
    await t.click('#photo-toggle-lic1');
    expect(t.api.documentImage).toHaveBeenCalledWith('lic1');
    expect(t.q('#photo-lic1')?.getAttribute('src')).toBe('https://photo/1.jpg');
    expect(t.text('#photo-toggle-lic1')).toBe('Sembunyi gambar');
    await t.click('#photo-toggle-lic1');
    expect(t.q('#photo-lic1')).toBeNull();

    t.api.documentImage.mockRejectedValueOnce(new ApiError(404, 'image_not_found'));
    await t.click('#photo-toggle-title1');
    expect(t.text('#photo-missing-title1')).toBe('Tiada gambar untuk dokumen ini.');
  });

  it('只有「确认」成功之后才跳走；跳走时替换历史，屏 7 的返回不会回到确认页', async () => {
    const t = await setup();
    await t.click('#confirm-save');
    expect(t.router.url).toBe('/plots/p1/checking');
  });

  it('返回：没有历史去这块地的结果页，保留 ?member', async () => {
    const t = await setup({ url: '/plots/p1/confirm?member=m9' });
    await t.click('#confirm-back');
    expect(t.router.url).toBe('/plots/p1?member=m9');
  });

  it('← 有历史就后退，不再导航', async () => {
    const t = await setup();
    const back = stubHistory(true);
    await t.click('#back');
    expect(back).toHaveBeenCalledTimes(1);
    expect(t.router.url).toBe('/plots/p1/confirm');
  });
});
