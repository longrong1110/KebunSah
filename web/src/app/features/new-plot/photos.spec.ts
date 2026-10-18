import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageFile, stubImagePipeline, type ImagePipelineStub } from '../../../testing/fake-image';
import { settle } from '../../../testing/fake-facade';
import { ApiService } from '../../core/api/api.service';
import { DocumentsPage } from './documents-page';
import { DraftService, MAX_PAGES } from './draft.service';
import type { LngLat } from './geometry';
import { ReviewPage } from './review-page';
import { SubmitService } from './submit.service';

// 每份文件可以有好几页（最多 4 张照片）：草稿、屏 3 的卡片、提交、屏 6 的摘要。

@Component({ template: '' })
class Blank {}

const blob = () => new Blob(['jpeg'], { type: 'image/jpeg' });
const RECT: LngLat[] = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];

type UrlStatics = { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
const urlStatics = URL as unknown as UrlStatics;
const original = { create: urlStatics.createObjectURL, revoke: urlStatics.revokeObjectURL };
let counter = 0;

/** jsdom 没有 createObjectURL：只换这两个静态方法（整个换掉 URL 会让路由器的 new URL 报错），并记录哪些被撤销 */
function stubUrls(): string[] {
  const revoked: string[] = [];
  urlStatics.createObjectURL = () => `blob:test/${++counter}`;
  urlStatics.revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
  return revoked;
}
const restoreUrls = () => {
  urlStatics.createObjectURL = original.create;
  urlStatics.revokeObjectURL = original.revoke;
};

describe('DraftService：一份文件的好几页', () => {
  afterEach(restoreUrls);

  it('加一页：变已拍；第一页同时放在 blob／url／source 上（按「一张照片」读的老代码照常）；页按加的顺序', () => {
    stubUrls();
    const draft = TestBed.inject(DraftService);
    const a = blob();
    const b = blob();
    expect(draft.addPage('land_title', a, 'camera')).toBe(true);
    expect(draft.addPage('land_title', b, 'gallery')).toBe(true);
    const doc = draft.doc('land_title');
    expect(doc.status).toBe('captured');
    if (doc.status !== 'captured') return;
    expect(doc.pages.map((p) => [p.blob, p.source])).toEqual([
      [a, 'camera'],
      [b, 'gallery'],
    ]);
    expect(doc.blob).toBe(a);
    expect(doc.url).toBe(doc.pages[0].url);
    expect(draft.pagesOf('land_title')).toHaveLength(2);
    expect(draft.pagesOf('mspo_cert')).toEqual([]);
  });

  it(`最多 ${MAX_PAGES} 页：满了再加返回 false，什么都不变`, () => {
    stubUrls();
    const draft = TestBed.inject(DraftService);
    for (let i = 0; i < MAX_PAGES; i++)
      expect(draft.addPage('mpob_licence', blob(), 'camera')).toBe(true);
    const before = draft.pagesOf('mpob_licence');
    expect(draft.addPage('mpob_licence', blob(), 'camera')).toBe(false);
    expect(draft.pagesOf('mpob_licence')).toEqual(before);
  });

  it('撤掉一页：撤销它的预览 URL，其余顺序不变；撤完最后一页回到待拍；下标越界忽略', () => {
    const revoked = stubUrls();
    const draft = TestBed.inject(DraftService);
    for (let i = 0; i < 3; i++) draft.addPage('land_title', blob(), 'camera');
    const urls = draft.pagesOf('land_title').map((p) => p.url);
    draft.removePage('land_title', 1);
    expect(revoked).toEqual([urls[1]]);
    expect(draft.pagesOf('land_title').map((p) => p.url)).toEqual([urls[0], urls[2]]);
    draft.removePage('land_title', 9);
    draft.removePage('land_title', -1);
    expect(draft.pagesOf('land_title')).toHaveLength(2);
    draft.removePage('land_title', 0);
    draft.removePage('land_title', 0);
    expect(draft.doc('land_title').status).toBe('pending');
    expect(revoked).toHaveLength(3);
  });

  it('capture 仍是「只有这一张」：替换掉所有页并撤销旧的 URL；跳过、reset 也撤销所有页', () => {
    const revoked = stubUrls();
    const draft = TestBed.inject(DraftService);
    draft.addPage('land_title', blob(), 'camera');
    draft.addPage('land_title', blob(), 'camera');
    draft.capture('land_title', blob(), 'gallery');
    expect(revoked).toHaveLength(2);
    expect(draft.pagesOf('land_title')).toHaveLength(1);
    draft.addPage('mspo_cert', blob(), 'camera');
    draft.addPage('mspo_cert', blob(), 'camera');
    draft.skip('mspo_cert');
    expect(revoked).toHaveLength(4);
    draft.addPage('mpob_licence', blob(), 'camera');
    draft.reset();
    expect(revoked).toHaveLength(6); // 地契那 1 张 + 执照那 1 张
    expect(draft.entries().every((e) => e.doc.status === 'pending')).toBe(true);
  });

  it('跳过之后还可以拍：加一页就是已拍', () => {
    stubUrls();
    const draft = TestBed.inject(DraftService);
    draft.skip('land_title');
    expect(draft.addPage('land_title', blob(), 'camera')).toBe(true);
    expect(draft.doc('land_title').status).toBe('captured');
  });
});

describe('DocumentsPage（屏 3）：每张卡片自己的拍照／相册和缩略图', () => {
  let image: ImagePipelineStub;
  beforeEach(() => {
    stubUrls();
    image = stubImagePipeline();
  });
  afterEach(() => {
    image.restore();
    restoreUrls();
  });

  async function setup(url = '/plots/new?member=p9') {
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
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, DocumentsPage);
    const el = harness.fixture.nativeElement as HTMLElement;
    await settle(harness.fixture);
    const input = () => el.querySelector<HTMLInputElement>('input[type=file]')!;
    return {
      el,
      draft: TestBed.inject(DraftService),
      router: TestBed.inject(Router),
      q: (sel: string) => el.querySelector<HTMLElement>(sel),
      all: (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)],
      text: (sel: string) =>
        el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      click: async (sel: string) => {
        el.querySelector<HTMLElement>(sel)!.click();
        await settle(harness.fixture);
      },
      refresh: () => settle(harness.fixture),
      /** 模拟在系统选图器里选了这些文件 */
      pickMany: async (files: File[]) => {
        Object.defineProperty(input(), 'files', { value: files, configurable: true });
        input().dispatchEvent(new Event('change'));
        // 压缩是一串 Promise：让出宏任务，等它们跑完再刷新
        for (let i = 0; i < files.length + 1; i++)
          await new Promise((resolve) => setTimeout(resolve));
        await settle(harness.fixture);
      },
      clickSpy: () => vi.spyOn(input(), 'click'),
    };
  }

  it('每张卡片都有「Ambil gambar」和「Dari galeri」，写明一份文件可以有好几页', async () => {
    const p = await setup();
    for (const type of ['land_title', 'mspo_cert', 'mpob_licence']) {
      expect(p.text(`#camera-${type}`)).toContain('Ambil gambar');
      expect(p.text(`#gallery-${type}`)).toContain('Dari galeri');
    }
    expect(p.text('#pages-hint')).toContain('sehingga 4 gambar');
    expect(p.q('#gallery')).toBeNull(); // 底部那个不指定文件的相册入口没有了
  });

  it('点某张卡片的相册：选的照片都加到这份文件上，可以一次选多张；缩略图每张一个，数量写在卡片上', async () => {
    const p = await setup();
    const click = p.clickSpy();
    await p.click('#gallery-mspo_cert');
    expect(click).toHaveBeenCalledTimes(1);
    await p.pickMany([imageFile('a.jpg'), imageFile('b.jpg'), imageFile('c.jpg')]);
    expect(p.draft.pagesOf('mspo_cert')).toHaveLength(3);
    expect(p.draft.pagesOf('mspo_cert').every((x) => x.source === 'gallery')).toBe(true);
    expect(p.draft.doc('land_title').status).toBe('pending'); // 不会跑到别的文件上
    expect(p.all('#pages-mspo_cert .doc-page')).toHaveLength(3);
    expect(p.text('#doc-mspo_cert')).toContain('3 gambar');
  });

  it('接着再选：加在后面，不是替换', async () => {
    const p = await setup();
    await p.click('#gallery-land_title');
    await p.pickMany([imageFile('a.jpg')]);
    await p.click('#gallery-land_title');
    await p.pickMany([imageFile('b.jpg')]);
    expect(p.draft.pagesOf('land_title')).toHaveLength(2);
  });

  it(`超过 ${MAX_PAGES} 张：多的不要，并说明；这份文件的拍照和相册按钮禁用，别的文件不受影响`, async () => {
    const p = await setup();
    await p.click('#gallery-land_title');
    await p.pickMany(Array.from({ length: 6 }, (_, i) => imageFile(`${i}.jpg`)));
    expect(p.draft.pagesOf('land_title')).toHaveLength(MAX_PAGES);
    expect(p.text('#notice')).toContain('sehingga 4 gambar');
    expect((p.q('#camera-land_title') as HTMLButtonElement).disabled).toBe(true);
    expect((p.q('#gallery-land_title') as HTMLButtonElement).disabled).toBe(true);
    expect((p.q('#doc-land_title') as HTMLButtonElement).disabled).toBe(true);
    expect((p.q('#gallery-mspo_cert') as HTMLButtonElement).disabled).toBe(false);
  });

  it('选的里面有一张不是图片：这张不要并提示，其余照常加上', async () => {
    const p = await setup();
    await p.click('#gallery-land_title');
    await p.pickMany([
      imageFile('a.jpg'),
      imageFile('x.pdf', 'application/pdf'),
      imageFile('b.jpg'),
    ]);
    expect(p.draft.pagesOf('land_title')).toHaveLength(2);
    expect(p.text('#notice')).toContain('bukan gambar');
  });

  it('拍照按钮去相机（拍到的加成新的一页），保留 ?member；已有照片的卡片也能再拍', async () => {
    const p = await setup();
    p.draft.addPage('land_title', blob(), 'camera');
    await p.refresh();
    await p.click('#camera-land_title');
    expect(p.router.url).toBe('/plots/new/camera/land_title?member=p9');
  });

  it('每张缩略图有 ✕：撤掉那一张（读屏会读「Buang gambar 2 bagi Geran tanah」），不影响别的页', async () => {
    const p = await setup();
    for (let i = 0; i < 3; i++) p.draft.addPage('land_title', blob(), 'camera');
    await p.refresh();
    const remove = p.q('#remove-land_title-1')!;
    expect(remove.getAttribute('aria-label')).toBe('Buang gambar 2 bagi Geran tanah');
    const keep = [p.draft.pagesOf('land_title')[0].url, p.draft.pagesOf('land_title')[2].url];
    await p.click('#remove-land_title-1');
    expect(p.draft.pagesOf('land_title').map((x) => x.url)).toEqual(keep);
    expect(p.all('#pages-land_title .doc-page')).toHaveLength(2);
  });

  it('撤掉最后一张：回到待拍，又出现「Langkau」；有了照片的卡片没有「Langkau」', async () => {
    const p = await setup();
    p.draft.addPage('land_title', blob(), 'camera');
    await p.refresh();
    expect(p.q('#skip-land_title')).toBeNull();
    await p.click('#remove-land_title-0');
    expect(p.draft.doc('land_title').status).toBe('pending');
    expect(p.q('#skip-land_title')).not.toBeNull();
  });

  it('「Seterusnya」仍然是三份都拍了或跳过才能点；多拍几页不影响', async () => {
    const p = await setup();
    p.draft.addPage('land_title', blob(), 'camera');
    p.draft.addPage('land_title', blob(), 'camera');
    p.draft.skip('mspo_cert');
    await p.refresh();
    expect((p.q('#next') as HTMLButtonElement).disabled).toBe(true);
    p.draft.addPage('mpob_licence', blob(), 'gallery');
    await p.refresh();
    expect((p.q('#next') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('SubmitService：每一页都传', () => {
  afterEach(restoreUrls);

  function fakeApi() {
    let n = 0;
    return {
      createPlot: vi.fn(async () => 'plot-1'),
      saveGeometry: vi.fn(async () => ({})),
      registerDocument: vi.fn(async (_plotId: string, _body: Record<string, unknown>) => ({
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

  it('第 n 页登记成 pageNo = n；第 1 页不带 pageNo（和后端默认值一致）；每页都直传', async () => {
    const { api, submit } = prepare((d) => {
      d.addPage('land_title', blob(), 'camera');
      d.addPage('land_title', blob(), 'gallery');
      d.addPage('land_title', blob(), 'gallery');
      d.addPage('mpob_licence', blob(), 'camera');
    });
    await submit.run(() => undefined);
    const bodies = api.registerDocument.mock.calls.map((c) => c[1]);
    expect(bodies).toHaveLength(4);
    expect(bodies).toContainEqual({
      docType: 'land_title',
      contentType: 'image/jpeg',
      source: 'camera',
    });
    expect(bodies).toContainEqual({
      docType: 'land_title',
      contentType: 'image/jpeg',
      source: 'gallery',
      pageNo: 2,
    });
    expect(bodies).toContainEqual({
      docType: 'land_title',
      contentType: 'image/jpeg',
      source: 'gallery',
      pageNo: 3,
    });
    expect(bodies).toContainEqual({
      docType: 'mpob_licence',
      contentType: 'image/jpeg',
      source: 'camera',
    });
    expect(api.uploadPhoto).toHaveBeenCalledTimes(4);
  });

  it('重试：传好的页不重传；后来新加的页才传；换掉的那一页重传', async () => {
    const { api, draft, submit } = prepare((d) => d.addPage('land_title', blob(), 'camera'));
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(1);
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(1);
    draft.addPage('land_title', blob(), 'camera');
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(2);
    expect(api.registerDocument.mock.calls[1][1]).toMatchObject({ pageNo: 2 });
    draft.removePage('land_title', 0); // 原来的第 2 页变成第 1 页：是另一张照片，要重传
    await submit.run(() => undefined);
    expect(api.registerDocument).toHaveBeenCalledTimes(3);
    expect(api.registerDocument.mock.calls[2][1]).not.toHaveProperty('pageNo');
  });
});

describe('ReviewPage（屏 6）：摘要里写每份文件拍了几张', () => {
  afterEach(restoreUrls);

  it('拍了几张写几张；跳过写「Dilangkau」；没处理写「—」', async () => {
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
    draft.addPage('land_title', blob(), 'camera');
    draft.addPage('land_title', blob(), 'camera');
    draft.skip('mspo_cert');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/plots/new/review', ReviewPage);
    await settle(harness.fixture);
    const text = (harness.fixture.nativeElement as HTMLElement).querySelector(
      '#review-summary',
    )!.textContent!;
    expect(text.replace(/\s+/g, ' ')).toContain('Geran tanah 2 gambar');
    expect(text.replace(/\s+/g, ' ')).toContain('Sijil MSPO Dilangkau');
    expect(text.replace(/\s+/g, ' ')).toContain('Lesen MPOB —');
  });
});
