import { Component, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { ApiError, ApiService } from '../../core/api/api.service';
import { stubHistory } from '../../../testing/back';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import { assessment, CJK, gap, plot } from '../../../testing/assessment-fixtures';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { ResultPage } from './result-page';

@Component({ template: '' })
class Blank {}

async function setup(url = '/plots/p1', extra: Provider[] = []) {
  const facade = new FakeFacade();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'plots/:id', component: ResultPage },
        { path: 'plots/:id/issue/:key', component: Blank },
        { path: 'plots/:id/checking', component: Blank },
      ]),
      { provide: FIRESTORE_FACADE, useValue: facade },
      ...extra,
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, ResultPage);
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
    plot: async (data: Record<string, unknown> | null, fromCache = false) => {
      facade.emitDoc('plots/p1', data, fromCache);
      await settle(fixture);
    },
    title: async (data: Record<string, unknown> | null) => {
      facade.emitDoc('titles/t1', data);
      await settle(fixture);
    },
    assessments: async (
      docs: { id: string; data: Record<string, unknown> }[],
      fromCache = false,
    ) => {
      facade.emitCollection('plots/p1/assessments', docs, { fromCache });
      await settle(fixture);
    },
    /** 常用组合：地块＋一条评估，都是服务器确认的 */
    ready: async (
      a: Record<string, unknown> = assessment(),
      p: Record<string, unknown> = plot(),
    ) => {
      facade.emitDoc('plots/p1', p);
      facade.emitDoc('titles/t1', { lotNo: '1052', district: 'Kampar' });
      facade.emitCollection('plots/p1/assessments', [{ id: 'a1', data: a }]);
      await settle(fixture);
    },
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
  };
  return api;
}

