import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { assessment, plot } from '../../../testing/assessment-fixtures';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { stubHistory } from '../../../testing/back';
import { LogPage } from './log-page';

@Component({ template: '' })
class Blank {}

async function setup(url = '/plots/p1/log') {
  const facade = new FakeFacade();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'plots/:id', component: Blank },
        { path: 'plots/:id/log', component: LogPage },
      ]),
      { provide: FIRESTORE_FACADE, useValue: facade },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, LogPage);
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  return {
    el,
    facade,
    fixture,
    router: TestBed.inject(Router),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    all: (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)],
    text: (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    ready: async (a: Record<string, unknown>) => {
      facade.emitDoc('plots/p1', plot());
      facade.emitCollection('plots/p1/assessments', [{ id: 'a1', data: a }]);
      await settle(fixture);
    },
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
  };
}

const STEPS = [
  { step: 'read', status: 'ok', ms: 9016, detail: 'extracted=3' },
  { step: 'check', status: 'ok', ms: 14, detail: '4 rules, 1 gaps, as_of=2026-10-18' },
  { step: 'forest', status: 'degraded', ms: 1417, detail: 'risk=unknown (degraded: TimeoutError)' },
  { step: 'actions', status: 'ok', ms: 3156, detail: 'model=gemini-3.5-flash' },
];

describe('LogPage（智能体日志）', () => {
  it('每一步一行：名称、状态（图标＋文字）、耗时、说明；已知步骤用词典里的名字', async () => {
    const t = await setup();
    await t.ready(assessment({ steps: STEPS }));
    const rows = t.all('#log-list .log-row');
    expect(rows.map((r) => r.getAttribute('data-step'))).toEqual([
      'read',
      'check',
      'forest',
      'actions',
    ]);
    expect(rows[0].textContent).toContain('Baca dokumen');
    expect(rows[0].textContent).toContain('Siap');
    expect(rows[0].textContent).toContain('9.0 s');
    expect(rows[0].textContent).toContain('extracted=3');
    expect(rows[1].textContent).toContain('14 ms');
    expect(rows[2].textContent).toContain('Siap dengan pilihan lain'); // degraded：文字说明白，不只靠颜色
    expect(rows[2].querySelector('.tone-warn')).not.toBeNull();
  });

  it('用了什么：读证件的模型、写说明的模型、森林数据、规则版本、总耗时', async () => {
    const t = await setup();
    await t.ready(
      assessment({
        steps: STEPS,
        modelVersion: 'gemini-3.5-flash,gemini-3.7-flash',
        summaryModel: 'gemini-3.5-flash',
        forestDataset: 'JRC/GFC2020/V4 + UMD/hansen/global_forest_change_2025_v1_13',
        rulesVersion: 'rules-0.2',
        startedAt: new Date('2026-10-18T01:00:00Z'),
        finishedAt: new Date('2026-10-18T01:00:18.500Z'),
      }),
    );
    expect(t.text('#fact-reader')).toBe('gemini-3.5-flash, gemini-3.7-flash');
    expect(t.text('#fact-writer')).toBe('gemini-3.5-flash');
    expect(t.text('#fact-forest')).toContain('JRC/GFC2020/V4');
    expect(t.text('#fact-rules')).toBe('rules-0.2');
    expect(t.text('#fact-total')).toBe('18.5 s');
  });

  it('兜底模板写的说明：写「内置文字（没有 AI）」，不冒充模型', async () => {
    const t = await setup();
    await t.ready(assessment({ steps: STEPS, summaryModel: 'template' }));
    expect(t.text('#fact-writer')).toBe('teks terbina dalam (tanpa AI)');
  });

  it('评估还在跑：写明新步骤会陆续出现；新的一步到了，列表实时多一行', async () => {
    const t = await setup();
    await t.ready(assessment({ runStatus: 'running', result: null, steps: STEPS.slice(0, 1) }));
    expect(t.q('#log-running')).not.toBeNull();
    expect(t.all('#log-list .log-row')).toHaveLength(1);
    t.facade.emitCollection('plots/p1/assessments', [
      {
        id: 'a1',
        data: assessment({ runStatus: 'running', result: null, steps: STEPS.slice(0, 2) }),
      },
    ]);
    await settle(t.fixture);
    expect(t.all('#log-list .log-row')).toHaveLength(2);
  });

  it('没有 steps（种子或老评估）：一句说明，不报错', async () => {
    const t = await setup();
    await t.ready(assessment());
    expect(t.q('#log-none')).not.toBeNull();
    expect(t.q('#log-list')).toBeNull();
  });

  it('评估失败：pipeline 那一步显示失败（图标＋文字）', async () => {
    const t = await setup();
    await t.ready(
      assessment({
        runStatus: 'failed',
        result: null,
        steps: [{ step: 'pipeline', status: 'failed', ms: 3, detail: 'KeyError: fullName' }],
      }),
    );
    const row = t.q('#log-list .log-row')!;
    expect(row.textContent).toContain('Keseluruhan semakan');
    expect(row.textContent).toContain('Gagal');
    expect(row.querySelector('.tone-bad')).not.toBeNull();
  });

  it('地块不存在：一句说明', async () => {
    const t = await setup();
    t.facade.emitDoc('plots/p1', null);
    await settle(t.fixture);
    expect(t.q('#not-found')).not.toBeNull();
  });

  it('「Kembali ke keputusan」：去这块地的结果页，保留 ?member', async () => {
    const t = await setup('/plots/p1/log?member=m9');
    await t.ready(assessment({ steps: STEPS }));
    await t.click('#back-to-result');
    expect(t.router.url).toBe('/plots/p1?member=m9');
  });

  it('← 有历史就后退，不再导航', async () => {
    const t = await setup();
    await t.ready(assessment({ steps: STEPS }));
    const back = stubHistory(true);
    await t.click('#back');
    expect(back).toHaveBeenCalledTimes(1);
  });
});
