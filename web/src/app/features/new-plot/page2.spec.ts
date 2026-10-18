import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../core/api/api.service';
import { settle } from '../../../testing/fake-facade';
import { DocumentsPage } from './documents-page';
import { DraftService, PAGE2_KEY, isDocType, isDraftKey } from './draft.service';
import type { LngLat } from './geometry';
import { ReviewPage } from './review-page';
import { SubmitService } from './submit.service';

// 地契第 2 页（登记持有人的那一页）：可选，不拦「下一步」；提交时登记成 land_title 的第 2 页。

@Component({ template: '' })
class Blank {}

const blob = () => new Blob(['jpeg'], { type: 'image/jpeg' });
const RECT: LngLat[] = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];

let counter = 0;
type UrlStatics = { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
const urlStatics = URL as unknown as UrlStatics;
const original = { create: urlStatics.createObjectURL, revoke: urlStatics.revokeObjectURL };

/** jsdom 没有 createObjectURL：只换这两个静态方法（整个换掉 URL 会让路由器的 new URL 报错），并记录哪些被撤销 */
function stubUrls(): string[] {
  const revoked: string[] = [];
  urlStatics.createObjectURL = () => `blob:test/${++counter}`;
  urlStatics.revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
  return revoked;
}

function restoreUrls(): void {
  urlStatics.createObjectURL = original.create;
  urlStatics.revokeObjectURL = original.revoke;
}

describe('DraftService：地契第 2 页', () => {
  afterEach(() => restoreUrls());

  it('是可选的：拍了不改变三张的状态，也不影响能不能继续', () => {
    stubUrls();
    const draft = TestBed.inject(DraftService);
    expect(draft.page2().status).toBe('pending');
    draft.capture(PAGE2_KEY, blob(), 'camera');
    expect(draft.page2().status).toBe('captured');
    expect(draft.entries().map((e) => e.type)).toEqual(['land_title', 'mspo_cert', 'mpob_licence']);
    expect(draft.entries().every((e) => e.doc.status === 'pending')).toBe(true);
    expect(draft.allResolved()).toBe(false);
    expect(draft.firstPending()).toBe('land_title'); // 相册选图仍然从三张必拍的里面挑
    for (const t of ['land_title', 'mspo_cert', 'mpob_licence'] as const) draft.skip(t);
    expect(draft.allResolved()).toBe(true); // 没拍第 2 页也能继续
  });

  it('撤掉：回到没拍并撤销预览 URL；重拍：替换并撤销旧的', () => {
    const revoked = stubUrls();
    const draft = TestBed.inject(DraftService);
    draft.capture(PAGE2_KEY, blob(), 'camera');
    const first = draft.page2();
    draft.capture(PAGE2_KEY, blob(), 'gallery');
    expect(revoked).toHaveLength(1);
    draft.clear(PAGE2_KEY);
    expect(draft.page2().status).toBe('pending');
    expect(revoked).toHaveLength(2);
    expect(first.status).toBe('captured');
  });

  it('reset 与 begin：第 2 页一起清掉，预览 URL 撤销', () => {
    const revoked = stubUrls();
    const draft = TestBed.inject(DraftService);
    draft.capture(PAGE2_KEY, blob(), 'camera');
    draft.begin(null);
    expect(draft.page2().status).toBe('pending');
    expect(revoked).toHaveLength(1);
  });

  it('路由参数：第 2 页的键被认作草稿键，但不是合同里的 doc_type', () => {
    expect(isDraftKey('land_title_p2')).toBe(true);
    expect(isDraftKey('mpob_licence')).toBe(true);
    expect(isDraftKey('passport')).toBe(false);
    expect(isDocType('land_title_p2')).toBe(false);
  });
});

describe('DocumentsPage：地契第 2 页的卡片', () => {
  afterEach(() => restoreUrls());

  async function setup() {
    stubUrls();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'plots/new', component: DocumentsPage },
          { path: 'plots/new/camera/:doc', component: Blank },
          { path: 'plots/new/map', component: Blank },
        ]),
      ],
    });
    const draft = TestBed.inject(DraftService);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/plots/new?member=p9', DocumentsPage);
    const el = harness.fixture.nativeElement as HTMLElement;
    await settle(harness.fixture);
    return {
      draft,
      el,
      router: TestBed.inject(Router),
      q: (sel: string) => el.querySelector<HTMLElement>(sel),
      text: (sel: string) =>
        el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      click: async (sel: string) => {
        el.querySelector<HTMLElement>(sel)!.click();
        await settle(harness.fixture);
      },
      refresh: () => settle(harness.fixture),
    };
  }

  it('地契还没拍：不出现第 2 页的卡片（先拍第 1 页）', async () => {
    const p = await setup();
    expect(p.q('#doc-land_title_p2')).toBeNull();
    expect(p.q('#page2-hint')).toBeNull();
  });

  it('地契拍好之后出现，写明是可选的和为什么；点它去相机，保留 ?member', async () => {
    const p = await setup();
    p.draft.capture('land_title', blob(), 'camera');
    await p.refresh();
    expect(p.text('#doc-land_title_p2')).toContain('Tambah halaman 2 geran (pilihan)');
    expect(p.text('#page2-hint')).toContain('pemilik berdaftar');
    await p.click('#doc-land_title_p2');
    expect(p.router.url).toBe('/plots/new/camera/land_title_p2?member=p9');
  });

  it('第 2 页拍好：显示已拍和「Buang」；撤掉后回到没拍；全程不影响「Seterusnya」能不能点', async () => {
    const p = await setup();
    p.draft.capture('land_title', blob(), 'camera');
    p.draft.capture(PAGE2_KEY, blob(), 'camera');
    await p.refresh();
    expect(p.text('#doc-land_title_p2')).toContain('Geran tanah · halaman 2');
    expect(p.q('#remove-land_title_p2')?.textContent?.trim()).toBe('Buang');
    expect((p.q('#next') as HTMLButtonElement).disabled).toBe(true); // 另外两张还没处理
    await p.click('#remove-land_title_p2');
    expect(p.draft.page2().status).toBe('pending');
    expect(p.text('#doc-land_title_p2')).toContain('Tambah halaman 2 geran (pilihan)');
    p.draft.skip('mspo_cert');
    p.draft.skip('mpob_licence');
    await p.refresh();
    expect((p.q('#next') as HTMLButtonElement).disabled).toBe(false); // 没拍第 2 页照样能继续
  });
});