describe('ResultPage（屏 9）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('读取之前与失败', () => {
    it('读到之前显示骨架，没有横幅，也不下任何结论', async () => {
      const t = await setup();
      expect(t.q('#loading')).not.toBeNull();
      expect(t.q('#banner')).toBeNull();
      expect(t.text()).not.toContain('Belum mula');
      expect(t.q('h1')?.textContent).toContain('Keputusan');
    });

    it('地块文档服务器确认不存在：说明＋回屏 2 的按钮；缓存里的「不存在」不下结论', async () => {
      const t = await setup('/plots/p1?member=m9');
      await t.plot(null, true);
      expect(t.q('#not-found')).toBeNull();
      expect(t.q('#loading')).not.toBeNull();

      await t.plot(null, false);
      expect(t.q('#not-found')?.textContent).toContain('Tanah ini tidak dijumpai');
      await t.click('#back-to-list');
      expect(t.router.url).toBe('/?member=m9');
    });

    it('评估子集合在缓存里是空的：不能当成「没有评估」，先加载', async () => {
      const t = await setup();
      await t.plot(plot());
      await t.assessments([], true);
      expect(t.q('#loading')).not.toBeNull();
      expect(t.q('#banner')).toBeNull();
      expect(t.text()).not.toContain('Belum mula');

      await t.assessments([], false); // 服务器确认：真的没有
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('pending');
    });

    it('10 秒没被服务器确认：转离线提示；点「Cuba lagi」重新订阅两个来源；快照到了恢复', async () => {
      vi.useFakeTimers();
      const t = await setup();
      await t.plot(plot(), true);
      await t.assessments([], true);
      vi.advanceTimersByTime(10_000);
      await settle(t.fixture);
      expect(t.q('#offline')?.textContent).toContain('Tiada sambungan');

      await t.click('#retry');
      expect(t.facade.docs.filter((w) => w.path === 'plots/p1').length).toBe(2);
      expect(t.facade.collections.filter((w) => w.path === 'plots/p1/assessments').length).toBe(2);
      expect(t.facade.activeDocs('plots/p1').length).toBe(1);
      expect(t.facade.activeCollections('plots/p1/assessments').length).toBe(1);

      await t.ready();
      expect(t.q('#offline')).toBeNull();
      expect(t.q('#banner')).not.toBeNull();
    });

    it('监听出错（如权限被拒）：错误与重试，不显示结论', async () => {
      const t = await setup();
      await t.plot(plot());
      t.facade.failCollection('plots/p1/assessments');
      await settle(t.fixture);
      expect(t.q('#error')?.textContent).toContain('Tidak dapat memuat');
      expect(t.q('#retry')).not.toBeNull();
      expect(t.q('#banner')).toBeNull();
    });

    it('出错后点「Cuba lagi」：两个订阅重新订阅，快照到了恢复', async () => {
      const t = await setup();
      await t.plot(plot());
      t.facade.failCollection('plots/p1/assessments');
      await settle(t.fixture);
      expect(t.q('#error')).not.toBeNull();

      await t.click('#retry');
      expect(t.facade.collections.filter((w) => w.path === 'plots/p1/assessments').length).toBe(2);
      expect(t.facade.activeCollections('plots/p1/assessments').length).toBe(1);
      expect(t.facade.activeDocs('plots/p1').length).toBe(1);

      await t.ready();
      expect(t.q('#error')).toBeNull();
      expect(t.q('#banner')).not.toBeNull();
    });

    it('缓存里有数据：照常显示，并带「Disimpan di telefon」提示', async () => {
      const t = await setup();
      await t.plot(plot(), true);
      await t.assessments([{ id: 'a1', data: assessment() }], true);
      expect(t.q('#banner')).not.toBeNull();
      expect(t.q('#cached')?.textContent).toContain('Disimpan di telefon');
    });
  });

  describe('结论横幅', () => {
    it('yellow：Hampir siap ＋「2 perkara…」＋评估日期；颜色＋图标＋文字', async () => {
      const t = await setup();
      await t.ready();
      const banner = t.q('#banner')!;
      expect(banner.getAttribute('data-banner')).toBe('yellow');
      expect(banner.className).toContain('tone-warn');
      expect(banner.querySelector('.banner__icon')?.textContent).toBe('⚠');
      expect(banner.querySelector('h2')?.textContent).toBe('Hampir siap');
      expect(banner.textContent).toContain('2 perkara perlu dibuat sebelum dokumen anda lengkap.');
      expect(t.q('#checked-on')?.textContent).toBe('Disemak pada 3 Okt');
    });

    it('green：Semua lulus，没有「Perlu dibuat」，不写「0 perkara」，也不声称合规', async () => {
      const t = await setup();
      await t.ready(assessment({ result: 'green', gaps: [] }), plot({ status: 'green' }));
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('green');
      expect(t.q('#banner')?.className).toContain('tone-ok');
      expect(t.q('#banner h2')?.textContent).toBe('Semua lulus');
      expect(t.q('#gap-list')).toBeNull();
      expect(t.text()).not.toContain('Perlu dibuat');
      expect(t.text()).not.toMatch(/0 perkara/);
      expect(t.text()).not.toMatch(/EUDR|patuh|compliant/i);
    });

    it('red：Perlu tindakan，不用「gagal」', async () => {
      const t = await setup();
      await t.ready(assessment({ result: 'red', gaps: [gap('expired', 'high', 'mpob_licence')] }));
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('red');
      expect(t.q('#banner')?.className).toContain('tone-bad');
      expect(t.q('#banner h2')?.textContent).toBe('Perlu tindakan');
      expect(t.text()).not.toMatch(/gagal/i);
    });

    it('needs_review：Menunggu semakan pegawai；失败的评估也按它处理，且不显示 errorMessage', async () => {
      const t = await setup();
      await t.ready(assessment({ result: 'needs_review', gaps: [] }));
      expect(t.q('#banner h2')?.textContent).toBe('Menunggu semakan pegawai');

      await t.assessments([
        {
          id: 'a1',
          data: assessment({
            runStatus: 'failed',
            result: null,
            errorMessage: 'SECRET stack trace',
          }),
        },
      ]);
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('needs_review');
      expect(t.text()).not.toContain('SECRET');
      // 失败的一次不列事项、不写通过项、不写评估日期和森林初筛
      for (const id of ['#gap-list', '#passed-toggle', '#checked-on', '#forest']) {
        expect(t.q(id), id).toBeNull();
      }
    });

    it('没有评估：Belum mula；即使 plots.status 写着 green 也不下结论', async () => {
      const t = await setup();
      await t.plot(plot({ status: 'green' }));
      await t.assessments([], false);
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('pending');
      expect(t.q('#banner h2')?.textContent).toBe('Belum mula');
      expect(t.text()).toContain('Tanah ini belum diperiksa.');
      expect(t.q('#forest')).toBeNull();
      expect(t.q('#checked-on')).toBeNull();
    });

    it('最新一次评估还在跑：Sedang disemak，不拿更早的 done 当当前结论，不列事项、不写森林初筛', async () => {
      const t = await setup();
      await t.plot(plot());
      await t.assessments([
        { id: 'old', data: assessment({ createdAt: new Date('2026-10-01T00:00:00Z') }) },
        {
          id: 'new',
          data: assessment({
            runStatus: 'running',
            result: null,
            createdAt: new Date('2026-10-09T00:00:00Z'),
            finishedAt: null,
          }),
        },
      ]);
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('running');
      expect(t.q('#banner h2')?.textContent).toBe('Sedang disemak');
      expect(t.q('#gap-list')).toBeNull();
      expect(t.q('#forest')).toBeNull();
      expect(t.q('#checked-on')).toBeNull();
    });

    it('多次评估：取最新的一次；result 与 plots.status 不一致时以评估为准', async () => {
      const t = await setup();
      await t.plot(plot({ status: 'red' }));
      await t.assessments([
        {
          id: 'a',
          data: assessment({ result: 'red', createdAt: new Date('2026-09-01T00:00:00Z') }),
        },
        {
          id: 'b',
          data: assessment({
            result: 'green',
            gaps: [],
            createdAt: new Date('2026-10-05T00:00:00Z'),
          }),
        },
      ]);
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('green');
    });

    it('结论与缺口互相矛盾（green 但有 open 缺口，yellow 但没有）：照常显示，不崩', async () => {
      const t = await setup();
      await t.ready(assessment({ result: 'green', gaps: [gap('area_mismatch')] }));
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('green');
      expect(t.all('.gap-card')).toHaveLength(1);

      await t.assessments([{ id: 'a1', data: assessment({ result: 'yellow', gaps: [] }) }]);
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('yellow');
      expect(t.q('#banner')?.textContent).toContain('Beberapa perkara perlu disemak.');
      expect(t.text()).not.toMatch(/0 perkara/);
    });
  });

  describe('「Mulakan semakan」（还没开始的地块）', () => {
    const withApi = (assess: ReturnType<typeof vi.fn>) => [
      { provide: ApiService, useValue: { assess } },
    ];

    it('没有评估：显示按钮；点了触发评估并进屏 7，保留 ?member', async () => {
      const assess = vi.fn(async () => 'a-9');
      const t = await setup('/plots/p1?member=m9', withApi(assess));
      await t.ready(assessment(), plot({ status: 'pending' }));
      await t.assessments([]);
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('pending');
      expect(t.q('#start-check')?.textContent?.trim()).toBe('Mulakan semakan');

      await t.click('#start-check');
      expect(assess).toHaveBeenCalledWith('p1');
      expect(t.router.url).toBe('/plots/p1/checking?member=m9');
    });

    it('已有评估在跑（409）：当作成功，进屏 7', async () => {
      const assess = vi.fn(async () => {
        throw new ApiError(409, 'assessment_in_progress', { assessmentId: 'a-0' });
      });
      const t = await setup('/plots/p1', withApi(assess));
      await t.ready(assessment(), plot({ status: 'pending' }));
      await t.assessments([]);
      await t.click('#start-check');
      expect(t.router.url).toBe('/plots/p1/checking');
    });

    it('触发失败：留在本页，写明原因，按钮还能再点', async () => {
      const assess = vi.fn(async () => {
        throw new ApiError(422, 'geometry_missing');
      });
      const t = await setup('/plots/p1', withApi(assess));
      await t.ready(assessment(), plot({ status: 'pending' }));
      await t.assessments([]);
      await t.click('#start-check');
      expect(t.router.url).toBe('/plots/p1');
      expect(t.q('#start-error')?.getAttribute('role')).toBe('alert');
      expect((t.q('#start-check') as HTMLButtonElement).disabled).toBe(false);
    });

    it('评估在跑、已完成、失败：没有这个按钮', async () => {
      const t = await setup();
      await t.ready(assessment({ runStatus: 'running', result: null }));
      expect(t.q('#start-check')).toBeNull();
      await t.assessments([{ id: 'a1', data: assessment() }]);
      expect(t.q('#start-check')).toBeNull();
    });
  });

  describe('「Lihat kemajuan」入口（屏 7）', () => {
    it('最新一次评估还在跑：横幅下面有「Lihat kemajuan」，点击进屏 7，保留 ?member', async () => {
      const t = await setup('/plots/p1?member=m9');
      await t.ready(assessment({ runStatus: 'running', result: null, finishedAt: null }));
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('running');
      expect(t.q('#see-progress')?.textContent?.trim()).toBe('Lihat kemajuan');

      await t.click('#see-progress');
      expect(t.router.url).toBe('/plots/p1/checking?member=m9');
    });

    it('queued 同样有；已完成、失败、没有评估都没有这个按钮', async () => {
      const t = await setup();
      await t.ready(assessment({ runStatus: 'queued', result: null }));
      expect(t.q('#see-progress')).not.toBeNull();

      await t.assessments([{ id: 'a1', data: assessment() }]);
      expect(t.q('#see-progress')).toBeNull();

      await t.assessments([{ id: 'a1', data: assessment({ runStatus: 'failed', result: null }) }]);
      expect(t.q('#see-progress')).toBeNull();

      await t.assessments([], false);
      expect(t.q('#banner')?.getAttribute('data-banner')).toBe('pending');
      expect(t.q('#see-progress')).toBeNull();
    });
  });

  describe('「Perlu dibuat」列表', () => {
    it('每件事：序号＋标题、一句带数字的详情、且只有一个按钮', async () => {
      const t = await setup();
      await t.ready();
      const cards = t.all('.gap-card');
      expect(cards).toHaveLength(2);
      expect(cards[0].querySelector('h3')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        '1. Keluasan tidak sepadan',
      );
      expect(cards[0].querySelector('.gap-card__detail')?.textContent).toBe(
        'Geran 3.04 ha, lukisan anda 3.49 ha',
      );
      expect(cards[1].querySelector('h3')?.textContent).toContain('Lesen MPOB hampir tamat');
      expect(cards[1].querySelector('.gap-card__detail')?.textContent).toBe('Tamat dalam 58 hari.');
      for (const c of cards) expect(c.querySelectorAll('button')).toHaveLength(1);
      expect(cards[0].querySelector('button')?.textContent?.trim()).toBe('Lihat butiran');
      expect(cards[1].querySelector('button')?.textContent?.trim()).toBe('Cara mendapatkannya');
    });

    it('按轻重排：high 在前，同级保持原顺序', async () => {
      const t = await setup();
      await t.ready(
        assessment({
          gaps: [
            gap('not_in_mspo', 'medium', 'mspo_member_list'),
            gap('expired', 'high', 'mpob_licence'),
            gap('area_mismatch', 'medium'),
          ],
        }),
      );
      const titles = t.all('.gap-card h3').map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
      expect(titles).toEqual([
        '1. Lesen MPOB sudah tamat',
        '2. Tiada dalam senarai ahli MSPO',
        '3. Keluasan tidak sepadan',
      ]);
    });

    it('多于 3 件：先显示 3 件，「Lihat semua (n)」展开，再点收起；按钮带 aria-expanded', async () => {
      const t = await setup();
      await t.ready(
        assessment({
          result: 'yellow',
          gaps: [
            gap('expired', 'high', 'mpob_licence'),
            gap('name_mismatch', 'high', 'land_title'),
            gap('area_mismatch', 'high'),
            gap('not_in_mspo', 'medium', 'mspo_member_list'),
          ],
        }),
      );
      expect(t.all('.gap-card')).toHaveLength(3);
      const toggle = t.q('#toggle-gaps')!;
      expect(toggle.textContent?.trim()).toBe('Lihat semua (4)');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe('gap-list');
      expect(t.q('#banner')?.textContent).toContain('4 perkara'); // 横幅数的是全部，不是显示出来的

      await t.click('#toggle-gaps');
      expect(t.all('.gap-card')).toHaveLength(4);
      expect(t.q('#toggle-gaps')?.textContent?.trim()).toBe('Tunjukkan lebih sedikit');
      expect(t.q('#toggle-gaps')?.getAttribute('aria-expanded')).toBe('true');

      await t.click('#toggle-gaps');
      expect(t.all('.gap-card')).toHaveLength(3);
    });

    it('3 件及以下没有展开按钮', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#toggle-gaps')).toBeNull();
    });

    it('未知 gapCode：通用标题，不显示缺口自带的说明（可能含第三人姓名）', async () => {
      const t = await setup();
      await t.ready(assessment({ gaps: [gap('brand_new_code', 'medium')] }));
      expect(t.q('.gap-card h3')?.textContent).toContain('Perkara perlu disemak');
      expect(t.q('.gap-card__detail')?.textContent).toBe(
        'Perkara ini perlu disemak oleh pegawai koperasi.',
      );
      expect(t.text()).not.toContain('RAMAN');
      expect(t.text()).not.toContain('brand_new_code');
    });

    it('同 gapCode 不同文件：分成两项，标题带文件名', async () => {
      const t = await setup();
      await t.ready(
        assessment({
          result: 'needs_review',
          gaps: [
            gap('low_confidence', 'medium', 'land_title'),
            gap('low_confidence', 'medium', 'mpob_licence'),
          ],
        }),
      );
      const titles = t.all('.gap-card h3').map((h) => h.textContent);
      expect(titles).toHaveLength(2);
      expect(titles[0]).toContain('geran tanah');
      expect(titles[1]).toContain('lesen MPOB');
    });

    it('已解决（status 不是 open）的缺口不列', async () => {
      const t = await setup();
      await t.ready(
        assessment({
          gaps: [
            { ...gap('area_mismatch'), status: 'closed' },
            gap('expiring', 'medium', 'mpob_licence'),
          ],
        }),
      );
      expect(t.all('.gap-card')).toHaveLength(1);
    });

    it('点按钮进入该事项的屏 10，保留 ?member', async () => {
      const t = await setup('/plots/p1?member=m9');
      await t.ready();
      await t.click('#gap-0');
      expect(t.router.url).toBe('/plots/p1/issue/area_mismatch?member=m9');
    });
  });

  describe('通过的检查与森林初筛', () => {
    it('「1 semakan lulus」默认收起；点开列出规则名与 ✓，再点收起；有 aria-expanded', async () => {
      const t = await setup();
      await t.ready();
      const toggle = t.q('#passed-toggle')!;
      expect(toggle.textContent).toContain('1 semakan lulus');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(t.q('#passed-list')).toBeNull();

      await t.click('#passed-toggle');
      expect(t.q('#passed-toggle')?.getAttribute('aria-expanded')).toBe('true');
      expect(t.q('#passed-list')?.textContent).toContain('Nama pemilik sepadan');
      expect(t.q('#passed-list')?.textContent).toContain('✓');

      await t.click('#passed-toggle');
      expect(t.q('#passed-list')).toBeNull();
    });

    it('没有通过的检查：不显示这一行', async () => {
      const t = await setup();
      await t.ready(assessment({ ruleResults: [{ ruleCode: 'CC-01', result: 'fail' }] }));
      expect(t.q('#passed-toggle')).toBeNull();
    });

    it('森林初筛：low 且损失为 0 → 没有损失；永远带「Ini saringan awal sahaja.」', async () => {
      const t = await setup();
      await t.ready();
      expect(t.q('#forest')?.textContent).toContain('tiada kehilangan hutan dikesan');
      expect(t.q('#forest')?.textContent).toContain('Ini saringan awal sahaja.');
    });

    it('森林初筛：medium／high 写有损失与公顷数，并说明由官员复核；不出现「tiada kehilangan」', async () => {
      const t = await setup();
      await t.ready(assessment({ forestRisk: 'medium', forestLossAfter2020Ha: 0.45 }));
      const text = t.q('#forest')!.textContent!;
      expect(text).toContain('ada tanda kehilangan hutan selepas 2020 (0.45 ha)');
      expect(text).toContain('Pegawai akan menyemak');
      expect(text).not.toContain('tiada kehilangan');
      expect(text).toContain('Ini saringan awal sahaja.');
    });

    it('森林初筛：风险 low 但损失 > 0（数据矛盾）也按有损失处理', async () => {
      const t = await setup();
      await t.ready(assessment({ forestRisk: 'low', forestLossAfter2020Ha: 0.3 }));
      expect(t.q('#forest')?.textContent).toContain('ada tanda kehilangan hutan');
      expect(t.q('#forest')?.textContent).not.toContain('tiada kehilangan');
    });

    it('森林初筛：unknown／缺失不当成 0，写「belum dapat disemak」', async () => {
      const t = await setup();
      await t.ready(assessment({ forestRisk: 'unknown', forestLossAfter2020Ha: null }));
      expect(t.q('#forest')?.textContent).toContain('belum dapat disemak');
      expect(t.q('#forest')?.textContent).not.toContain('tiada kehilangan');
    });
  });

  describe('头部与隐私', () => {
    it('头部写地块标题（规则同屏 2）和面积；title 没读到前是骨架，读不到回退', async () => {
      const t = await setup();
      await t.plot(plot());
      await t.assessments([{ id: 'a1', data: assessment() }]);
      expect(t.q('#plot-title')).toBeNull(); // title 还在读：骨架
      expect(t.q('.plot-line .skeleton')).not.toBeNull();

      await t.title({ lotNo: '1052', district: 'Kampar' });
      expect(t.q('#plot-title')?.textContent).toBe('Lot 1052, Kampar');
      expect(t.q('.plot-line__meta')?.textContent).toBe('3.49 ha · 3 Okt');
    });

    it('没有地契：Lot baharu', async () => {
      const t = await setup();
      await t.plot(plot({ landTitleId: null, areaHaComputed: null }));
      await t.assessments([], false);
      expect(t.q('#plot-title')?.textContent).toBe('Lot baharu');
      expect(t.q('.plot-line__meta')?.textContent).toBe('Belum diisi · 3 Okt');
    });

    it('页面上没有中文占位、第三人姓名、摘要、内部字段', async () => {
      const t = await setup();
      await t.ready(
        assessment({
          result: 'red',
          gaps: [
            gap('name_mismatch', 'high', 'land_title'),
            gap('expiring', 'medium', 'mpob_licence'),
            gap('foo'),
          ],
        }),
      );
      await t.click('#passed-toggle');
      const text = t.text();
      expect(text).not.toMatch(CJK);
      expect(text).not.toContain('RAMAN');
      expect(text).not.toContain('INTERNAL-SUMMARY');
      expect(text).not.toContain('SUBRAMANIAM');
      expect(text).not.toContain('已故');
      expect(text).not.toMatch(/SECRET|DOC-/); // evidence、modelVersion、rulesVersion、inputSnapshot、citation
    });
  });

  describe('语言与导航', () => {
    it('切到英语：横幅、事项、通过行、森林初筛都变，月份缩写也变', async () => {
      const t = await setup();
      await t.ready();
      t.i18n.set('en');
      await settle(t.fixture);
      expect(t.q('h1')?.textContent).toContain('Result');
      expect(t.q('#banner h2')?.textContent).toBe('Almost there');
      expect(t.q('#banner')?.textContent).toContain('2 things need doing');
      expect(t.q('#checked-on')?.textContent).toBe('Checked on 3 Oct');
      expect(t.q('.gap-card h3')?.textContent).toContain("The areas don't match");
      expect(t.q('.gap-card__detail')?.textContent).toBe('Title 3.04 ha, your drawing 3.49 ha');
      expect(t.q('#passed-toggle')?.textContent).toContain('1 check passed');
      expect(t.q('#forest')?.textContent).toContain('no forest loss detected');
      expect(t.text()).not.toContain('Keputusan');
    });

    it('返回箭头回屏 2，保留 ?member', async () => {
      const t = await setup('/plots/p1?member=m9');
      await t.ready();
      await t.click('#back');
      expect(t.router.url).toBe('/?member=m9');
    });

    it('返回箭头：有历史就后退（管理员从看板进来回到看板，筛选与选中的地块都在），不再导航', async () => {
      const t = await setup('/plots/p1?member=m9');
      await t.ready();
      const back = stubHistory(true);
      await t.click('#back');
      expect(back).toHaveBeenCalledTimes(1);
      expect(t.router.url).toBe('/plots/p1?member=m9');
    });

    it('离开页面后三个监听（地块、评估、地契）全部取消', async () => {
      const t = await setup();
      await t.ready();
      expect(t.facade.activeCount).toBe(3);
      t.fixture.destroy();
      expect(t.facade.activeCount).toBe(0);
    });

    it('换到另一块地：旧地块的监听取消，只剩新地块的', async () => {
      const t = await setup();
      await t.ready();
      await t.router.navigateByUrl('/plots/p2');
      await settle(t.fixture);
      expect(t.facade.activeDocs('plots/p1').length).toBe(0);
      expect(t.facade.activeCollections('plots/p1/assessments').length).toBe(0);
      expect(t.facade.activeDocs('plots/p2').length).toBe(1);
      expect(t.facade.activeCollections('plots/p2/assessments').length).toBe(1);
    });
  });
});
