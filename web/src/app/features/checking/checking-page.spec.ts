import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import { CJK, assessment } from '../../../testing/assessment-fixtures';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { CheckingPage } from './checking-page';

@Component({ template: '' })
class Blank {}

const PLOT = { landTitleId: 't1', status: 'pending', district: 'Kampar' };

const run = (id: string, runStatus: string, over: Record<string, unknown> = {}) => ({
  id,
  data: assessment({ runStatus, ...over }),
});

const doc = (id: string, extractionStatus: string, isCurrent = true) => ({
  id,
  data: {
    docType: 'land_title',
    pageNo: 1,
    isCurrent,
    extractionStatus,
    storagePath: 'seed/PLOT-SECRET/land_title-1.jpg',
    fileHash: 'HASH-SECRET',
  },
});

async function setup(url = '/plots/p1/checking') {
  const facade = new FakeFacade();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'plots/:id', component: Blank },
        { path: 'plots/:id/checking', component: CheckingPage },
      ]),
      { provide: FIRESTORE_FACADE, useValue: facade },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, CheckingPage);
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  const api = {
    fixture,
    facade,
    el,
    router: TestBed.inject(Router),
    i18n: TestBed.inject(I18nService),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    all: (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)],
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
    plot: async (data: Record<string, unknown> | null, fromCache = false) => {
      facade.emitDoc('plots/p1', data, fromCache);
      await settle(fixture);
    },
    assessments: async (
      docs: { id: string; data: Record<string, unknown> }[],
      fromCache = false,
    ) => {
      facade.emitCollection('plots/p1/assessments', docs, { fromCache });
      await settle(fixture);
    },
    documents: async (docs: { id: string; data: Record<string, unknown> }[], fromCache = false) => {
      facade.emitCollection('plots/p1/documents', docs, { fromCache });
      await settle(fixture);
    },
    /** 常用组合：地块＋评估＋文件，都是服务器确认的 */
    ready: async (
      assessments: { id: string; data: Record<string, unknown> }[],
      documents: { id: string; data: Record<string, unknown> }[] = [doc('d1', 'extracted')],
    ) => {
      facade.emitDoc('plots/p1', PLOT);
      facade.emitCollection('plots/p1/assessments', assessments);
      facade.emitCollection('plots/p1/documents', documents);
      await settle(fixture);
    },
    steps: () =>
      api
        .all('#steps li')
        .map((li) => [
          li.getAttribute('data-step'),
          li.className.match(/checking__step--(\w+)/)?.[1],
        ]),
  };
  return api;
}

