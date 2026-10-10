import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { AuthService } from '../../core/firebase/auth.service';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import { CJK, polygonGeojson } from '../../../testing/assessment-fixtures';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { CoopPage } from './coop-page';

@Component({ template: '' })
class Blank {}

const d = (iso: string) => new Date(iso);

const ADMIN = { role: 'coop_admin', coopId: 'c1', language: 'ms' };

const plotDoc = (over: Record<string, unknown> = {}) => ({
  coopId: 'c1',
  landTitleId: null,
  district: 'Kampar',
  status: 'yellow',
  lastAssessedAt: d('2026-10-01T04:00:00Z'),
  polygonGeojson,
  ...over,
});

// 种子里缺口的 description／suggestedAction 是中文占位，CC-03 的 detail 带第三人姓名：照样带上，断言页面不出现
const gap = (gapCode: string, severity = 'medium', docType: string | null = null) => ({
  gapCode,
  severity,
  docType,
  status: 'open',
  description: `中文说明 ${gapCode} RAMAN A/L SUBRAMANIAM`,
  suggestedAction: '中文建议 已故父亲',
});

const assessmentDoc = (plotId: string, over: Record<string, unknown> = {}) => ({
  plotId,
  runStatus: 'done',
  result: 'yellow',
  createdAt: d('2026-10-03T02:22:00Z'),
  finishedAt: d('2026-10-03T02:24:00Z'),
  forestRisk: 'low',
  forestLossAfter2020Ha: 0,
  summaryText: '中文摘要 INTERNAL-SUMMARY',
  errorMessage: null,
  gaps: [],
  ruleResults: [
    {
      ruleCode: 'CC-01',
      result: 'warn',
      expectedValue: '3.0400 ha',
      actualValue: '3.4900 ha',
      detail: 'DETAIL RAMAN',
    },
    { ruleCode: 'CC-02', result: 'fail', actualValue: '2026-04-30 已过期' },
  ],
  ...over,
});

// 5 块地：p1 黄（面积不符＋将到期）、p2 红（过期＋姓名不符＋森林损失）、p3 绿、p4 需复核、p5 没有评估
const PLOTS = [
  { id: 'p1', data: plotDoc({ landTitleId: 't1', operatorPersonId: 'pe1' }) },
  {
    id: 'p2',
    data: plotDoc({
      landTitleId: 't2',
      operatorPersonId: 'pe2',
      status: 'red',
      lastAssessedAt: d('2026-10-08T04:00:00Z'),
    }),
  },
  { id: 'p3', data: plotDoc({ landTitleId: null, operatorPersonId: 'pe3', status: 'green' }) },
  {
    id: 'p4',
    data: plotDoc({ landTitleId: null, operatorPersonId: 'pe4', status: 'needs_review' }),
  },
  {
    id: 'p5',
    data: plotDoc({
      landTitleId: null,
      operatorPersonId: 'pe5',
      status: 'pending',
      polygonGeojson: null,
    }),
  },
];
const ASSESSMENTS = [
  {
    id: 'a1',
    data: assessmentDoc('p1', {
      gaps: [gap('area_mismatch'), gap('expiring', 'medium', 'mpob_licence')],
    }),
  },
  {
    id: 'a2',
    data: assessmentDoc('p2', {
      result: 'red',
      createdAt: d('2026-10-08T02:22:00Z'),
      finishedAt: d('2026-10-08T02:24:00Z'),
      gaps: [gap('expired', 'high', 'mpob_licence'), gap('name_mismatch', 'high', 'land_title')],
      forestRisk: 'high',
      forestLossAfter2020Ha: 0.8,
    }),
  },
  { id: 'a3', data: assessmentDoc('p3', { result: 'green' }) },
  {
    id: 'a4',
    data: assessmentDoc('p4', {
      result: 'needs_review',
      gaps: [gap('low_confidence', 'medium', 'land_title')],
    }),
  },
  // 别的合作社的地块的评估：必须被忽略
  {
    id: 'a9',
    data: assessmentDoc('someone-elses-plot', { result: 'red', gaps: [gap('expired', 'high')] }),
  },
];
// persons 带着证件信息（界面绝不能用）
const PERSONS = [
  {
    id: 'pe1',
    data: { fullName: 'AHMAD ZAKI BIN ROSLI', icHash: 'HASH-SECRET-1', icLast4: '7311' },
  },
  { id: 'pe2', data: { fullName: 'MUTHU A/L RAMAN', icHash: 'HASH-SECRET-2', icLast4: '7322' } },
  { id: 'pe3', data: { fullName: 'TAN AH KOW', icHash: 'HASH-SECRET-3', icLast4: '7333' } },
  {
    id: 'pe4',
    data: { fullName: 'KRISHNAN A/L MARIMUTHU', icHash: 'HASH-SECRET-4', icLast4: '7344' },
  },
  { id: 'pe5', data: { fullName: "=CMD|' /C calc'!A0" } },
];
const TITLES = [
  { id: 't1', data: { lotNo: '507', district: 'Kampar' } },
  { id: 't2', data: { lotNo: '1234', district: 'Kluang' } },
];

