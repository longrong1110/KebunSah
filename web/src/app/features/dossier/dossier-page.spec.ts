import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import { CJK, assessment, polygonGeojson } from '../../../testing/assessment-fixtures';
import { stubHistory } from '../../../testing/back';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { DossierPage } from './dossier-page';

@Component({ template: '' })
class Blank {}

const PLOT = {
  landTitleId: 't1',
  operatorPersonId: 'pe1',
  mpobLicenceId: 'm1',
  mspoCertificateId: 's1',
  coopId: 'c1',
  nickname: 'Kebun Arwah Ayah',
  district: 'Kampar',
  state: 'Perak',
  titleNo: 'HSM 2217/91',
  countryCode: 'MY',
  status: 'yellow',
  areaHaComputed: 3.49,
  centroidLat: 4.31,
  centroidLng: 101.15,
  oilPalmPlantedYear: 2012,
  geometryRecordedAt: new Date('2026-10-03T02:20:00Z'),
  polygonGeojson,
  isSynthetic: true,
};

const TITLE = {
  lotNo: '2217',
  titleNo: 'HSM 2217/91',
  mukim: 'Kampar',
  district: 'Kampar',
  state: 'Perak',
  tenure: 'freehold',
  landUseCategory: 'agriculture',
};
const PERSON = { fullName: 'AHMAD ZAKI BIN ROSLI', icHash: 'IC-HASH-SECRET', icLast4: '4321' };
const MPOB = { licenceNo: '810212345678', validUntil: '2026-12-05', holderName: 'HOLDER-SECRET' };
const MSPO = {
  certNo: 'MSPO 900001',
  expiryDate: '2029-02-28',
  certificateHolder: 'Contoh Sawit Sdn. Bhd. (虚构) HOLDER-SECRET',
};
const COOP = { name: 'Koperasi Pekebun Kecil Contoh (虚构)' };

const doc = (
  docType: string,
  pageNo: number,
  extractionStatus = 'extracted',
  isCurrent = true,
) => ({
  id: `${docType}-${pageNo}`,
  data: {
    docType,
    pageNo,
    isCurrent,
    extractionStatus,
    storagePath: `seed/PLOT-SECRET/${docType}-${pageNo}.jpg`,
    fileHash: 'HASH-SECRET',
  },
});
const DOCS = [
  doc('land_title', 1),
  doc('land_title', 2),
  doc('mpob_licence', 1, 'needs_review'),
  doc('mspo_cert', 1),
];

async function setup(url = '/plots/p1/dossier') {
  const facade = new FakeFacade();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'coop', component: Blank },
        { path: 'plots/:id/dossier', component: DossierPage },
      ]),
      { provide: FIRESTORE_FACADE, useValue: facade },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, DossierPage);
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
    /** 核心三个来源 */
    core: async (
      assessments: { id: string; data: Record<string, unknown> }[] = [
        { id: 'a1', data: assessment() },
      ],
      documents = DOCS,
    ) => {
      facade.emitCollection('plots/p1/assessments', assessments);
      facade.emitCollection('plots/p1/documents', documents);
      await settle(fixture);
    },
    /** 地块里引用的五个文档，数据全部读到 */
    derived: async () => {
      facade.emitDoc('titles/t1', TITLE);
      facade.emitDoc('persons/pe1', PERSON);
      facade.emitDoc('mpobLicences/m1', MPOB);
      facade.emitDoc('mspoCertificates/s1', MSPO);
      facade.emitDoc('cooperatives/c1', COOP);
      await settle(fixture);
    },
    /** 常用组合：地块先到（派生订阅才会建立），再是其余来源，都是服务器确认的 */
    ready: async (
      over: {
        plot?: Record<string, unknown>;
        assessments?: { id: string; data: Record<string, unknown> }[];
        documents?: typeof DOCS;
      } = {},
    ) => {
      facade.emitDoc('plots/p1', over.plot ?? PLOT);
      await settle(fixture);
      facade.emitCollection(
        'plots/p1/assessments',
        over.assessments ?? [{ id: 'a1', data: assessment() }],
      );
      facade.emitCollection('plots/p1/documents', over.documents ?? DOCS);
      await api.derived();
    },
  };
  return api;
}

