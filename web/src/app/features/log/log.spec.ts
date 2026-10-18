import { describe, expect, it } from 'vitest';
import { logFacts, logRows } from './log';

describe('logRows', () => {
  it('把 steps[] 整理成行：已知步骤、状态、耗时、说明', () => {
    const rows = logRows({
      steps: [
        { step: 'read', status: 'ok', ms: 9016.4, detail: 'extracted=3' },
        { step: 'forest', status: 'degraded', ms: 0, detail: 'risk=unknown' },
        { step: 'pipeline', status: 'failed', ms: 12, detail: 'KeyError: fullName' },
      ],
    });
    expect(rows).toEqual([
      { step: 'read', known: 'read', status: 'ok', ms: 9016, detail: 'extracted=3' },
      { step: 'forest', known: 'forest', status: 'degraded', ms: 0, detail: 'risk=unknown' },
      {
        step: 'pipeline',
        known: 'pipeline',
        status: 'failed',
        ms: 12,
        detail: 'KeyError: fullName',
      },
    ]);
  });

  it('后端以后加了新步骤：照样显示（known 为 null，显示原名）', () => {
    expect(logRows({ steps: [{ step: 'translate', status: 'ok', ms: 5 }] })[0]).toMatchObject({
      step: 'translate',
      known: null,
    });
  });

  it('脏数据不崩：没有步骤名的丢掉；状态不认识当 ok；耗时不是正常的数就是 null；说明截断', () => {
    const rows = logRows({
      steps: [
        null as never,
        {} as never,
        { step: '' },
        { step: 'read', status: 'weird', ms: -5, detail: 'x'.repeat(1000) },
        { step: 'check', ms: Number.NaN },
        { step: 'actions', ms: '3' as never, detail: 7 as never },
      ],
    });
    expect(rows.map((r) => [r.step, r.status, r.ms])).toEqual([
      ['read', 'ok', null],
      ['check', 'ok', null],
      ['actions', 'ok', null],
    ]);
    expect(rows[0].detail).toHaveLength(300);
    expect(rows[2].detail).toBe('');
  });

  it('没有评估或没有 steps（老数据）：空表', () => {
    expect(logRows(null)).toEqual([]);
    expect(logRows({})).toEqual([]);
    expect(logRows({ steps: 'oops' as never })).toEqual([]);
  });
});

describe('logFacts', () => {
  it('读证件的模型（可能备选切换过）、写说明的模型、森林数据、规则版本', () => {
    expect(
      logFacts({
        modelVersion: 'gemini-3.5-flash, gemini-3.7-flash',
        summaryModel: 'gemini-3.5-flash',
        forestDataset: 'JRC/GFC2020/V4 + UMD/hansen/global_forest_change_2025_v1_13',
        rulesVersion: 'rules-0.2',
      }),
    ).toEqual({
      readers: ['gemini-3.5-flash', 'gemini-3.7-flash'],
      writer: 'gemini-3.5-flash',
      forestDataset: 'JRC/GFC2020/V4 + UMD/hansen/global_forest_change_2025_v1_13',
      rulesVersion: 'rules-0.2',
    });
  });

  it('缺的都是空：不写', () => {
    expect(logFacts(null)).toEqual({
      readers: [],
      writer: null,
      forestDataset: null,
      rulesVersion: null,
    });
    expect(logFacts({ modelVersion: '', summaryModel: '  ' })).toMatchObject({
      readers: [],
      writer: null,
    });
  });
});
