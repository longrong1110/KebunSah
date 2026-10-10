import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  assessment,
  CJK,
  gap,
  plot,
  polygonGeojson,
  rules,
} from '../../../testing/assessment-fixtures';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { IssuePage } from './issue-page';

@Component({ template: '' })
class Blank {}

async function setup(url: string) {
  const facade = new FakeFacade();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'plots/:id', component: Blank },
        { path: 'plots/:id/issue/:key', component: IssuePage },
      ]),
      { provide: FIRESTORE_FACADE, useValue: facade },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, IssuePage);
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  return {
    fixture,
    facade,
    el,
    router: TestBed.inject(Router),
    i18n: TestBed.inject(I18nService),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ready: async (
      a: Record<string, unknown> = assessment(),
      p: Record<string, unknown> = plot(),
    ) => {
      facade.emitDoc('plots/p1', p);
      facade.emitCollection('plots/p1/assessments', [{ id: 'a1', data: a }]);
      await settle(fixture);
    },
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
  };
}

// 线框里的例子：地契 1.6 ha，量出来 2.1 ha
const areaRules = [
  {
    ruleCode: 'CC-01',
    result: 'warn',
    expectedValue: '1.6000 ha',
    actualValue: '2.1000 ha',
    detail: '多出',
  },
  ...rules.slice(1),
];