describe('DossierPage（导出档案）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('读取之前与失败', () => {
    it('读到之前显示骨架，没有档案纸面，打印钮禁用', async () => {
      const t = await setup();
      expect(t.q('#loading')).not.toBeNull();
      expect(t.q('#dossier')).toBeNull();
      expect((t.q('#print') as HTMLButtonElement).disabled).toBe(true);
      expect(t.q('#print-hint')).toBeNull();
      expect(t.q('h1')?.textContent).toContain('Dossier pematuhan tanah');
    });

    it('地块文档服务器确认不存在：说明；缓存里的「不存在」不下结论', async () => {
      const t = await setup();
      await t.plot(null, true);
      expect(t.q('#not-found')).toBeNull();
      expect(t.q('#loading')).not.toBeNull();

      await t.plot(null, false);
      expect(t.q('#not-found')?.textContent).toContain('Tanah ini tidak dijumpai');
      expect(t.q('#dossier')).toBeNull();
    });

    it('地块到了，但评估、文档或派生文档还没到：继续加载，不出档案', async () => {
      const t = await setup();
      await t.plot(PLOT);
      expect(t.q('#loading')).not.toBeNull();

      t.facade.emitCollection('plots/p1/assessments', [{ id: 'a1', data: assessment() }]);
      await settle(t.fixture);
      expect(t.q('#loading')).not.toBeNull();

      t.facade.emitCollection('plots/p1/documents', DOCS);
      await settle(t.fixture);
      expect(t.q('#loading')).not.toBeNull(); // 地契等五个还没到

      await t.derived();
      expect(t.q('#loading')).toBeNull();
      expect(t.q('#dossier')).not.toBeNull();
    });

    it('评估或文档子集合在缓存里是空的：不能当成「没有」，先加载', async () => {
      const t = await setup();
      await t.plot(PLOT);
      t.facade.emitCollection('plots/p1/assessments', [], { fromCache: true });
      t.facade.emitCollection('plots/p1/documents', [], { fromCache: true });
      await t.derived();
      expect(t.q('#loading')).not.toBeNull();
      expect(t.q('#dossier')).toBeNull();

      await t.core([], []);
      expect(t.q('#dossier')).not.toBeNull();
      expect(t.q('#d-summary')?.getAttribute('data-banner')).toBe('pending');
    });

    it('地契、成员、MPOB、MSPO、合作社确认不存在：不挡页面，对应字段写「—」', async () => {
      const t = await setup();
      await t.plot(PLOT);
      await t.core();
      t.facade.emitDoc('titles/t1', null);
      t.facade.emitDoc('persons/pe1', null);
      t.facade.emitDoc('mpobLicences/m1', null);
      t.facade.emitDoc('mspoCertificates/s1', null);
      t.facade.emitDoc('cooperatives/c1', null);
      await settle(t.fixture);

      expect(t.q('#dossier')).not.toBeNull();
      const info = (key: string) => t.q(`[data-key="${key}"] dd`)?.textContent?.trim();
      expect(info('lot')).toBe('—');
      expect(info('operator')).toBe('—');
      expect(info('coop')).toBe('—');
      // 地契读不到时，地契号与 daerah 退回 plots 上复制的字段
      expect(info('titleNo')).toBe('HSM 2217/91');
      expect(info('district')).toBe('Kampar');
      expect(t.q('#d-coop')).toBeNull();
      expect(t.q('#d-heading')?.textContent).toBe('HSM 2217/91, Kampar');
      // 文件行没有执照号与证书号，但仍有页数
      const row = t.q('[data-doc="mpob_licence"]')!;
      expect(row.textContent).toContain('1 halaman');
      expect(row.textContent).not.toContain('810212345678');
    });

    it('地块没有登记任何引用 id：只要核心三个到了就出档案，也不去订阅那五个集合', async () => {
      const t = await setup();
      const bare = {
        ...PLOT,
        landTitleId: null,
        operatorPersonId: null,
        mpobLicenceId: null,
        mspoCertificateId: null,
        coopId: null,
      };
      await t.plot(bare);
      await t.core();
      expect(t.q('#dossier')).not.toBeNull();
      expect(t.q('#d-heading')?.textContent).toBe('Lot baharu');
      for (const p of [
        'titles/',
        'persons/',
        'mpobLicences/',
        'mspoCertificates/',
        'cooperatives/',
      ]) {
        expect(
          t.facade.docs.filter((w) => w.path.startsWith(p)),
          p,
        ).toHaveLength(0);
      }
    });

    it('10 秒没被服务器确认：离线提示；点「Cuba lagi」全部重新订阅；快照到了恢复', async () => {
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

      await t.ready();
      expect(t.q('#offline')).toBeNull();
      expect(t.q('#dossier')).not.toBeNull();
    });

    it('监听出错（如权限被拒）：错误与重试；派生文档出错也一样；不出档案', async () => {
      const t = await setup();
      await t.plot(PLOT);
      t.facade.failCollection('plots/p1/documents');
      await settle(t.fixture);
      expect(t.q('#error')?.textContent).toContain('Tidak dapat memuat');
      expect(t.q('#retry')).not.toBeNull();
      expect(t.q('#dossier')).toBeNull();

      await t.click('#retry');
      expect(t.facade.activeCollections('plots/p1/documents')).toHaveLength(1);
      await t.ready();
      expect(t.q('#error')).toBeNull();
      expect(t.q('#dossier')).not.toBeNull();

      t.facade.failDoc('titles/t1');
      await settle(t.fixture);
      expect(t.q('#error')).not.toBeNull();
      expect(t.q('#dossier')).toBeNull();
    });

    it('派生文档出错后点重试：派生订阅也重新订阅，读到后恢复出档案', async () => {
      const t = await setup();
      await t.ready();
      t.facade.failDoc('titles/t1');
      await settle(t.fixture);
      expect(t.q('#error')).not.toBeNull();
      expect(t.q('#dossier')).toBeNull();
      expect(t.facade.activeDocs('titles/t1')).toHaveLength(0);

      // 重试先重新订阅地块；派生文档要等地块再读到、拿到引用 id 后才重新订阅
      await t.click('#retry');
      expect(t.facade.activeDocs('plots/p1')).toHaveLength(1);
      await t.ready();
      expect(t.facade.activeDocs('titles/t1')).toHaveLength(1);
      expect(t.q('#error')).toBeNull();
      expect(t.q('#dossier')).not.toBeNull();
    });

    it('缓存里有数据：照常出档案，并把「可能不是最新」写在纸面上（印出来的 PDF 也带）', async () => {
      const t = await setup();
      t.facade.emitDoc('plots/p1', PLOT, true);
      await settle(t.fixture);
      t.facade.emitCollection('plots/p1/assessments', [{ id: 'a1', data: assessment() }], {
        fromCache: true,
      });
      t.facade.emitCollection('plots/p1/documents', DOCS, { fromCache: true });
      await t.derived();
      expect(t.q('#dossier')).not.toBeNull();
      expect(t.q('#cached')?.textContent).toContain('simpanan peranti dan mungkin belum terkini');
      expect(t.q('#dossier')!.contains(t.q('#cached'))).toBe(true);
      expect(t.q('.dossier-toolbar')!.contains(t.q('#cached'))).toBe(false);
    });
  });

  describe('档案内容', () => {
    it('页头：标题、地块、合作社（去掉中文括号）、生成日期、模拟数据提示', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#d-title')?.textContent).toBe('Dossier pematuhan tanah');
      expect(t.q('#d-heading')?.textContent).toBe('Lot 2217, Kampar');
      expect(t.q('#d-coop')?.textContent).toBe('Koperasi Pekebun Kecil Contoh');
      expect(t.q('#d-generated')?.textContent).toMatch(/^Dijana pada \d{4}-\d{2}-\d{2}$/);
      expect(t.q('#d-synthetic')?.textContent).toBe('Data simulasi (CONTOH) — bukan data sebenar');
      expect(t.q('#cached')).toBeNull(); // 服务器确认过的数据，不带「可能不是最新」
    });

    it('不是模拟数据：没有提示', async () => {
      const t = await setup();
      await t.ready({ plot: { ...PLOT, isSynthetic: false } });
      expect(t.q('#d-synthetic')).toBeNull();
    });

    it('摘要：结论颜色＋图标＋文字，评估日期', async () => {
      const t = await setup();
      await t.ready();
      const s = t.q('#d-summary')!;
      expect(s.getAttribute('data-banner')).toBe('yellow');
      expect(s.className).toContain('tone-warn');
      expect(s.querySelector('.dossier-summary__icon')?.textContent).toBe('⚠');
      expect(s.textContent).toContain('Hampir siap');
      expect(s.textContent).toContain('2 perkara perlu dibuat sebelum dokumen anda lengkap.');
      expect(t.q('#d-checked-on')?.textContent).toBe('Disemak pada 3 Okt 2026');
    });

    it('地块信息表：各字段', async () => {
      const t = await setup();
      await t.ready();
      const info = Object.fromEntries(
        t
          .all('#d-info .dossier-info__row')
          .map((r) => [r.getAttribute('data-key'), r.querySelector('dd')?.textContent?.trim()]),
      );
      expect(info).toEqual({
        lot: '2217',
        titleNo: 'HSM 2217/91',
        mukim: 'Kampar',
        district: 'Kampar',
        state: 'Perak',
        country: 'Malaysia',
        operator: 'Ahmad Zaki bin Rosli',
        coop: 'Koperasi Pekebun Kecil Contoh',
        area: '3.49 ha',
        planted: '2012',
        tenure: 'Hak milik kekal (freehold)',
        landUse: 'Pertanian',
        boundaryDate: '2026-10-03',
      });
    });

    it('位置：中心点、顶点表、形状预览（内联 SVG）', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#d-centroid')?.textContent).toContain('4.310000, 101.150000');
      const rows = t.all('#d-vertices tbody tr');
      expect(rows).toHaveLength(4);
      expect([...rows[0].querySelectorAll('td')].map((c) => c.textContent)).toEqual([
        '1',
        '4.309105',
        '101.149037',
      ]);
      expect(t.q('#d-shape polygon')?.getAttribute('points')).toMatch(/^[\d.,\s]+$/);
      expect(t.q('#d-shape')?.getAttribute('viewBox')).toBe('0 0 240 140');
      // 图只是装饰，说明文字由 figcaption 给，读屏器不重复读
      expect(t.q('#d-shape')?.getAttribute('aria-hidden')).toBe('true');
      expect(t.q('#d-shape')?.hasAttribute('aria-label')).toBe(false);
      expect(t.text()).toContain('Gambaran kasar, bukan peta satelit');
      expect(t.q('#d-more')).toBeNull();
    });

    it('多边形坏了：只写中心点；什么坐标都没有：写「Tiada data lokasi」', async () => {
      const t = await setup();
      await t.ready({ plot: { ...PLOT, polygonGeojson: 'not json' } });
      expect(t.q('#d-centroid')).not.toBeNull();
      expect(t.q('#d-vertices')).toBeNull();
      expect(t.q('#d-shape')).toBeNull();
      expect(t.q('#d-no-location')).toBeNull();

      t.facade.emitDoc('plots/p1', {
        ...PLOT,
        polygonGeojson: null,
        centroidLat: null,
        centroidLng: null,
      });
      await settle(t.fixture);
      expect(t.q('#d-no-location')?.textContent).toContain('Tiada data lokasi');
    });

    it('规则表：名称、结果标签（颜色＋图标＋文字）、一句话；不出现原始数值字符串', async () => {
      const t = await setup();
      await t.ready();
      const rows = t.all('#d-checks tbody tr');
      expect(rows.map((r) => r.getAttribute('data-rule'))).toEqual(['CC-01', 'CC-02', 'CC-03']);
      const cells = (i: number) =>
        [...rows[i].children].map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
      expect(cells(0)).toEqual([
        'Keluasan: geran lawan lukisan',
        '⚠ Perlu perhatian',
        'Geran 3.04 ha, lukisan 3.49 ha',
      ]);
      expect(cells(1)).toEqual(['Tempoh sah dokumen', '⚠ Perlu perhatian', 'Baki 58 hari']);
      expect(cells(2)).toEqual(['Nama pemilik', '✓ Lulus', 'Nama sepadan dengan pengusaha']);
      // 首列是行标题，读屏器能读到「这一行是哪个检查」
      for (const r of rows) expect(r.firstElementChild?.matches('th[scope="row"]')).toBe(true);
      expect(rows[0].querySelector('.chip')?.className).toContain('tone-warn');
      expect(rows[2].querySelector('.chip')?.className).toContain('tone-ok');
      expect(t.text()).not.toContain('3.4900');
      expect(t.text()).not.toContain('58 天');
    });

    it('未解决的缺口：标题、带数字的详情、建议；没有缺口写「Tiada perkara…」', async () => {
      const t = await setup();
      await t.ready();
      const items = t.all('#d-open li');
      expect(items).toHaveLength(2);
      expect(items[0].querySelector('.dossier-open__title')?.textContent).toBe(
        'Keluasan tidak sepadan',
      );
      expect(items[0].textContent).toContain('Geran 3.04 ha, lukisan anda 3.49 ha');
      expect(items[1].querySelector('.dossier-open__title')?.textContent).toBe(
        'Lesen MPOB hampir tamat',
      );
      expect(items[1].textContent).toContain('Tamat dalam 58 hari.');

      t.facade.emitCollection('plots/p1/assessments', [
        { id: 'a1', data: assessment({ result: 'green', gaps: [] }) },
      ]);
      await settle(t.fixture);
      expect(t.q('#d-open')).toBeNull();
      expect(t.q('#d-no-open')?.textContent).toContain('Tiada perkara yang belum selesai');
    });

    it('森林初筛：一句话＋「只是初筛」；损失数字', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#d-forest')?.textContent).toBe(
        'Saringan hutan: tiada kehilangan hutan dikesan. Ini saringan awal sahaja.',
      );
      expect(t.q('#d-forest-loss')?.textContent).toBe('Kehilangan hutan selepas 2020: 0 ha');
      expect(t.q('#d-forest-cover')).toBeNull();
      expect(t.q('#d-h-forest')?.textContent).toContain('awal');
    });

    it('文件：每种一行，页数、读取状态、MPOB 执照号与到期日、MSPO 证书号与到期日', async () => {
      const t = await setup();
      await t.ready();
      const row = (type: string) =>
        [...t.q(`[data-doc="${type}"]`)!.children].map((c) => c.textContent?.trim());
      expect(row('land_title')).toEqual(['Geran tanah', '2 halaman', 'Dibaca', '']);
      expect(row('mpob_licence')).toEqual([
        'Lesen MPOB',
        '1 halaman',
        'Perlu semakan',
        'No. 810212345678 · sah sehingga 5 Dis 2026',
      ]);
      expect(row('mspo_cert')).toEqual([
        'Sijil MSPO',
        '1 halaman',
        'Dibaca',
        'No. MSPO 900001 · tamat 28 Feb 2029',
      ]);
    });

    it('没有任何文档：写「Tiada dokumen」', async () => {
      const t = await setup();
      await t.ready({ documents: [] });
      expect(t.q('#d-docs')).toBeNull();
      expect(t.q('#d-no-docs')?.textContent).toContain('Tiada dokumen');
    });

    it('页脚的 Penafian：说明不是官方 DDS', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#d-disclaimer')?.textContent).toContain(
        'bukan Pernyataan Usaha Wajar (DDS) rasmi',
      );
      expect(t.q('#d-disclaimer')?.textContent).toContain('semak oleh manusia');
    });
  });

  describe('没有结论时不下任何结论', () => {
    it('没有评估：Belum mula＋「belum diperiksa」，不写规则、缺口、森林', async () => {
      const t = await setup();
      await t.ready({ assessments: [] });
      expect(t.q('#d-summary')?.getAttribute('data-banner')).toBe('pending');
      expect(t.q('#d-summary')?.textContent).toContain('Tanah ini belum diperiksa.');
      for (const id of ['#d-checks', '#d-open', '#d-no-open', '#d-forest', '#d-checked-on']) {
        expect(t.q(id), id).toBeNull();
      }
      // 其余部分照常
      expect(t.q('#d-info')).not.toBeNull();
      expect(t.q('#d-docs')).not.toBeNull();
    });

    it('还在检查或失败：同样不写结论，也不显示 errorMessage', async () => {
      const t = await setup();
      await t.ready({
        assessments: [
          {
            id: 'a1',
            data: assessment({ runStatus: 'failed', result: null, errorMessage: 'SECRET stack' }),
          },
        ],
      });
      expect(t.q('#d-summary')?.getAttribute('data-banner')).toBe('needs_review');
      for (const id of ['#d-checks', '#d-open', '#d-forest', '#d-checked-on']) {
        expect(t.q(id), id).toBeNull();
      }
      expect(t.text()).not.toContain('SECRET');

      t.facade.emitCollection('plots/p1/assessments', [
        { id: 'a1', data: assessment({ runStatus: 'running', result: null }) },
      ]);
      await settle(t.fixture);
      expect(t.q('#d-summary')?.getAttribute('data-banner')).toBe('running');
      expect(t.q('#d-checks')).toBeNull();
    });
  });

  describe('隐私', () => {
    it('页面文字里没有证件、说明文字、持有人名称、中文、存储路径、哈希、id、nickname', async () => {
      const t = await setup();
      await t.ready({
        assessments: [{ id: 'ASSESSMENT-SECRET', data: assessment({ plotId: 'PLOT-SECRET' }) }],
      });
      const text = t.text();
      expect(text).not.toMatch(CJK);
      for (const secret of [
        'IC-HASH',
        '4321',
        'HOLDER-SECRET',
        'PLOT-SECRET',
        'ASSESSMENT-SECRET',
        'HASH-SECRET',
        'CITATION-SECRET',
        'INTERNAL-SUMMARY',
        'SNAPSHOT-SECRET',
        'MODEL-SECRET',
        'RULES-SECRET',
        'RAMAN',
        'Arwah',
        'seed/',
        'p1',
      ]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(t.el.innerHTML).not.toContain('PLOT-SECRET');
      expect(t.el.innerHTML).not.toContain('IC-HASH');
    });
  });

  describe('打印、标题、返回', () => {
    it('「Cetak／Simpan sebagai PDF」调用 window.print()；没出档案之前不能点', async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const t = await setup();
      const btn = t.q('#print') as HTMLButtonElement;
      expect(btn.textContent?.trim()).toBe('Cetak / Simpan sebagai PDF');
      expect(btn.disabled).toBe(true);
      btn.click();
      expect(print).not.toHaveBeenCalled();

      await t.ready();
      expect(btn.disabled).toBe(false);
      await t.click('#print');
      expect(print).toHaveBeenCalledTimes(1);
    });

    it('工具栏带 dossier-toolbar（打印时隐藏），档案纸面不在工具栏里', async () => {
      const t = await setup();
      await t.ready();
      const bar = t.q('.dossier-toolbar')!;
      expect(bar.querySelector('#print')).not.toBeNull();
      expect(bar.querySelector('app-lang-button')).not.toBeNull();
      expect(bar.querySelector('#back')).not.toBeNull();
      // 提醒关掉浏览器的页眉页脚（否则 PDF 里会印出带地块 id 的网址）
      expect(bar.querySelector('#print-hint')?.textContent).toContain('Pengepala dan pengaki');
      expect(bar.contains(t.q('#dossier'))).toBe(false);
    });

    it('页面标题：读到之前是通用标题（不留着上一页的名字），读到后设成「KebunSah dossier — {lot}」，离开页面还原', async () => {
      document.title = 'Keputusan — KebunSah';
      const t = await setup();
      const title = TestBed.inject(Title);
      expect(title.getTitle()).toBe('Dossier pematuhan tanah — KebunSah');

      await t.ready();
      expect(title.getTitle()).toBe('KebunSah dossier — Lot 2217, Kampar');

      t.fixture.destroy();
      expect(title.getTitle()).toBe('Keputusan — KebunSah');
    });

    it('地块不存在：标题仍是通用标题，切英语跟着变', async () => {
      document.title = 'Keputusan — KebunSah';
      const t = await setup();
      const title = TestBed.inject(Title);
      await t.plot(null);
      expect(title.getTitle()).toBe('Dossier pematuhan tanah — KebunSah');
      t.i18n.set('en');
      await settle(t.fixture);
      expect(title.getTitle()).toBe('Land compliance dossier — KebunSah');
    });

    it('返回：有历史就后退，不再导航', async () => {
      const t = await setup();
      await t.ready();
      const back = stubHistory(true);
      await t.click('#back');
      expect(back).toHaveBeenCalledTimes(1);
      expect(t.router.url).toBe('/plots/p1/dossier');
    });

    it('返回：没有历史回屏 2', async () => {
      const t = await setup();
      await t.ready();
      await t.click('#back');
      expect(t.router.url).toBe('/');
    });

    it('地块不存在时，「Kembali ke senarai tanah」同样返回（没有历史回屏 2）', async () => {
      const t = await setup();
      await t.plot(null, false);
      await t.click('#back-to-list');
      expect(t.router.url).toBe('/');
    });
  });

  describe('语言与订阅', () => {
    it('切到英语：标签、结论、规则、文件都跟着变', async () => {
      const t = await setup();
      await t.ready();
      t.i18n.set('en');
      await settle(t.fixture);
      expect(t.q('#d-title')?.textContent).toBe('Land compliance dossier');
      expect(t.q('#d-synthetic')?.textContent).toContain('Simulated data');
      expect(t.q('#d-summary')?.textContent).toContain('Almost there');
      expect(t.q('[data-key="tenure"] dd')?.textContent?.trim()).toBe('Freehold');
      expect(t.q('[data-rule="CC-03"]')?.textContent).toContain('Name matches the operator');
      expect(t.q('[data-doc="mpob_licence"]')?.textContent).toContain('valid until 5 Dec 2026');
      expect(t.q('#print')?.textContent?.trim()).toBe('Print / Save as PDF');
      expect(t.text()).not.toMatch(CJK);
    });

    it('离开页面后所有监听都取消', async () => {
      const t = await setup();
      await t.ready();
      expect(t.facade.activeCount).toBe(8);
      t.fixture.destroy();
      expect(t.facade.activeCount).toBe(0);
    });
  });
});