const coopWhere = [{ field: 'coopId', value: 'c1' }] as const;

async function setup(
  options: { url?: string; signOut?: () => Promise<void>; user?: boolean } = {},
) {
  const facade = new FakeFacade();
  const auth = {
    user: () => (options.user === false ? null : { uid: 'u1', phoneNumber: '+60100000002' }),
    ready: () => true,
    signOut: vi.fn(options.signOut ?? (() => Promise.resolve())),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'login', component: Blank },
        { path: 'coop', component: CoopPage },
        { path: 'plots/:id', component: Blank },
      ]),
      { provide: AuthService, useValue: auth },
      { provide: FIRESTORE_FACADE, useValue: facade },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/coop', CoopPage);
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  await settle(fixture);

  const api = {
    fixture,
    facade,
    auth,
    el,
    router: TestBed.inject(Router),
    i18n: TestBed.inject(I18nService),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    all: (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)],
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    profile: async (data: Record<string, unknown> | null, fromCache = false) => {
      facade.emitDoc('users/u1', data, fromCache);
      await settle(fixture);
    },
    /** 四个数据订阅一起到（都是服务器确认的），再加合作社名 */
    data: async (
      over: Partial<{
        plots: typeof PLOTS;
        assessments: typeof ASSESSMENTS;
        persons: typeof PERSONS;
        titles: typeof TITLES;
      }> = {},
    ) => {
      facade.emitCollection('plots', over.plots ?? PLOTS, { where: coopWhere });
      facade.emitCollection('assessments', over.assessments ?? ASSESSMENTS);
      facade.emitCollection('persons', over.persons ?? PERSONS);
      facade.emitCollection('titles', over.titles ?? TITLES);
      facade.emitDoc('cooperatives/c1', { name: 'Koperasi Contoh' });
      await settle(fixture);
    },
    /** 登录为管理员并读到数据 */
    ready: async (language = 'ms') => {
      await api.profile({ ...ADMIN, language });
      await api.data();
    },
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
    rows: () =>
      api
        .all('.coop-row')
        .map((tr) =>
          [...tr.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim()),
        ),
    ids: () => api.all('.coop-row').map((tr) => tr.dataset['plotId']),
    type: async (value: string) => {
      const input = el.querySelector<HTMLInputElement>('#coop-q')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle(fixture);
    },
  };
  return api;
}