describe('CheckingPage（屏 7 评估中）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('读取之前与失败', () => {
    it('读到之前显示骨架，不转圈、不列步骤、不下任何结论', async () => {
      const t = await setup();
      expect(t.q('#loading')).not.toBeNull();
      expect(t.q('#spinner')).toBeNull();
      expect(t.q('#steps')).toBeNull();
      expect(t.q('h1')?.textContent).toContain('Sedang menyemak');
    });

    it('地块文档服务器确认不存在：说明＋回「我的地块」；缓存里的「不存在」不下结论', async () => {
      const t = await setup('/plots/p1/checking?member=m9');
      await t.plot(null, true);
      expect(t.q('#not-found')).toBeNull();
      expect(t.q('#loading')).not.toBeNull();

      await t.plot(null, false);
      expect(t.q('#not-found')?.textContent).toContain('Tanah ini tidak dijumpai');
      await t.click('#back-to-list');
      expect(t.router.url).toBe('/?member=m9');
    });

    it('评估或文件子集合在缓存里是空的：不能当成「没有」，先加载', async () => {
      const t = await setup();
      await t.plot(PLOT);
      await t.assessments([], true);
      await t.documents([], true);
      expect(t.q('#loading')).not.toBeNull();
      expect(t.q('#headline')).toBeNull();

      await t.assessments([], false);
      await t.documents([], false);
      expect(t.q('#headline')?.textContent).toContain('belum diperiksa');
    });

    it('10 秒没被服务器确认：离线提示；点「Cuba lagi」三个订阅都重新订阅；快照到了恢复', async () => {
      vi.useFakeTimers();
      const t = await setup();
      await t.plot(null, true);
      vi.advanceTimersByTime(10_000);
      await settle(t.fixture);
      expect(t.q('#offline')?.textContent).toContain('Tiada sambungan');

      await t.click('#retry');
      expect(t.facade.docs.filter((w) => w.path === 'plots/p1')).toHaveLength(2);
      expect(t.facade.activeDocs('plots/p1')).toHaveLength(1);
      expect(t.facade.activeCollections('plots/p1/assessments')).toHaveLength(1);
      expect(t.facade.activeCollections('plots/p1/documents')).toHaveLength(1);

      await t.ready([run('a1', 'running')]);
      expect(t.q('#offline')).toBeNull();
      expect(t.q('#spinner')).not.toBeNull();
    });

    it('监听出错（如权限被拒）：错误与重试，不显示进度', async () => {
      const t = await setup();
      await t.plot(PLOT);
      t.facade.failCollection('plots/p1/documents');
      await settle(t.fixture);
      expect(t.q('#error')?.textContent).toContain('Tidak dapat memuat');
      expect(t.q('#spinner')).toBeNull();
      expect(t.q('#steps')).toBeNull();

      await t.click('#retry');
      await t.ready([run('a1', 'running')]);
      expect(t.q('#error')).toBeNull();
      expect(t.q('#steps')).not.toBeNull();
    });
  });

  describe('进行中', () => {
    it('转圈、标题、四步（固定顺序）、「Kira-kira 2 minit」、回「我的地块」；文件读完后第 2 步是当前步', async () => {
      const t = await setup();
      await t.ready([run('a1', 'running')]);
      expect(t.q('#spinner')).not.toBeNull();
      expect(t.q('#headline')?.textContent).toBe('Sedang menyemak tanah anda…');
      expect(t.all('#steps .checking__label').map((e) => e.textContent)).toEqual([
        'Membaca dokumen',
        'Menyemak maklumat',
        'Menyemak imej satelit hutan',
        'Menyediakan senarai tindakan',
      ]);
      expect(t.steps()).toEqual([
        ['read', 'done'],
        ['check', 'current'],
        ['forest', 'pending'],
        ['actions', 'pending'],
      ]);
      expect(t.q('#eta')?.textContent).toBe('Kira-kira 2 minit. Anda boleh keluar.');
      expect(t.q('#back-to-plots')?.textContent?.trim()).toBe('Kembali ke Tanah saya');
      expect(t.q('#see-result')).toBeNull();
    });

    it('每一步是「图标＋文字＋状态说明」，不只靠颜色', async () => {
      const t = await setup();
      await t.ready([run('a1', 'running')]);
      const li = t.q('[data-step="read"]')!;
      expect(li.querySelector('.checking__icon')?.textContent).toBe('✓');
      expect(li.querySelector('.checking__icon')?.getAttribute('aria-hidden')).toBe('true');
      expect(li.querySelector('.checking__state')?.textContent).toBe('Siap');
      expect(li.querySelector('.checking__state')?.className).toContain('sr-only');
      expect(t.q('[data-step="check"] .checking__icon')?.textContent).toBe('●');
      expect(t.q('[data-step="check"] .checking__state')?.textContent).toBe('Sedang dibuat');
      expect(t.q('[data-step="forest"] .checking__icon')?.textContent).toBe('○');
      expect(t.q('[data-step="forest"] .checking__state')?.textContent).toBe('Belum');
    });

    it('queued：第 1 步当前；文件还在读也是第 1 步当前，读完自己推进到第 2 步', async () => {
      const t = await setup();
      await t.ready([run('a1', 'queued')], [doc('d1', 'extracted')]);
      expect(t.steps()[0]).toEqual(['read', 'current']);
      expect(t.q('#spinner')).not.toBeNull();

      await t.assessments([run('a1', 'running')]);
      await t.documents([doc('d1', 'extracting')]);
      expect(t.steps()).toEqual([
        ['read', 'current'],
        ['check', 'pending'],
        ['forest', 'pending'],
        ['actions', 'pending'],
      ]);

      await t.documents([doc('d1', 'extracted')]);
      expect(t.steps()).toEqual([
        ['read', 'done'],
        ['check', 'current'],
        ['forest', 'pending'],
        ['actions', 'pending'],
      ]);
    });

    it('页面开着时评估 queued → running → done 自己变：圈停、四步完成、出现「Lihat keputusan」', async () => {
      const t = await setup();
      await t.ready([run('a1', 'queued')]);
      expect(t.q('#spinner')).not.toBeNull();
      expect(t.q('#see-result')).toBeNull();

      await t.assessments([run('a1', 'running')]);
      expect(t.q('#spinner')).not.toBeNull();

      await t.assessments([run('a1', 'done')]);
      expect(t.q('#spinner')).toBeNull();
      expect(t.q('#eta')).toBeNull();
      expect(t.q('#headline')?.textContent).toBe('Semakan siap');
      expect(t.q('#help')?.textContent).toBe('Keputusan sudah ada.');
      expect(t.steps().every(([, state]) => state === 'done')).toBe(true);
      expect(t.q('#see-result')?.textContent?.trim()).toBe('Lihat keputusan');
      expect(t.q('#back-to-plots')).not.toBeNull();
    });

    it('取最新一次：最新一次还在跑，更早的 done 不算当前状态', async () => {
      const t = await setup();
      await t.ready([
        run('old', 'done', { createdAt: new Date('2026-10-01T00:00:00Z') }),
        run('new', 'running', { createdAt: new Date('2026-10-09T00:00:00Z') }),
      ]);
      expect(t.q('#spinner')).not.toBeNull();
      expect(t.q('#see-result')).toBeNull();
    });
  });

  describe('缓存与结构', () => {
    it('数据来自缓存：照常显示，并带「Disimpan di telefon」提示；服务器确认的数据没有提示', async () => {
      const t = await setup();
      t.facade.emitDoc('plots/p1', PLOT, true);
      await settle(t.fixture);
      t.facade.emitCollection('plots/p1/assessments', [run('a1', 'running')], { fromCache: true });
      t.facade.emitCollection('plots/p1/documents', [doc('d1', 'extracted')], { fromCache: true });
      await settle(t.fixture);
      expect(t.q('#spinner')).not.toBeNull();
      expect(t.q('#cached')?.textContent).toContain('Disimpan di telefon');

      await t.ready([run('a1', 'running')]);
      expect(t.q('#cached')).toBeNull();
    });

    it('结构：标题在 h1，进度说明区是 aria-live，步骤是 ol＞li，转圈对读屏器隐藏', async () => {
      const t = await setup();
      await t.ready([run('a1', 'running')]);
      expect(t.q('h1')?.textContent).toContain('Sedang menyemak');
      expect(t.q('.checking__hero')?.getAttribute('aria-live')).toBe('polite');
      expect(t.all('ol#steps > li')).toHaveLength(4);
      expect(t.q('#spinner')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('英文失败态：「Officer to review」仍是可见文字（不是 sr-only）', async () => {
      const t = await setup();
      await t.ready([run('a1', 'failed', { result: null })]);
      t.i18n.set('en');
      await settle(t.fixture);
      const state = t.q('[data-step="check"] .checking__state')!;
      expect(state.textContent).toBe('Officer to review');
      expect(state.className).not.toContain('sr-only');
    });
  });

  describe('失败与没有评估', () => {
    it('失败：不显示错误信息；当前那一步写「需人工复核」；不转圈；回「我的地块」', async () => {
      const t = await setup();
      await t.ready([run('a1', 'failed', { result: null, errorMessage: 'SECRET stack trace' })]);
      expect(t.text()).not.toContain('SECRET');
      expect(t.q('#spinner')).toBeNull();
      expect(t.q('#eta')).toBeNull();
      expect(t.q('#see-result')).toBeNull();
      expect(t.q('#headline')?.textContent).toBe('Pegawai koperasi akan menyemak.');
      expect(t.steps()).toEqual([
        ['read', 'done'],
        ['check', 'review'],
        ['forest', 'pending'],
        ['actions', 'pending'],
      ]);
      const review = t.q('[data-step="check"]')!;
      expect(review.querySelector('.checking__icon')?.textContent).toBe('?');
      expect(review.querySelector('.checking__state')?.textContent).toBe('Menunggu pegawai');
      expect(review.querySelector('.checking__state')?.className).not.toContain('sr-only');
      expect(t.q('#back-to-plots')).not.toBeNull();
    });

    it('评估写了 done 却没有结论（result 缺失）：不说「完成」，按需人工复核', async () => {
      const t = await setup();
      await t.ready([run('a1', 'done', { result: null })]);
      expect(t.q('#headline')?.textContent).toBe('Pegawai koperasi akan menyemak.');
      expect(t.q('#see-result')).toBeNull();
      expect(t.q('[data-step="check"] .checking__icon')?.textContent).toBe('?');
    });

    it('没有评估：写「belum diperiksa」，不转圈、不列步骤', async () => {
      const t = await setup();
      await t.ready([]);
      expect(t.q('#headline')?.textContent).toBe('Tanah ini belum diperiksa.');
      expect(t.q('#spinner')).toBeNull();
      expect(t.q('#steps')).toBeNull();
      expect(t.q('#eta')).toBeNull();
      expect(t.q('#see-result')).toBeNull();
      expect(t.q('#back-to-plots')).not.toBeNull();
    });
  });

  describe('导航', () => {
    it('「Kembali ke Tanah saya」去屏 2，保留 ?member', async () => {
      const t = await setup('/plots/p1/checking?member=m9');
      await t.ready([run('a1', 'running')]);
      await t.click('#back-to-plots');
      expect(t.router.url).toBe('/?member=m9');
    });

    it('左上角的 ← 同样去屏 2，保留 ?member', async () => {
      const t = await setup('/plots/p1/checking?member=m8');
      await t.ready([run('a1', 'running')]);
      await t.click('#back');
      expect(t.router.url).toBe('/?member=m8');
    });

    it('「Lihat keputusan」去屏 9，保留 ?member', async () => {
      const t = await setup('/plots/p1/checking?member=m9');
      await t.ready([run('a1', 'done')]);
      await t.click('#see-result');
      expect(t.router.url).toBe('/plots/p1?member=m9');
    });
  });

  describe('语言、隐私与订阅', () => {
    it('切到英语：标题、步骤、说明、按钮都跟着变', async () => {
      const t = await setup();
      await t.ready([run('a1', 'running')]);
      t.i18n.set('en');
      await settle(t.fixture);
      expect(t.q('h1')?.textContent).toContain('Checking now');
      expect(t.q('#headline')?.textContent).toBe('Checking your land…');
      expect(t.all('#steps .checking__label').map((e) => e.textContent)).toEqual([
        'Reading documents',
        'Checking the details',
        'Checking satellite images for forest',
        'Preparing your to-do list',
      ]);
      expect(t.q('#eta')?.textContent).toBe('About 2 minutes. You can leave.');
      expect(t.q('#back-to-plots')?.textContent?.trim()).toBe('Back to My plots');
      expect(t.text()).not.toMatch(CJK);
    });

    it('页面文字里没有说明文字、错误信息、id、存储路径、哈希、中文', async () => {
      const t = await setup();
      await t.ready([run('ASSESSMENT-SECRET', 'running', { plotId: 'PLOT-SECRET' })]);
      const text = t.text();
      expect(text).not.toMatch(CJK);
      for (const secret of [
        'INTERNAL-SUMMARY',
        'SNAPSHOT-SECRET',
        'MODEL-SECRET',
        'ASSESSMENT-SECRET',
        'PLOT-SECRET',
        'HASH-SECRET',
        'seed/',
      ]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(t.el.innerHTML).not.toContain('PLOT-SECRET');
    });

    it('离开页面后所有监听都取消', async () => {
      const t = await setup();
      await t.ready([run('a1', 'running')]);
      expect(t.facade.activeCount).toBe(3);
      t.fixture.destroy();
      expect(t.facade.activeCount).toBe(0);
    });
  });
});
