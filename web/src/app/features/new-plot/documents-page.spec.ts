import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { stubHistory } from '../../../testing/back';
import { settle } from '../../../testing/fake-facade';
import {
  imageFile,
  pickFile,
  stubImagePipeline,
  type ImagePipelineStub,
} from '../../../testing/fake-image';
import { I18nService } from '../../core/i18n/i18n.service';
import { DocumentsPage } from './documents-page';
import { DraftService } from './draft.service';
import { MAX_FILE_BYTES } from './image';

@Component({ template: '' })
class Blank {}

async function setup(url = '/plots/new') {
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
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  return {
    fixture,
    el,
    router: TestBed.inject(Router),
    draft: TestBed.inject(DraftService),
    i18n: TestBed.inject(I18nService),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
    pick: async (file: File) => {
      pickFile(el.querySelector<HTMLInputElement>('input[type=file]')!, file);
      // 压缩是一串 Promise：让出一个宏任务，等它们全部跑完再刷新界面
      await new Promise((resolve) => setTimeout(resolve));
      await settle(fixture);
    },
    cards: () => [...el.querySelectorAll('.doc-card')],
  };
}

describe('DocumentsPage（屏 3）', () => {
  let image: ImagePipelineStub;
  beforeEach(() => {
    localStorage.clear();
    image = stubImagePipeline();
  });
  afterEach(() => {
    image.restore();
    localStorage.clear();
  });

  it('三张卡片按固定顺序：地契、MSPO、MPOB，各带「Ketik untuk ambil gambar」和「Langkau」', async () => {
    const p = await setup();
    const names = p.cards().map((c) => c.querySelector('strong')?.textContent);
    expect(names).toEqual(['Geran tanah', 'Sijil MSPO', 'Lesen MPOB']);
    expect(p.text()).toContain('Langkah 1 / 3 · Foto dokumen');
    expect(p.text().match(/Ketik untuk ambil gambar/g)).toHaveLength(3);
    expect(p.el.querySelectorAll('.chip-btn')).toHaveLength(3);
    expect(p.q('.progress')?.getAttribute('aria-valuenow')).toBe('1');
  });

  it('还有文档没处理：「Seterusnya」禁用并说明原因；点它不会跳走', async () => {
    const p = await setup();
    const next = p.q('#next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(p.q('#next-help')?.textContent).toContain('Ambil atau langkau setiap dokumen');
    next.click();
    await settle(p.fixture);
    expect(p.router.url).toBe('/plots/new');
  });

  it('点卡片 → 进该文档的取景页；带着 ?member 过去', async () => {
    const p = await setup('/plots/new?member=p9');
    await p.click('#doc-mspo_cert');
    expect(p.router.url).toBe('/plots/new/camera/mspo_cert?member=p9');
  });

  it('「Langkau」：该卡片变已跳过（不再有跳过键与相机箭头），不会进取景页', async () => {
    const p = await setup();
    await p.click('#skip-mspo_cert');
    expect(p.router.url).toBe('/plots/new');
    const card = p.cards()[1];
    expect(card.textContent).toContain('Dilangkau');
    expect(p.q('#skip-mspo_cert')).toBeNull();
    expect(p.q('#skip-land_title')).not.toBeNull();
    expect(p.draft.doc('mspo_cert').status).toBe('skipped');
  });

  it('三张都已拍或已跳过：「Seterusnya」可用、说明消失；点击进入屏 5 占位并保留 ?member', async () => {
    const p = await setup('/plots/new?member=p9');
    p.draft.capture('land_title', new Blob(['x'], { type: 'image/jpeg' }), 'camera');
    await p.click('#skip-mspo_cert');
    await p.click('#skip-mpob_licence');
    expect((p.q('#next') as HTMLButtonElement).disabled).toBe(false);
    expect(p.q('#next-help')).toBeNull();
    await p.click('#next');
    expect(p.router.url).toBe('/plots/new/map?member=p9');
  });

  it('已拍的卡片：显示缩略图、「1 gambar」和「Siap」，仍可点开再拍一页，但不再有「Langkau」', async () => {
    const p = await setup();
    p.draft.capture('land_title', new Blob(['x'], { type: 'image/jpeg' }), 'camera');
    await settle(p.fixture);
    const card = p.cards()[0];
    expect(card.querySelector('img')?.getAttribute('src')).toMatch(/^blob:test\//);
    expect(card.querySelector('img')?.getAttribute('alt')).toBe('Gambar Geran tanah');
    expect(card.textContent).toContain('1 gambar');
    expect(card.textContent).toContain('Siap');
    expect(card.querySelector('.chip-btn')).toBeNull();
    await p.click('#doc-land_title');
    expect(p.router.url).toBe('/plots/new/camera/land_title');
  });

  it('返回键回到屏 2，并保留 ?member', async () => {
    const p = await setup('/plots/new?member=p9');
    await p.click('#back');
    expect(p.router.url).toBe('/?member=p9');
  });

  it('返回键：有历史就后退（历史条数不增加），不再导航', async () => {
    const p = await setup('/plots/new?member=p9');
    const back = stubHistory(true);
    await p.click('#back');
    expect(back).toHaveBeenCalledTimes(1);
    expect(p.router.url).toBe('/plots/new?member=p9');
  });

  it('切到英文：标题、卡片、按钮文案都换', async () => {
    const p = await setup();
    p.i18n.set('en');
    await settle(p.fixture);
    expect(p.text()).toContain('Step 1 / 3');
    expect(p.cards()[0].querySelector('strong')?.textContent).not.toBe('Geran tanah');
    expect(p.text()).not.toContain('Langkau');
  });

  describe('相册入口', () => {
    it('没点具体哪张卡片的相册按钮时（直接选图）：给第一张待拍的（来源 gallery），并压缩过', async () => {
      const p = await setup();
      await p.pick(imageFile());
      const doc = p.draft.doc('land_title');
      expect(doc.status).toBe('captured');
      if (doc.status === 'captured') {
        expect(doc.source).toBe('gallery');
        expect(doc.blob.type).toBe('image/jpeg');
      }
      // 解码时要求按 EXIF 方向摆正（竖拍的相册照不能横躺）
      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(expect.anything(), {
        imageOrientation: 'from-image',
      });
      // 3000×4000 的竖图被缩到长边 1600
      expect(image.draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 1600);
      expect(image.bitmapsClosed()).toBe(1);
      // 下一张待拍的是 MSPO
      expect(p.draft.firstPending()).toBe('mspo_cert');
    });

    it('已跳过的不算待拍：地契跳过后，选图给 MSPO', async () => {
      const p = await setup();
      await p.click('#skip-land_title');
      await p.pick(imageFile());
      expect(p.draft.doc('land_title').status).toBe('skipped');
      expect(p.draft.doc('mspo_cert').status).toBe('captured');
    });

    it('选了非图片：提示「bukan gambar」，草稿不变', async () => {
      const p = await setup();
      await p.pick(imageFile('a.pdf', 'application/pdf'));
      expect(p.q('#notice')?.textContent).toContain('Fail ini bukan gambar');
      expect(p.draft.doc('land_title').status).toBe('pending');
    });

    it('图片超过 20MB：提示太大，不去解码', async () => {
      const p = await setup();
      const big = imageFile();
      Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
      await p.pick(big);
      expect(p.q('#notice')?.textContent).toContain('terlalu besar');
      expect(p.draft.doc('land_title').status).toBe('pending');
      expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    });

    it('读不出来（编码失败）：提示「tidak dapat dibaca」；下一次选图成功后提示消失', async () => {
      const p = await setup();
      image.failNextEncode();
      await p.pick(imageFile());
      expect(p.q('#notice')?.textContent).toContain('tidak dapat dibaca');
      expect(p.draft.doc('land_title').status).toBe('pending');

      await p.pick(imageFile());
      expect(p.q('#notice')).toBeNull();
      expect(p.draft.doc('land_title').status).toBe('captured');
    });

    it('取消选择（没有文件）：什么都不发生', async () => {
      const p = await setup();
      const input = p.q('input[type=file]') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [], configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle(p.fixture);
      expect(p.q('#notice')).toBeNull();
      expect(p.draft.firstPending()).toBe('land_title');
    });
  });
});