describe('CoopPage（屏 11）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('谁能看、读取之前', () => {
    it('档案读到之前显示加载态，不订阅任何数据', async () => {
      const t = await setup();
      expect(t.q('#coop-loading')).not.toBeNull();
      expect(t.facade.activeCollections('plots').length).toBe(0);
      expect(t.facade.activeCollections('assessments').length).toBe(0);
    });

    it.each([
      ['园主', { role: 'smallholder', personId: 'p1', coopId: 'c1' }],
      ['外勤', { role: 'field_officer', coopId: 'c1' }],
      ['角色未知', { role: 'weird', coopId: 'c1' }],
      ['没有档案', null],
    ])(
      '%s：只看到「Halaman ini untuk pentadbir koperasi.」，一个数据订阅都没有',
      async (_n, profile) => {
        const t = await setup();
        await t.profile(profile);
        expect(t.q('#coop-forbidden')?.textContent).toContain(
          'Halaman ini untuk pentadbir koperasi.',
        );
        expect(t.q('.coop-layout')).toBeNull();
        expect(t.q('#coop-role')).toBeNull(); // 顶栏不写「admin」
        for (const path of ['plots', 'assessments', 'persons', 'titles']) {
          expect(t.facade.activeCollections(path).length, path).toBe(0);
        }
        await t.click('#coop-back');
        expect(t.router.url).toBe('/');
      },
    );

    it('管理员但没有 coopId：提示账号未绑定合作社，不订阅数据', async () => {
      const t = await setup();
      await t.profile({ role: 'coop_admin', coopId: null });
      expect(t.q('#coop-nocoop')?.textContent).toContain('belum dikaitkan dengan koperasi');
      expect(t.facade.activeCollections('plots').length).toBe(0);
    });

    it('缓存里的「档案不存在」不能下结论：留在加载态', async () => {
      const t = await setup();
      await t.profile(null, true);
      expect(t.q('#coop-forbidden')).toBeNull();
      expect(t.q('#coop-loading')).not.toBeNull();
    });
  });

  describe('订阅与加载', () => {
    it('管理员订阅：地块（按 coopId 等值过滤）、评估（collection group）、成员、地契、合作社', async () => {
      const t = await setup();
      await t.profile(ADMIN);
      const plots = t.facade.activeCollections('plots');
      expect(plots).toHaveLength(1);
      expect(plots[0].filters).toEqual(coopWhere);
      expect(t.facade.activeCollections('assessments')[0].group).toBe(true);
      expect(t.facade.activeCollections('persons')).toHaveLength(1);
      expect(t.facade.activeCollections('titles')).toHaveLength(1);
      expect(t.facade.activeDocs('cooperatives/c1')).toHaveLength(1);
    });

    it('四个数据订阅都被服务器确认之前不出表格，也不显示残缺的计数', async () => {
      const t = await setup();
      await t.profile(ADMIN);
      t.facade.emitCollection('plots', PLOTS, { where: coopWhere });
      await settle(t.fixture);
      expect(t.q('#coop-loading')).not.toBeNull();
      expect(t.q('.coop-stats')).toBeNull();

      t.facade.emitCollection('assessments', ASSESSMENTS);
      t.facade.emitCollection('persons', PERSONS);
      await settle(t.fixture);
      expect(t.q('.coop-stats')).toBeNull(); // 地契还没到

      t.facade.emitCollection('titles', TITLES);
      await settle(t.fixture);
      expect(t.q('.coop-stats')).not.toBeNull();
    });

    it('缓存里的空结果不当成「合作社没有地块」：先加载，10 秒后转离线；点「Cuba lagi」重新订阅全部', async () => {
      vi.useFakeTimers();
      const t = await setup();
      await t.profile(ADMIN);
      t.facade.emitCollection('plots', [], { where: coopWhere, fromCache: true });
      t.facade.emitCollection('assessments', [], { fromCache: true });
      t.facade.emitCollection('persons', [], { fromCache: true });
      t.facade.emitCollection('titles', [], { fromCache: true });
      await settle(t.fixture);
      expect(t.q('#coop-loading')).not.toBeNull();
      expect(t.q('#empty-coop')).toBeNull();

      vi.advanceTimersByTime(10_000);
      await settle(t.fixture);
      expect(t.q('#coop-offline')?.textContent).toContain('Tiada sambungan');

      await t.click('#coop-retry');
      expect(t.facade.collections.filter((w) => w.path === 'plots').length).toBe(2);
      expect(t.facade.activeCollections('plots')).toHaveLength(1);
      expect(t.facade.activeCollections('assessments')).toHaveLength(1);
      await t.data();
      expect(t.q('#coop-offline')).toBeNull();
      expect(t.q('.coop-stats')).not.toBeNull();
    });

    it('档案本身没读到（离线）：「Cuba lagi」只重试档案；数据订阅此时一个都没开，不会被乱动', async () => {
      vi.useFakeTimers();
      const t = await setup();
      t.facade.emitDoc('users/u1', null, true); // 缓存里的空档案：不下结论，等服务器
      await settle(t.fixture);
      vi.advanceTimersByTime(10_000);
      await settle(t.fixture);
      expect(t.q('#coop-offline')).not.toBeNull();

      await t.click('#coop-retry');
      expect(t.facade.docs.filter((w) => w.path === 'users/u1')).toHaveLength(2);
      expect(t.facade.activeDocs('users/u1')).toHaveLength(1);
      expect(t.facade.activeCollections('plots')).toHaveLength(0);
      await t.ready();
      expect(t.q('.coop-stats')).not.toBeNull();
    });

    it('档案读到了、是数据订阅出错：重试不碰档案订阅（不会让 coopId 暂时为空把好的订阅拆掉）', async () => {
      const t = await setup();
      await t.profile(ADMIN);
      t.facade.emitCollection('plots', PLOTS, { where: coopWhere });
      t.facade.failCollection('assessments');
      await settle(t.fixture);
      const before = t.facade.docs.filter((w) => w.path === 'users/u1').length;
      await t.click('#coop-retry');
      expect(t.facade.docs.filter((w) => w.path === 'users/u1')).toHaveLength(before);
      expect(t.facade.collections.filter((w) => w.path === 'plots').length).toBe(2);
    });

    it('任一订阅出错（如权限被拒）：错误提示＋重试，不显示残缺数据', async () => {
      const t = await setup();
      await t.profile(ADMIN);
      t.facade.emitCollection('plots', PLOTS, { where: coopWhere });
      t.facade.failCollection('assessments');
      await settle(t.fixture);
      expect(t.q('#coop-error')?.textContent).toContain('Tidak dapat memuat');
      expect(t.q('.coop-stats')).toBeNull();
      expect(t.q('#coop-retry')).not.toBeNull();
    });

    it('服务器确认合作社真的没有地块：「Belum ada tanah dalam koperasi ini.」，导出禁用', async () => {
      const t = await setup();
      await t.profile(ADMIN);
      await t.data({ plots: [], assessments: [] });
      expect(t.q('#empty-coop')?.textContent).toContain('Belum ada tanah dalam koperasi ini.');
      expect((t.q('#export-csv') as HTMLButtonElement).disabled).toBe(true);
    });

    it('数据来自缓存：照常显示，并带「simpanan setempat」提示（电脑上不说「手机」）', async () => {
      const t = await setup();
      await t.profile(ADMIN);
      t.facade.emitCollection('plots', PLOTS, { where: coopWhere, fromCache: true });
      t.facade.emitCollection('assessments', ASSESSMENTS, { fromCache: true });
      t.facade.emitCollection('persons', PERSONS);
      t.facade.emitCollection('titles', TITLES);
      await settle(t.fixture);
      expect(t.q('#coop-cached')?.textContent).toContain('simpanan setempat');
      expect(t.q('#coop-cached')?.textContent).not.toContain('telefon');
      expect(t.all('.coop-row')).toHaveLength(5);
    });

    it('离开页面后全部监听取消', async () => {
      const t = await setup();
      await t.ready();
      expect(t.facade.activeCount).toBeGreaterThanOrEqual(6);
      t.fixture.destroy();
      expect(t.facade.activeCount).toBe(0);
    });
  });

  describe('统计与表格', () => {
    it('四张统计卡＋左栏状态计数：恒为全合作社，各桶之和＝总数；评估是别的合作社的不算', async () => {
      const t = await setup();
      await t.ready();
      const stat = (k: string) => t.q(`#stat-${k} .coop-stat__count`)?.textContent;
      expect([stat('green'), stat('yellow'), stat('red'), stat('needs_review')]).toEqual([
        '1',
        '1',
        '1',
        '1',
      ]);
      expect(t.q('#filter-all .coop-filter__count')?.textContent).toBe('5');
      const counts = ['red', 'needs_review', 'yellow', 'pending', 'green'].map(
        (k) => t.q(`#filter-${k} .coop-filter__count`)?.textContent,
      );
      expect(counts).toEqual(['1', '1', '1', '1', '1']);
      expect(t.q('#filter-running')).toBeNull(); // 没有数量的桶不列
      expect(t.q('#coop-name')?.textContent).toBe('Koperasi Contoh');
      expect(t.q('#coop-role')?.textContent).toBe('pentadbir');
    });

    it('统计卡：颜色＋图标＋文字', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#stat-red')?.className).toContain('tone-bad');
      expect(t.q('#stat-red .coop-stat__label')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        '✕ Perlu tindakan',
      );
      expect(t.q('#stat-green .coop-stat__label')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        '✓ Lengkap',
      );
    });

    it('红色最前：red → needs_review → yellow → pending → green；列与内容', async () => {
      const t = await setup();
      await t.ready();
      expect(t.ids()).toEqual(['p2', 'p4', 'p1', 'p5', 'p3']);
      const rows = t.rows();
      expect(rows[0]).toEqual([
        'Lot 1234, Kluang',
        'Muthu a/l Raman',
        '✕Perlu tindakan',
        'Lesen MPOB sudah tamat (+1)',
        '8 Okt',
      ]);
      expect(rows[2]).toEqual([
        'Lot 507, Kampar',
        'Ahmad Zaki bin Rosli',
        '⚠Perlu semakan',
        'Keluasan tidak sepadan (+1)',
        '3 Okt',
      ]);
      // 没有评估：Belum mula，主问题为 —；没有地契：Lot baharu
      expect(rows[3]).toEqual(['Lot baharu', expect.any(String), '○Belum mula', '—', '1 Okt']);
      expect(t.q('#row-count')?.textContent?.trim()).toBe('5 / 5 tanah');
    });

    it('表头用 <th scope="col">，表格是原生 <table>', async () => {
      const t = await setup();
      await t.ready();
      const heads = t.all('#coop-table thead th');
      expect(heads.map((h) => h.textContent?.trim())).toEqual([
        'Tanah',
        'Ahli',
        'Status',
        'Masalah utama',
        'Dikemas kini',
      ]);
      for (const h of heads) expect(h.getAttribute('scope')).toBe('col');
    });

    it('成员名读不到：显示 —，也不泄露 id', async () => {
      const t = await setup();
      await t.ready();
      await t.data({ persons: PERSONS.filter((p) => p.id !== 'pe3') });
      const p3 = t.q('[data-plot-id="p3"]')!;
      expect(p3.querySelectorAll('td')[1].textContent?.trim()).toBe('—');
      expect(t.text()).not.toContain('pe3');
    });
  });

  describe('筛选', () => {
    it('点状态：地址带 ?status=，表格只剩该桶；计数和统计卡不变；选中项有 aria-pressed', async () => {
      const t = await setup();
      await t.ready();
      await t.click('#filter-red');
      expect(t.router.url).toBe('/coop?status=red');
      expect(t.ids()).toEqual(['p2']);
      expect(t.q('#row-count')?.textContent?.trim()).toBe('1 / 5 tanah');
      expect(t.q('#filter-red')?.getAttribute('aria-pressed')).toBe('true');
      expect(t.q('#filter-all')?.getAttribute('aria-pressed')).toBe('false');
      expect(t.q('#stat-green .coop-stat__count')?.textContent).toBe('1');
      expect(t.q('#filter-yellow .coop-filter__count')?.textContent).toBe('1');

      await t.click('#filter-all');
      expect(t.ids()).toHaveLength(5);
      expect(t.router.url).toBe('/coop');
    });

    it('问题类型多选：同类 OR；再点取消；只列有数量的类型', async () => {
      const t = await setup();
      await t.ready();
      expect(t.all('[id^="issue-"]').map((b) => b.id)).toEqual([
        'issue-area',
        'issue-expiry',
        'issue-name',
        'issue-unclear',
        'issue-forest',
      ]);
      await t.click('#issue-area');
      expect(t.ids()).toEqual(['p1']);
      await t.click('#issue-forest');
      expect(t.router.url).toBe('/coop?issue=area,forest');
      expect(t.ids().sort()).toEqual(['p1', 'p2']);
      expect(t.q('#issue-area')?.getAttribute('aria-pressed')).toBe('true');

      await t.click('#issue-area');
      expect(t.ids()).toEqual(['p2']);
    });

    it('成员搜索：输入即过滤，写进地址（用替换历史）；忽略大小写与标点；也搜不到成员名读不到的', async () => {
      const t = await setup();
      await t.ready();
      const nav = vi.spyOn(t.router, 'navigate');
      await t.type('a/l raman');
      expect(t.ids()).toEqual(['p2']);
      expect(t.router.url).toBe('/coop?q=a%2Fl%20raman');
      expect(nav.mock.calls.at(-1)?.[1]).toMatchObject({ replaceUrl: true });

      await t.type('nobody');
      expect(t.q('#empty-filter')?.textContent).toContain('Tiada tanah sepadan dengan penapis.');
    });

    it('三类条件 AND；零结果有空状态，「Kosongkan penapis」清掉全部条件', async () => {
      const t = await setup();
      await t.ready();
      await t.click('#filter-red');
      await t.click('#issue-area'); // 红色里没有面积问题
      expect(t.all('.coop-row')).toHaveLength(0);
      expect(t.q('#empty-filter')).not.toBeNull();
      expect(t.q('#coop-table')).toBeNull();
      expect((t.q('#export-csv') as HTMLButtonElement).disabled).toBe(true);

      await t.click('#empty-clear');
      expect(t.router.url).toBe('/coop');
      expect(t.ids()).toHaveLength(5);
      expect(t.q('#clear-filters')).toBeNull();
    });

    it('带参数直接打开（刷新）：筛选与选中都保持；非法参数忽略', async () => {
      const t = await setup({ url: '/coop?status=red&issue=forest,bogus&q=muthu&plot=p2' });
      await t.ready();
      expect(t.ids()).toEqual(['p2']);
      expect(t.q('#filter-red')?.getAttribute('aria-pressed')).toBe('true');
      expect(t.q('#issue-forest')?.getAttribute('aria-pressed')).toBe('true');
      expect((t.q('#coop-q') as HTMLInputElement).value).toBe('muthu');
      expect(t.q('#detail-title')?.textContent).toContain('Lot 1234, Kluang');
    });

    it('非法的查询参数（未知状态、未知类别）被忽略，当作没有筛选', async () => {
      const t = await setup({ url: '/coop?status=purple&issue=zzz' });
      await t.ready();
      expect(t.ids()).toHaveLength(5);
      expect(t.q('#filter-all')?.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('右栏详情', () => {
    it('没选中：提示；选中：标题「Lot · 成员名」、状态、全部未解决缺口、森林初筛、评估日期、形状预览', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#detail-choose')?.textContent).toContain('Pilih tanah untuk melihat butiran.');

      await t.click('[data-plot-id="p2"] .coop-plotbtn');
      expect(t.router.url).toBe('/coop?plot=p2');
      expect(t.q('#detail-title')?.textContent).toBe('Lot 1234, Kluang · Muthu a/l Raman');
      expect(t.q('#detail .chip')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        '✕Perlu tindakan',
      );
      const issues = t
        .all('#detail-issues li')
        .map((li) => li.querySelector('strong')?.textContent);
      expect(issues).toEqual(['Lesen MPOB sudah tamat', 'Nama pada Geran tanah tidak sepadan']);
      expect(t.q('#detail-issues li span')?.textContent).toBe('Tamat pada 30 Apr 2026.');
      expect(t.q('#detail-forest')?.textContent).toContain(
        'ada tanda kehilangan hutan selepas 2020 (0.8 ha)',
      );
      expect(t.q('#detail-forest')?.textContent).toContain('Ini saringan awal sahaja.');
      expect(t.q('#detail-checked')?.textContent).toBe('Disemak pada 8 Okt');
      const shape = t.q('#detail-shape')!;
      expect(shape.getAttribute('role')).toBe('img');
      expect(shape.querySelector('polygon')?.getAttribute('points')?.split(' ')).toHaveLength(4);
      expect(t.q('#detail .hint')).not.toBeNull();
      expect(t.text()).toContain('Gambaran kasar, bukan peta satelit');
    });

    it('点行（整行）也能选中；选中的行／按钮带 aria-current 与非颜色的标记；再选另一块自动换', async () => {
      const t = await setup();
      await t.ready();
      (t.q('[data-plot-id="p1"] td:nth-child(2)') as HTMLElement).click();
      await settle(t.fixture);
      expect(t.router.url).toBe('/coop?plot=p1');
      expect(t.q('[data-plot-id="p1"]')?.className).toContain('coop-row--on');
      expect(t.q('[data-plot-id="p1"] .coop-plotbtn')?.getAttribute('aria-current')).toBe('true');
      expect(t.q('[data-plot-id="p2"] .coop-plotbtn')?.getAttribute('aria-current')).toBeNull();

      await t.click('[data-plot-id="p3"] .coop-plotbtn');
      expect(t.q('#detail-title')?.textContent).toContain('Lot baharu');
      expect(t.q('[data-plot-id="p1"]')?.className).not.toContain('coop-row--on');
    });

    it('键盘：行内的按钮可聚焦，Enter／Space 触发的 click 选中', async () => {
      const t = await setup();
      await t.ready();
      const btn = t.q('[data-plot-id="p4"] .coop-plotbtn') as HTMLButtonElement;
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
      btn.focus();
      expect(document.activeElement).toBe(btn);
    });

    it('没有评估：一句话「Tanah ini belum diperiksa.」，不列缺口、不写森林初筛；没有多边形不显示预览', async () => {
      const t = await setup({ url: '/coop?plot=p5' });
      await t.ready();
      expect(t.q('#detail-note')?.textContent).toBe('Tanah ini belum diperiksa.');
      expect(t.q('h1')?.textContent).toBe('Papan pemuka koperasi'); // 页面有标题（屏幕阅读器用）
      expect(t.q('main.coop')).not.toBeNull();
      expect(t.q('#detail-issues')).toBeNull();
      expect(t.q('#detail-forest')).toBeNull();
      expect(t.q('#detail-shape')).toBeNull();
    });

    it('已有评估但没有缺口：「Tiada masalah yang belum selesai.」', async () => {
      const t = await setup({ url: '/coop?plot=p3' });
      await t.ready();
      expect(t.q('#detail-no-issues')?.textContent).toContain('Tiada masalah yang belum selesai.');
    });

    it('选中项被筛掉了：右栏仍显示，并标注「Tidak dalam penapis semasa」', async () => {
      const t = await setup({ url: '/coop?plot=p1' });
      await t.ready();
      expect(t.q('#detail-not-in-filter')).toBeNull();
      await t.click('#filter-red');
      expect(t.ids()).toEqual(['p2']);
      expect(t.q('#detail-title')?.textContent).toContain('Lot 507');
      expect(t.q('#detail-not-in-filter')?.textContent).toContain('Tidak dalam penapis semasa');
    });

    it('?plot= 指向本合作社没有的地块：「Tanah ini tidak dijumpai.」，不崩', async () => {
      const t = await setup({ url: '/coop?plot=someone-elses-plot' });
      await t.ready();
      expect(t.q('#detail-notfound')?.textContent).toContain('Tanah ini tidak dijumpai.');
      expect(t.all('.coop-row')).toHaveLength(5);
    });

    it('「Buka keputusan penuh」进屏 9', async () => {
      const t = await setup({ url: '/coop?plot=p1' });
      await t.ready();
      await t.click('#open-result');
      expect(t.router.url).toBe('/plots/p1');
    });

    it('实时更新：评估变了，表格与右栏跟着变，选中项保持', async () => {
      const t = await setup({ url: '/coop?plot=p1' });
      await t.ready();
      expect(t.all('#detail-issues li')).toHaveLength(2);
      await t.data({
        assessments: ASSESSMENTS.map((a) =>
          a.id === 'a1'
            ? {
                ...a,
                data: assessmentDoc('p1', {
                  result: 'red',
                  gaps: [gap('missing_doc', 'high', 'mpob_licence')],
                }),
              }
            : a,
        ),
      });
      expect(t.q('#detail-title')?.textContent).toContain('Lot 507');
      expect(
        t.all('#detail-issues li').map((li) => li.querySelector('strong')?.textContent),
      ).toEqual(['Lesen MPOB tiada']);
      expect(t.ids()[0]).toBe('p2'); // 仍按桶排序：两块红，按时间新→旧
      expect(t.ids()).toContain('p1');
      expect(t.router.url).toBe('/coop?plot=p1');
    });
  });

  describe('导出 CSV', () => {
    let blobs: Blob[];
    let clicks: { download: string }[];
    // FileReader.readAsText 会吃掉 UTF-8 的 BOM：读字节，再用 ignoreBOM 解码，才看得到文件开头的 BOM
    const read = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () =>
          resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(r.result as ArrayBuffer));
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(blob);
      });

    beforeEach(() => {
      blobs = [];
      clicks = [];
      URL.createObjectURL = vi.fn((b: Blob) => {
        blobs.push(b);
        return 'blob:test/csv';
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clicks.push({ download: this.download });
      });
    });

    it('导出当前筛选后的表格：表头、行数、列；文件名带日期；不含证件信息、评估说明、id', async () => {
      const t = await setup();
      await t.ready();
      await t.click('#filter-red');
      await t.click('#export-csv');
      expect(blobs).toHaveLength(1);
      expect(clicks[0].download).toMatch(/^kebunsah-ringkasan-\d{4}-\d{2}-\d{2}\.csv$/);
      const csv = await read(blobs[0]);
      expect(csv.startsWith('﻿')).toBe(true);
      const lines = csv.replace('﻿', '').trim().split('\r\n');
      expect(lines).toEqual([
        'Tanah,Daerah,Ahli,Status,Masalah utama,Dikemas kini',
        '"Lot 1234, Kluang",Kluang,Muthu a/l Raman,Perlu tindakan,Lesen MPOB sudah tamat (+1),2026-10-08',
      ]);
      expect(csv).not.toMatch(
        /HASH-SECRET|icLast4|7311|7322|7333|7344|p2|expired|RAMAN A\/L SUBRAMANIAM/,
      );
      expect(csv).not.toMatch(CJK);
    });

    it('没有筛选：导出全部；成员名以 = 开头的单元防公式注入', async () => {
      const t = await setup();
      await t.ready();
      await t.click('#export-csv');
      const csv = await read(blobs[0]);
      const lines = csv.replace('﻿', '').trim().split('\r\n');
      expect(lines).toHaveLength(6);
      const evil = lines.find((l) => l.includes('Calc'))!;
      // 以 = 开头：前面加 '；值里没有逗号、引号、换行，所以不必再加引号
      expect(evil).toContain(",'=Cmd|' /C Calc'!A0,");
      expect(evil.startsWith("Lot baharu,Kampar,'=")).toBe(true);
    });

    it('表头和状态按界面语言：英语', async () => {
      const t = await setup();
      await t.ready('en');
      await t.click('#export-csv');
      const csv = await read(blobs[0]);
      expect(csv.split('\r\n')[0]).toBe('﻿Plot,District,Member,Status,Main issue,Updated');
      expect(csv).toContain('Action needed');
    });

    it('零行时按钮禁用，点也不导出', async () => {
      const t = await setup();
      await t.ready();
      await t.type('nobody');
      const btn = t.q('#export-csv') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      btn.click();
      expect(blobs).toHaveLength(0);
    });

    it('「Export dossier (PDF)」禁用并写明「Akan datang」；没有「Override as pass」', async () => {
      const t = await setup();
      await t.ready();
      const pdf = t.q('#export-pdf') as HTMLButtonElement;
      expect(pdf.disabled).toBe(true);
      expect(pdf.getAttribute('aria-describedby')).toBe('export-pdf-note');
      expect(t.q('#export-pdf-note')?.textContent).toContain('Akan datang');
      expect(t.text()).not.toMatch(/override/i);
    });
  });

  describe('隐私、语言、登出', () => {
    it('页面上没有中文占位、第三人姓名、摘要、规则详情、证件信息', async () => {
      const t = await setup({ url: '/coop?plot=p2' });
      await t.ready();
      await t.click('[data-plot-id="p1"] .coop-plotbtn');
      const text = t.text();
      expect(text).not.toMatch(CJK);
      expect(text).not.toMatch(
        /SUBRAMANIAM|INTERNAL-SUMMARY|DETAIL RAMAN|HASH-SECRET|7311|7322|7333|7344/,
      );
      expect(text).not.toContain('已故');
    });

    it('管理员档案语言是 en 且本机没选过：默认英语；点 BM 切到马来语', async () => {
      const t = await setup();
      await t.ready('en');
      expect(t.q('#filter-all')?.textContent).toContain('All plots');
      expect(t.q('#coop-table th')?.textContent?.trim()).toBe('Plot');
      expect(t.q('#stat-red .coop-stat__label')?.textContent).toContain('Action needed');
      expect(t.rows()[0][3]).toBe('MPOB licence has expired (+1)');
      expect(t.q('#export-csv')?.textContent?.trim()).toBe('Export summary (CSV)');

      t.i18n.set('ms');
      await settle(t.fixture);
      expect(t.q('#filter-all')?.textContent).toContain('Semua tanah');
      expect(t.rows()[0][3]).toBe('Lesen MPOB sudah tamat (+1)');
    });

    it('登出成功：回 /login', async () => {
      const t = await setup();
      await t.ready();
      await t.click('#logout');
      expect(t.auth.signOut).toHaveBeenCalled();
      expect(t.router.url).toBe('/login');
    });

    it('登出失败：恢复内容并提示，不留空白页', async () => {
      const t = await setup({ signOut: () => Promise.reject(new Error('x')) });
      await t.ready();
      await t.click('#logout');
      await settle(t.fixture);
      expect(t.q('#logout-error')).not.toBeNull();
      expect(t.q('.coop-layout')).not.toBeNull();
    });

    it('会话失效（没有用户了）：回登录页', async () => {
      const t = await setup({ user: false });
      await settle(t.fixture);
      expect(t.router.url).toBe('/login');
    });
  });
});