describe('SubmitService：地契第 2 页', () => {
  afterEach(() => restoreUrls());

  function fakeApi() {
    let n = 0;
    return {
      createPlot: vi.fn(async () => 'plot-1'),
      saveGeometry: vi.fn(async () => ({})),
      registerDocument: vi.fn(async () => ({
        documentId: `d${++n}`,
        upload: { method: 'PUT', url: `https://up/${n}`, headers: {}, expiresAt: '' },
      })),
      uploadPhoto: vi.fn(async () => undefined),
      assess: vi.fn(async () => 'a-1'),
    };
  }

  function prepare(prep: (d: DraftService) => void) {
    stubUrls();
    const api = fakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    const draft = TestBed.inject(DraftService);
    for (const v of RECT) draft.addVertex('map', v);
    prep(draft);
    return { api, draft, submit: TestBed.inject(SubmitService) };
  }

  it('第 2 页登记成 land_title 的 pageNo = 2，并和第 1 页一起传；第 1 页不带 pageNo（兼容）', async () => {
    const { api, submit } = prepare((d) => {
      d.capture('land_title', blob(), 'camera');
      d.capture(PAGE2_KEY, blob(), 'gallery');
    });
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(2);
    expect(api.registerDocument).toHaveBeenCalledWith('plot-1', {
      docType: 'land_title',
      contentType: 'image/jpeg',
      source: 'camera',
    });
    expect(api.registerDocument).toHaveBeenCalledWith('plot-1', {
      docType: 'land_title',
      contentType: 'image/jpeg',
      source: 'gallery',
      pageNo: 2,
    });
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
  });

  it('没拍第 2 页：不登记；重试时已传好的第 2 页不重传，撤掉再拍的才重传', async () => {
    const { api, draft, submit } = prepare((d) => d.capture('land_title', blob(), 'camera'));
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(1);

    draft.capture(PAGE2_KEY, blob(), 'camera');
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(2);
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(2); // 没变，不重传

    draft.capture(PAGE2_KEY, blob(), 'camera'); // 重拍
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(3);
  });
});

describe('ReviewPage：摘要里的地契第 2 页', () => {
  afterEach(() => restoreUrls());

  it('拍了才列出来', async () => {
    stubUrls();
    TestBed.configureTestingModule({
      providers: [
        { provide: SubmitService, useValue: { run: vi.fn() } },
        provideRouter([
          { path: 'plots/new/map', component: Blank },
          { path: 'plots/new/review', component: ReviewPage },
        ]),
      ],
    });
    const draft = TestBed.inject(DraftService);
    for (const v of RECT) draft.addVertex('map', v);
    draft.capture('land_title', blob(), 'camera');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/plots/new/review', ReviewPage);
    await settle(harness.fixture);
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#review-summary')?.textContent).not.toContain('halaman 2');

    draft.capture(PAGE2_KEY, blob(), 'camera');
    await settle(harness.fixture);
    expect(el.querySelector('#review-summary')?.textContent).toContain('Geran tanah · halaman 2');
  });
});