describe('IssuePage（屏 10）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('area_mismatch', () => {
    const area = () =>
      assessment({
        ruleResults: areaRules,
        gaps: [gap('area_mismatch'), gap('expiring', 'medium', 'mpob_licence')],
      });

    it('数字对照＋差值标签（⚠＋文字）＋可能原因＋建议；不责怪用户', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(area());
      expect(t.q('#issue-title')?.textContent).toBe('Keluasan tidak sepadan');
      const boxes = [...t.el.querySelectorAll('.compare__box')].map((b) => [
        b.querySelector('.compare__label')?.textContent?.trim(),
        b.querySelector('.compare__value')?.textContent?.trim(),
      ]);
      expect(boxes).toEqual([
        ['Dalam geran', '1.6 ha'],
        ['Lukisan anda', '2.1 ha'],
      ]);
      expect(t.q('#diff')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('⚠+0.5 ha (31%)');
      expect(t.q('#diff')?.className).toContain('tone-warn');
      expect(t.q('#cause')?.textContent).toContain('Mungkin tanah yang dilukis terlalu besar');
      expect(t.q('#advice')?.textContent).toContain('Semak sempadan');
      expect(t.text()).not.toMatch(/salah anda|kesilapan anda/i);
    });

    it('标注评估日期（数字是评估时的快照）', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(area());
      expect(t.q('#checked-on')?.textContent).toBe('Disemak pada 3 Okt');
    });

    it('有 polygonGeojson：画形状预览（内联 SVG，有文字替代），所有点在画布内', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(area(), plot({ polygonGeojson }));
      const svg = t.q('#polygon-preview')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toContain('Bentuk tanah anda');
      const points = svg.querySelector('polygon')!.getAttribute('points')!.split(' ');
      expect(points).toHaveLength(4);
      for (const p of points) {
        const [x, y] = p.split(',').map(Number);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(240);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(140);
      }
    });

    it('没有多边形、或多边形坏了：不显示预览，其余照常', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(area(), plot({ polygonGeojson: null }));
      expect(t.q('#polygon-preview')).toBeNull();
      expect(t.q('#compare')).not.toBeNull();

      t.facade.emitDoc(
        'plots/p1',
        plot({ polygonGeojson: '{"type":"Polygon","coordinates":"x"}' }),
      );
      await settle(t.fixture);
      expect(t.q('#polygon-preview')).toBeNull();
    });

    it('数值读不出来：不显示对照格，只剩文字说明；页面上没有 NaN／空的 ha', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(
        assessment({
          ruleResults: [
            { ruleCode: 'CC-01', result: 'warn', expectedValue: 'sekitar tiga', actualValue: null },
          ],
        }),
      );
      expect(t.q('#compare')).toBeNull();
      expect(t.q('#diff')).toBeNull();
      expect(t.q('#detail')?.textContent).toBe('Luas pada peta berbeza daripada geran.');
      expect(t.text()).not.toMatch(/NaN|undefined| ha\b.*\bha\b/);
    });

    it('缺少 CC-01 规则：同样降级', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(assessment({ ruleResults: [] }));
      expect(t.q('#compare')).toBeNull();
      expect(t.q('#detail')).not.toBeNull();
    });

    it('「Lukis semula」禁用并写明原因；点它不会导航（不能跳到新建地块的占位页）', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch?member=m9');
      await t.ready(area());
      const redraw = t.q('#redraw') as HTMLButtonElement;
      expect(redraw.disabled).toBe(true);
      expect(redraw.getAttribute('aria-disabled')).toBe('true');
      expect(redraw.getAttribute('aria-describedby')).toBe('redraw-note');
      expect(t.q('#redraw-note')?.textContent).toContain('akan tersedia tidak lama lagi');
      expect(t.q('#upload-note')).toBeNull();
      redraw.click();
      await settle(t.fixture);
      expect(t.router.url).toBe('/plots/p1/issue/area_mismatch?member=m9');
    });
  });

  describe('其他事项：只给说明，不放没效果的按钮', () => {
    it('expiring：剩余天数；没有对照格、没有「Lukis semula」，有「Muat naik…tidak lama lagi」', async () => {
      const t = await setup('/plots/p1/issue/expiring');
      await t.ready();
      expect(t.q('#issue-title')?.textContent).toBe('Lesen MPOB hampir tamat');
      expect(t.q('#detail')?.textContent).toBe('Tamat dalam 58 hari.');
      expect(t.q('#compare')).toBeNull();
      expect(t.q('#polygon-preview')).toBeNull();
      expect(t.q('#redraw')).toBeNull();
      expect(t.q('#upload-note')?.textContent).toContain('Muat naik dokumen baharu akan tersedia');
      expect(t.q('#advice')?.textContent).toContain('Mohon pembaharuan Lesen MPOB');
    });

    it('expired：到期日按语言写出来（"2026-04-30 已过期" → 30 Apr 2026）', async () => {
      const t = await setup('/plots/p1/issue/expired');
      await t.ready(
        assessment({
          result: 'red',
          ruleResults: [{ ruleCode: 'CC-02', result: 'fail', actualValue: '2026-04-30 已过期' }],
          gaps: [gap('expired', 'high', 'mpob_licence')],
        }),
      );
      expect(t.q('#detail')?.textContent).toBe('Tamat pada 30 Apr 2026.');
      t.i18n.set('en');
      await settle(t.fixture);
      expect(t.q('#detail')?.textContent).toBe('Expired on 30 Apr 2026.');
    });

    it('expired 但日期读不出：只写「Tempoh sahnya sudah tamat.」，不出现空日期', async () => {
      const t = await setup('/plots/p1/issue/expired');
      await t.ready(
        assessment({
          ruleResults: [{ ruleCode: 'CC-02', result: 'fail', actualValue: 'sudah lama' }],
          gaps: [gap('expired', 'high', 'mpob_licence')],
        }),
      );
      expect(t.q('#detail')?.textContent).toBe('Tempoh sahnya sudah tamat.');
    });

    it.each([
      ['name_mismatch', 'land_title', 'Nama pada Geran tanah tidak sepadan', 'dokumen pusaka'],
      [
        'not_in_mspo',
        'mspo_member_list',
        'Tiada dalam senarai ahli MSPO',
        'pensijilan MSPO berkumpulan',
      ],
      ['low_confidence', 'land_title', 'Tulisan pada Geran tanah kurang jelas', 'gambar semula'],
      [
        'missing_doc',
        'mpob_licence',
        'Lesen MPOB tiada',
        'Dapatkan di pejabat MPOB. Bawa MyKad dan geran.',
      ],
    ])('%s：标题、可能原因、建议都在', async (code, docType, title, advice) => {
      const t = await setup(`/plots/p1/issue/${code}`);
      await t.ready(assessment({ result: 'red', gaps: [gap(code, 'high', docType)] }));
      expect(t.q('#issue-title')?.textContent).toBe(title);
      expect(t.q('#cause')?.textContent?.trim()).not.toBe('');
      expect(t.q('#advice')?.textContent).toContain(advice);
      expect(t.q('#redraw')).toBeNull();
    });

    it('同 gapCode 不同文件：key 带 docType，各找各的', async () => {
      const a = assessment({
        result: 'needs_review',
        gaps: [
          gap('low_confidence', 'medium', 'land_title'),
          gap('low_confidence', 'medium', 'mpob_licence'),
        ],
      });
      const t = await setup('/plots/p1/issue/low_confidence~mpob_licence');
      await t.ready(a);
      expect(t.q('#issue-title')?.textContent).toBe('Tulisan pada Lesen MPOB kurang jelas');

      await t.router.navigateByUrl('/plots/p1/issue/low_confidence~land_title');
      await settle(t.fixture);
      expect(t.q('#issue-title')?.textContent).toBe('Tulisan pada Geran tanah kurang jelas');
    });

    it('未知 gapCode：通用说明，不显示缺口自带的文字', async () => {
      const t = await setup('/plots/p1/issue/brand_new_code');
      await t.ready(assessment({ gaps: [gap('brand_new_code')] }));
      expect(t.q('#issue-title')?.textContent).toBe('Perkara perlu disemak');
      expect(t.text()).not.toContain('RAMAN');
      expect(t.text()).not.toContain('brand_new_code');
    });
  });

  describe('找不到、读取之前、失败', () => {
    it('key 对不上（已解决、写错）：说明＋回屏 9，不崩', async () => {
      const t = await setup('/plots/p1/issue/nonsense?member=m9');
      await t.ready();
      expect(t.q('#issue-not-found')?.textContent).toContain('tidak dijumpai atau sudah selesai');
      expect(t.q('#issue-title')?.textContent).toBe('Keputusan');
      await t.click('#back-to-result');
      expect(t.router.url).toBe('/plots/p1?member=m9');
    });

    it('已解决（status 不是 open）的缺口：找不到', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(assessment({ gaps: [{ ...gap('area_mismatch'), status: 'closed' }] }));
      expect(t.q('#issue-not-found')).not.toBeNull();
    });

    it('最新一次评估失败：找不到（失败的一次不列事项）', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(assessment({ runStatus: 'failed', result: null }));
      expect(t.q('#issue-not-found')).not.toBeNull();
      expect(t.q('#compare')).toBeNull();
    });

    it('没有评估、或最新一次还在跑：找不到', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(assessment({ runStatus: 'running', result: null }));
      expect(t.q('#issue-not-found')).not.toBeNull();

      t.facade.emitCollection('plots/p1/assessments', []);
      await settle(t.fixture);
      expect(t.q('#issue-not-found')).not.toBeNull();
    });

    it('地块不存在（服务器确认）：说明；缓存里的「不存在」不下结论', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      t.facade.emitDoc('plots/p1', null, true);
      t.facade.emitCollection('plots/p1/assessments', [], { fromCache: true });
      await settle(t.fixture);
      expect(t.q('#not-found')).toBeNull();
      expect(t.q('#loading')).not.toBeNull();

      t.facade.emitDoc('plots/p1', null, false);
      await settle(t.fixture);
      expect(t.q('#not-found')?.textContent).toContain('Tanah ini tidak dijumpai');
    });

    it('读到之前是骨架；10 秒没确认转离线并可重试；出错有提示', async () => {
      vi.useFakeTimers();
      const t = await setup('/plots/p1/issue/area_mismatch');
      expect(t.q('#loading')).not.toBeNull();
      t.facade.emitDoc('plots/p1', plot(), true);
      t.facade.emitCollection('plots/p1/assessments', [], { fromCache: true });
      vi.advanceTimersByTime(10_000);
      await settle(t.fixture);
      expect(t.q('#offline')?.textContent).toContain('Tiada sambungan');
      await t.click('#retry');
      expect(t.facade.activeDocs('plots/p1').length).toBe(1);
      expect(t.facade.docs.filter((w) => w.path === 'plots/p1').length).toBe(2);

      t.facade.failCollection('plots/p1/assessments');
      await settle(t.fixture);
      expect(t.q('#error')?.textContent).toContain('Tidak dapat memuat');
    });
  });

  describe('隐私、语言、导航', () => {
    it('页面上没有中文占位、第三人姓名、摘要、规则里的 detail', async () => {
      const t = await setup('/plots/p1/issue/name_mismatch');
      await t.ready(
        assessment({ result: 'red', gaps: [gap('name_mismatch', 'high', 'land_title')] }),
        plot({ polygonGeojson }),
      );
      const text = t.text();
      expect(text).not.toMatch(CJK);
      expect(text).not.toContain('RAMAN');
      expect(text).not.toContain('SUBRAMANIAM');
      expect(text).not.toContain('INTERNAL-SUMMARY');
      expect(text).not.toContain('已故');
    });

    it('切到英语：标题、对照、原因、建议、按钮说明都变', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready(assessment({ ruleResults: areaRules }));
      t.i18n.set('en');
      await settle(t.fixture);
      expect(t.q('#issue-title')?.textContent).toBe("The areas don't match");
      expect(t.q('.compare')?.textContent).toContain('On the title');
      expect(t.q('.compare')?.textContent).toContain('Your drawing');
      expect(t.q('#cause')?.textContent).toContain('drawn area may be too large');
      expect(t.q('#redraw')?.textContent).toContain('Draw again');
      expect(t.q('#redraw-note')?.textContent).toContain('will be available soon');
      expect(t.text()).not.toContain('Keluasan');
    });

    it('返回箭头与「Kembali ke keputusan」都回屏 9，保留 ?member', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch?member=m9');
      await t.ready();
      await t.click('#back');
      expect(t.router.url).toBe('/plots/p1?member=m9');
    });

    it('离开页面后监听全部取消（地块、评估）', async () => {
      const t = await setup('/plots/p1/issue/area_mismatch');
      await t.ready();
      expect(t.facade.activeCount).toBe(2);
      t.fixture.destroy();
      expect(t.facade.activeCount).toBe(0);
    });
  });
});
