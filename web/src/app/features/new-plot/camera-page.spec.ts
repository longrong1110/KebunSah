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
import { CameraPage } from './camera-page';
import { CameraError, CameraService, type CameraHandle } from './camera.service';
import { DraftService } from './draft.service';

@Component({ template: '' })
class Blank {}

function fakeHandle(options: { torch?: boolean; setTorch?: () => Promise<void> } = {}) {
  let ended: (() => void) | null = null;
  const handle: CameraHandle = {
    stream: {} as MediaStream,
    torchSupported: options.torch ?? false,
    setTorch: vi.fn(options.setTorch ?? (() => Promise.resolve())),
    stop: vi.fn(),
    onEnded: (cb) => (ended = cb),
  };
  return { handle, fireEnded: () => ended?.() };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve));

async function setup(
  options: { url?: string; open?: () => Promise<CameraHandle>; navigate?: boolean } = {},
) {
  const open = vi.fn(options.open ?? (() => Promise.resolve(fakeHandle().handle)));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'plots/new', component: Blank },
        { path: 'plots/new/camera/:doc', component: CameraPage },
      ]),
      { provide: CameraService, useValue: { open } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const url = options.url ?? '/plots/new/camera/land_title';
  if (options.navigate === false) await harness.navigateByUrl(url);
  else await harness.navigateByUrl(url, CameraPage);
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  const flush = async () => {
    await macrotask();
    await settle(fixture);
  };
  await flush();
  const p = {
    fixture,
    el,
    open,
    router: TestBed.inject(Router),
    draft: TestBed.inject(DraftService),
    i18n: TestBed.inject(I18nService),
    flush,
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await flush();
    },
    video: () => el.querySelector('video'),
    /** 模拟首帧到达，并给视频一个真实尺寸 */
    frame: async (width = 3000, height = 4000) => {
      const video = el.querySelector('video')!;
      Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
      video.dispatchEvent(new Event('loadeddata'));
      await flush();
    },
    pick: async (file: File) => {
      pickFile(el.querySelector<HTMLInputElement>('input[type=file]')!, file);
      await flush();
    },
    shutter: () => el.querySelector<HTMLButtonElement>('#shutter')!,
  };
  return p;
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('CameraPage（屏 4）', () => {
  let image: ImagePipelineStub;
  beforeEach(() => {
    localStorage.clear();
    image = stubImagePipeline();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>)['visibilityState'];
    image.restore();
    localStorage.clear();
  });

  describe('路由与标题', () => {
    it('顶部写明正在拍哪份文件；换语言跟着变', async () => {
      const p = await setup({ url: '/plots/new/camera/mspo_cert' });
      expect(p.q('#camera-title')?.textContent).toBe('Sijil MSPO');
      p.i18n.set('en');
      await settle(p.fixture);
      expect(p.q('#camera-title')?.textContent).toBe('MSPO certificate');
    });

    it('非法的文档类型：回屏 3（保留 ?member），不去打开摄像头', async () => {
      const p = await setup({ url: '/plots/new/camera/passport?member=p9', navigate: false });
      expect(p.router.url).toBe('/plots/new?member=p9');
      expect(p.open).not.toHaveBeenCalled();
    });
  });

  describe('打开与首帧', () => {
    it('授权等待中：显示「Membuka kamera…」，快门禁用；首帧到达后变可用', async () => {
      const d = deferred<CameraHandle>();
      const p = await setup({ open: () => d.promise });
      expect(p.q('#camera-opening')?.textContent).toContain('Membuka kamera');
      expect(p.shutter().disabled).toBe(true);

      d.resolve(fakeHandle().handle);
      await p.flush();
      expect(p.shutter().disabled).toBe(true); // 流有了，但还没有首帧
      expect(p.video()?.srcObject).toBeTruthy();

      await p.frame();
      expect(p.q('#camera-opening')).toBeNull();
      expect(p.shutter().disabled).toBe(false);
      expect(p.q('.camera-hint')?.textContent).toContain('cukup cahaya');
    });

    it('取景框里有一句提示；<video> 带 playsinline 和 muted（iOS 才会自动播放）', async () => {
      const p = await setup();
      await p.frame();
      expect(p.q('.camera-frame')?.textContent).toContain('Letak dokumen dalam bingkai');
      const video = p.video()!;
      expect(video.hasAttribute('playsinline')).toBe(true);
      expect(video.hasAttribute('muted') || video.muted).toBe(true);
    });
  });

  describe('打不开摄像头', () => {
    it.each([
      ['denied', 'Kamera tidak dibenarkan'],
      ['none', 'Tiada kamera'],
      ['busy', 'sedang digunakan'],
      ['insecure', 'sambungan selamat'],
    ] as const)('%s：显示人话，提供「Cuba lagi」和相册', async (key, words) => {
      const p = await setup({ open: () => Promise.reject(new CameraError(key)) });
      expect(p.q('#camera-error')?.textContent).toContain(words);
      expect(p.q('#camera-retry')?.textContent).toContain('Cuba lagi');
      expect(p.q('#camera-gallery')?.textContent).toContain('Pilih dari galeri');
      expect(p.shutter().disabled).toBe(true);
    });

    it('未知错误一律说「Kamera tidak dapat dibuka」，不泄露原始错误名', async () => {
      const p = await setup({ open: () => Promise.reject(new Error('NotSupportedError: x')) });
      expect(p.q('#camera-error')?.textContent).toContain('Kamera tidak dapat dibuka');
      expect(p.text()).not.toContain('NotSupportedError');
    });

    it('点「Cuba lagi」重新打开；这回成功就进入取景', async () => {
      const first = fakeHandle();
      const p = await setup({ open: () => Promise.reject(new CameraError('busy')) });
      p.open.mockResolvedValueOnce(first.handle);
      await p.click('#camera-retry');
      expect(p.open).toHaveBeenCalledTimes(2);
      expect(p.q('#camera-error')).toBeNull();
      await p.frame();
      expect(p.shutter().disabled).toBe(false);
    });

    it('「Guna gambar」：有历史就后退到屏 3（不在历史里留下相邻重复的 /plots/new），这份文档仍记为已拍', async () => {
      const p = await setup({ open: () => Promise.reject(new CameraError('denied')) });
      await p.pick(imageFile());
      const back = stubHistory(true);
      await p.click('#use');
      expect(back).toHaveBeenCalledTimes(1);
      expect(p.draft.doc('land_title').status).toBe('captured');
      expect(p.router.url).toBe('/plots/new/camera/land_title');
    });

    it('摄像头被拒时仍能用相册：选图进入预览，「Guna gambar」后记为 gallery', async () => {
      const p = await setup({ open: () => Promise.reject(new CameraError('denied')) });
      await p.pick(imageFile());
      expect(p.q('#preview')).not.toBeNull();
      await p.click('#use');
      const doc = p.draft.doc('land_title');
      expect(doc.status).toBe('captured');
      if (doc.status === 'captured') expect(doc.source).toBe('gallery');
      expect(p.router.url).toBe('/plots/new');
    });

    it('取景中摄像头被系统收走（被别的应用抢占）：转为错误状态并释放', async () => {
      const f = fakeHandle();
      const p = await setup({ open: () => Promise.resolve(f.handle) });
      await p.frame();
      f.fireEnded();
      await p.flush();
      expect(p.q('#camera-error')?.textContent).toContain('Kamera tidak dapat dibuka');
      expect(f.handle.stop).toHaveBeenCalled();
    });
  });

  describe('拍照与预览', () => {
    it('点快门：整帧缩到长边 1600，进入预览；摄像头随即关闭', async () => {
      const f = fakeHandle();
      const p = await setup({ open: () => Promise.resolve(f.handle) });
      await p.frame(3000, 4000);
      const video = p.video(); // 预览时 <video> 会从页面上拿掉，先取到
      await p.click('#shutter');

      expect(image.draw).toHaveBeenCalledWith(video, 0, 0, 1200, 1600);
      const preview = p.q('#preview') as HTMLImageElement;
      expect(preview.getAttribute('src')).toMatch(/^blob:test\//);
      expect(preview.getAttribute('alt')).toBe('Pratonton gambar');
      expect(p.q('#use')?.textContent).toContain('Guna gambar');
      expect(p.q('#retake')?.textContent).toContain('Ambil semula');
      expect(p.q('#shutter')).toBeNull();
      expect(f.handle.stop).toHaveBeenCalledTimes(1);
      // 预览不算数：草稿还没变
      expect(p.draft.doc('land_title').status).toBe('pending');
    });

    it('连点快门只拍一张', async () => {
      const p = await setup();
      await p.frame();
      p.shutter().click();
      p.shutter().click();
      await p.flush();
      expect(image.encodes()).toBe(1);
    });

    it('处理中显示「Memproses gambar…」', async () => {
      const p = await setup();
      await p.frame();
      p.shutter().click();
      p.fixture.detectChanges();
      expect(p.q('#camera-processing')?.textContent).toContain('Memproses gambar');
      expect(p.shutter().disabled).toBe(true);
      await p.flush();
    });

    it('取景还没尺寸（拍不出）：提示「tidak dapat dibaca」，回到取景可再拍', async () => {
      const p = await setup();
      await p.frame(0, 0);
      await p.click('#shutter');
      expect(p.q('#notice')?.textContent).toContain('tidak dapat dibaca');
      expect(p.q('#preview')).toBeNull();
      expect(p.shutter().disabled).toBe(false);
    });

    it('「Guna gambar」：这份文档变已拍（camera），回屏 3，后退不会再回到相机', async () => {
      const p = await setup({ url: '/plots/new/camera/mpob_licence?member=p9' });
      await p.frame();
      await p.click('#shutter');
      await p.click('#use');
      const doc = p.draft.doc('mpob_licence');
      expect(doc.status).toBe('captured');
      if (doc.status === 'captured') {
        expect(doc.source).toBe('camera');
        expect(doc.blob.type).toBe('image/jpeg');
      }
      expect(p.router.url).toBe('/plots/new?member=p9');
      // 其余两份没被动
      expect(p.draft.doc('land_title').status).toBe('pending');
    });

    it('预览用的 URL 在离开后被撤销；草稿自己那份不受影响', async () => {
      const p = await setup();
      await p.frame();
      await p.click('#shutter');
      const previewUrl = p.q('#preview')!.getAttribute('src')!;
      await p.click('#use');
      const doc = p.draft.doc('land_title');
      expect(image.revoked).toContain(previewUrl);
      if (doc.status === 'captured') expect(image.revoked).not.toContain(doc.url);
    });

    it('「Ambil semula」：撤销旧预览，重新打开摄像头，回到取景', async () => {
      const first = fakeHandle();
      const second = fakeHandle();
      const p = await setup({ open: () => Promise.resolve(first.handle) });
      p.open.mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle);
      await p.frame();
      await p.click('#shutter');
      const previewUrl = p.q('#preview')!.getAttribute('src')!;

      await p.click('#retake');
      expect(image.revoked).toContain(previewUrl);
      expect(p.q('#preview')).toBeNull();
      expect(p.open).toHaveBeenCalledTimes(2);
      await p.frame();
      expect(p.shutter().disabled).toBe(false);
      expect(p.draft.doc('land_title').status).toBe('pending');
    });
  });

  describe('相册（屏 4 内的入口）', () => {
    it('取景中选图：先进预览，不直接算数；来源 gallery', async () => {
      const f = fakeHandle();
      const p = await setup({ open: () => Promise.resolve(f.handle) });
      await p.frame();
      await p.pick(imageFile());
      expect(p.q('#preview')).not.toBeNull();
      expect(p.draft.doc('land_title').status).toBe('pending');
      expect(f.handle.stop).toHaveBeenCalled(); // 预览时摄像头已关
      expect(image.draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 1600);
    });

    it('非图片：提示「bukan gambar」，停在取景，不进预览', async () => {
      const p = await setup();
      await p.frame();
      await p.pick(imageFile('a.pdf', 'application/pdf'));
      expect(p.q('#notice')?.textContent).toContain('bukan gambar');
      expect(p.q('#preview')).toBeNull();
      expect(p.shutter().disabled).toBe(false);
    });
  });

  describe('手电筒', () => {
    it('轨道不支持：不显示手电筒键', async () => {
      const p = await setup();
      await p.frame();
      expect(p.q('#torch')).toBeNull();
    });

    it('支持：默认关；点一下开，再点一下关', async () => {
      const f = fakeHandle({ torch: true });
      const p = await setup({ open: () => Promise.resolve(f.handle) });
      await p.frame();
      const torch = () => p.q('#torch')!;
      expect(torch().textContent).toContain('Lampu mati');
      expect(torch().getAttribute('aria-pressed')).toBe('false');

      await p.click('#torch');
      expect(f.handle.setTorch).toHaveBeenLastCalledWith(true);
      expect(torch().textContent).toContain('Lampu hidup');
      expect(torch().getAttribute('aria-pressed')).toBe('true');

      await p.click('#torch');
      expect(f.handle.setTorch).toHaveBeenLastCalledWith(false);
      expect(torch().textContent).toContain('Lampu mati');
    });

    it('点击时设备拒绝：按钮消失，页面不崩，仍能拍照', async () => {
      const f = fakeHandle({ torch: true, setTorch: () => Promise.reject(new Error('nope')) });
      const p = await setup({ open: () => Promise.resolve(f.handle) });
      await p.frame();
      await p.click('#torch');
      expect(p.q('#torch')).toBeNull();
      expect(p.shutter().disabled).toBe(false);
    });
  });

  describe('关闭与释放', () => {
    it('点 ✕：有历史就后退（摄像头由页面销毁时关闭，见下一条），草稿不变', async () => {
      const f = fakeHandle();
      const p = await setup({
        url: '/plots/new/camera/land_title?member=p9',
        open: () => Promise.resolve(f.handle),
      });
      await p.frame();
      const back = stubHistory(true);
      await p.click('#close');
      expect(back).toHaveBeenCalledTimes(1);
      expect(p.router.url).toBe('/plots/new/camera/land_title?member=p9');
      expect(p.draft.doc('land_title').status).toBe('pending');
    });

    it('点 ✕：回屏 3，保留 ?member，草稿不变，摄像头关闭', async () => {
      const f = fakeHandle();
      const p = await setup({
        url: '/plots/new/camera/land_title?member=p9',
        open: () => Promise.resolve(f.handle),
      });
      await p.frame();
      expect(p.q('#close')?.getAttribute('aria-label')).toBe('Tutup');
      await p.click('#close');
      expect(p.router.url).toBe('/plots/new?member=p9');
      expect(p.draft.doc('land_title').status).toBe('pending');
      expect(f.handle.stop).toHaveBeenCalled();
    });

    it('离开页面时：摄像头关闭、预览 URL 撤销', async () => {
      const f = fakeHandle();
      const p = await setup({ open: () => Promise.resolve(f.handle) });
      await p.frame();
      await p.click('#shutter');
      const previewUrl = p.q('#preview')!.getAttribute('src')!;
      await p.router.navigateByUrl('/');
      await p.flush();
      expect(f.handle.stop).toHaveBeenCalled();
      expect(image.revoked).toContain(previewUrl);
    });

    it('授权等待中就离开，之后流才到：立刻停掉，不留亮着的摄像头灯', async () => {
      const d = deferred<CameraHandle>();
      const p = await setup({ open: () => d.promise });
      await p.router.navigateByUrl('/');
      await p.flush();

      const late = fakeHandle();
      d.resolve(late.handle);
      await p.flush();
      expect(late.handle.stop).toHaveBeenCalledTimes(1);
    });

    it('点「Cuba lagi」后旧的请求才返回：只留最新一次，旧的立刻停', async () => {
      const slow = deferred<CameraHandle>();
      const p = await setup({ open: () => slow.promise });
      const fast = fakeHandle();
      p.open.mockResolvedValueOnce(fast.handle);
      // 模拟用户在慢请求还没返回时又触发了一次打开（例如切后台再回来）
      setVisibility('hidden');
      setVisibility('visible');
      await p.flush();
      expect(p.open).toHaveBeenCalledTimes(2);

      const stale = fakeHandle();
      slow.resolve(stale.handle);
      await p.flush();
      expect(stale.handle.stop).toHaveBeenCalledTimes(1);
      expect(fast.handle.stop).not.toHaveBeenCalled();
    });
  });

  describe('晚到的异步结果', () => {
    it('授权等待中切到后台，授权在后台到达：立刻停掉，不在后台开着摄像头；回前台再重新打开', async () => {
      const slow = deferred<CameraHandle>();
      const p = await setup({ open: () => slow.promise });
      const second = fakeHandle();
      p.open.mockResolvedValueOnce(second.handle);

      setVisibility('hidden');
      await p.flush();
      const late = fakeHandle();
      slow.resolve(late.handle);
      await p.flush();
      expect(late.handle.stop).toHaveBeenCalledTimes(1);
      expect(p.video()?.srcObject).toBeFalsy(); // 没有把晚到的流接到画面上

      setVisibility('visible');
      await p.flush();
      expect(p.open).toHaveBeenCalledTimes(2);
      await p.frame();
      expect(p.shutter().disabled).toBe(false);
      expect(second.handle.stop).not.toHaveBeenCalled();
      expect(late.handle.stop).toHaveBeenCalledTimes(1); // 旧句柄没有被覆盖后丢下
    });

    it('授权等待中先用相册选图进入预览，授权随后到达：晚到的流立刻停掉，预览不受影响', async () => {
      const slow = deferred<CameraHandle>();
      const p = await setup({ open: () => slow.promise });
      await p.pick(imageFile());
      expect(p.q('#preview')).not.toBeNull();

      const late = fakeHandle();
      slow.resolve(late.handle);
      await p.flush();
      expect(late.handle.stop).toHaveBeenCalledTimes(1);
      expect(p.q('#preview')).not.toBeNull();
      expect(p.q('#camera-error')).toBeNull();
    });

    it('授权等待中先选图进入预览，随后授权被拒：不能把预览抢成错误画面', async () => {
      const slow = deferred<CameraHandle>();
      const p = await setup({ open: () => slow.promise });
      await p.pick(imageFile());

      slow.reject(new CameraError('denied'));
      await p.flush();
      expect(p.q('#preview')).not.toBeNull();
      expect(p.q('#camera-error')).toBeNull();
      expect(p.q('#use')).not.toBeNull(); // 选好的图还在，可以确认
    });

    it('相册图压缩途中点 ✕ 离开：不会再造出没人撤销的预览 URL', async () => {
      const p = await setup();
      await p.frame();
      const bitmap = deferred<{ width: number; height: number; close: () => void }>();
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(() => bitmap.promise),
      );
      pickFile(p.el.querySelector<HTMLInputElement>('input[type=file]')!, imageFile());
      await p.click('#close'); // 离开，压缩还在等解码
      bitmap.resolve({ width: 3000, height: 4000, close: () => undefined });
      await p.flush();
      expect(image.created).toEqual([]);
    });

    it('✕ 用替换历史（与「Guna gambar」一致），浏览器返回不会回到相机', async () => {
      const p = await setup({ url: '/plots/new/camera/land_title?member=p9' });
      const nav = vi.spyOn(p.router, 'navigate');
      await p.click('#close');
      expect(nav).toHaveBeenCalledWith(['/plots/new'], {
        replaceUrl: true,
        queryParamsHandling: 'preserve',
      });
    });
  });

  describe('切到后台', () => {
    it('取景中切到后台：关摄像头；回前台自动恢复', async () => {
      const first = fakeHandle();
      const second = fakeHandle();
      const p = await setup({ open: () => Promise.resolve(first.handle) });
      p.open.mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle);
      await p.frame();

      setVisibility('hidden');
      await p.flush();
      expect(first.handle.stop).toHaveBeenCalledTimes(1);
      expect(p.open).toHaveBeenCalledTimes(1);

      setVisibility('visible');
      await p.flush();
      expect(p.open).toHaveBeenCalledTimes(2);
      await p.frame();
      expect(p.shutter().disabled).toBe(false);
    });

    it('预览中切到后台再回来：不重新开摄像头', async () => {
      const p = await setup();
      await p.frame();
      await p.click('#shutter');
      const calls = p.open.mock.calls.length;
      setVisibility('hidden');
      setVisibility('visible');
      await p.flush();
      expect(p.open.mock.calls.length).toBe(calls);
      expect(p.q('#preview')).not.toBeNull();
    });
  });
});
