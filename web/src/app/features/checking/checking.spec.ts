import { en } from '../../core/i18n/dict.en';
import { ms } from '../../core/i18n/dict.ms';
import { CJK, assessment } from '../../../testing/assessment-fixtures';
import type { AssessmentData, AssessmentItem } from '../result/assessment';
import {
  buildChecking,
  phaseOf,
  stepStates,
  stillReading,
  type CheckingDocument,
} from './checking';

const asData = (over: Record<string, unknown> = {}) => assessment(over) as AssessmentData;
const item = (id: string, data: AssessmentData): AssessmentItem => ({ id, data });
const run = (runStatus: string, over: Record<string, unknown> = {}) =>
  item('a', asData({ runStatus, ...over }));

const doc = (extractionStatus: string, isCurrent = true): CheckingDocument => ({
  extractionStatus,
  isCurrent,
});

describe('phaseOf', () => {
  it('没有评估：none', () => {
    expect(phaseOf(null)).toBe('none');
  });

  it('queued／running／failed 照写；done 与没写 runStatus 都算已完成', () => {
    expect(phaseOf(asData({ runStatus: 'queued' }))).toBe('queued');
    expect(phaseOf(asData({ runStatus: 'running' }))).toBe('running');
    expect(phaseOf(asData({ runStatus: 'failed' }))).toBe('failed');
    expect(phaseOf(asData({ runStatus: 'done' }))).toBe('done');
    expect(phaseOf(asData({ runStatus: undefined }))).toBe('done');
    expect(phaseOf(asData({ runStatus: 'something-new' }))).toBe('done');
  });

  it('runStatus 缺失、未知或是 done，但没有合法的 result：按 failed（与屏 9 的「需人工复核」同一口径），不说「完成」', () => {
    expect(phaseOf(asData({ runStatus: 'done', result: null }))).toBe('failed');
    expect(phaseOf(asData({ runStatus: undefined, result: undefined }))).toBe('failed');
    expect(phaseOf(asData({ runStatus: 'something-new', result: 'purple' }))).toBe('failed');
    expect(phaseOf(asData({ runStatus: 'done', result: 'needs_review' }))).toBe('done');
  });
});

describe('stillReading', () => {
  it('当前页里有 uploaded／extracting：还在读', () => {
    expect(stillReading([doc('extracted'), doc('uploaded')])).toBe(true);
    expect(stillReading([doc('extracting')])).toBe(true);
  });

  it('非当前页、extracted、failed、needs_review、没写状态、没有文件：都算读完', () => {
    expect(stillReading([doc('extracting', false)])).toBe(false);
    expect(stillReading([doc('extracted'), doc('failed'), doc('needs_review')])).toBe(false);
    expect(stillReading([{}])).toBe(false);
    expect(stillReading([])).toBe(false);
  });

  it('没写 isCurrent 的算当前页', () => {
    expect(stillReading([{ extractionStatus: 'extracting' }])).toBe(true);
  });
});

describe('stepStates', () => {
  const S = (read: string, check: string, forest: string, actions: string) => ({
    read,
    check,
    forest,
    actions,
  });

  it('没有评估：全部未开始', () => {
    expect(stepStates('none', false)).toEqual(S('pending', 'pending', 'pending', 'pending'));
  });

  it('queued：第 1 步当前，其余未开始（不论文件）', () => {
    expect(stepStates('queued', false)).toEqual(S('current', 'pending', 'pending', 'pending'));
    expect(stepStates('queued', true)).toEqual(S('current', 'pending', 'pending', 'pending'));
  });

  it('running：文件还在读 → 第 1 步当前；读完 → 第 1 步完成、第 2 步当前，第 3、4 步仍未开始', () => {
    expect(stepStates('running', true)).toEqual(S('current', 'pending', 'pending', 'pending'));
    expect(stepStates('running', false)).toEqual(S('done', 'current', 'pending', 'pending'));
  });

  it('done：四步全部完成', () => {
    expect(stepStates('done', false)).toEqual(S('done', 'done', 'done', 'done'));
  });

  it('failed：当前那一步标「需人工复核」，前面的完成，后面的未开始', () => {
    expect(stepStates('failed', true)).toEqual(S('review', 'pending', 'pending', 'pending'));
    expect(stepStates('failed', false)).toEqual(S('done', 'review', 'pending', 'pending'));
  });
});

describe('buildChecking', () => {
  const build = (assessments: AssessmentItem[], documents: CheckingDocument[] = []) =>
    buildChecking(ms, { assessments, documents });

  it('进行中：转圈、说明、四步按固定顺序，每步图标＋文字＋状态文字', () => {
    const m = build([run('running')], [doc('extracted')]);
    expect(m.phase).toBe('running');
    expect(m.headline).toBe('Sedang menyemak tanah anda…');
    expect(m.spinning).toBe(true);
    expect(m.showEta).toBe(true);
    expect(m.canSeeResult).toBe(false);
    expect(m.help).toBeNull();
    expect(m.steps?.map((s) => [s.label, s.icon, s.state, s.stateText])).toEqual([
      ['Membaca dokumen', '✓', 'done', 'Siap'],
      ['Menyemak maklumat', '●', 'current', 'Sedang dibuat'],
      ['Menyemak imej satelit hutan', '○', 'pending', 'Belum'],
      ['Menyediakan senarai tindakan', '○', 'pending', 'Belum'],
    ]);
  });

  it('queued：同样转圈，第 1 步当前', () => {
    const m = build([run('queued')]);
    expect(m.spinning).toBe(true);
    expect(m.steps?.[0].state).toBe('current');
  });

  it('文件还在读：第 1 步当前', () => {
    const m = build([run('running')], [doc('extracting'), doc('extracted')]);
    expect(m.steps?.map((s) => s.state)).toEqual(['current', 'pending', 'pending', 'pending']);
  });

  it('完成：四步全部完成，不转圈，不写「2 分钟」，可以看结果', () => {
    const m = build([run('done')]);
    expect(m.phase).toBe('done');
    expect(m.headline).toBe('Semakan siap');
    expect(m.help).toBe('Keputusan sudah ada.');
    expect(m.spinning).toBe(false);
    expect(m.showEta).toBe(false);
    expect(m.canSeeResult).toBe(true);
    expect(m.steps?.every((s) => s.state === 'done' && s.icon === '✓')).toBe(true);
  });

  it('失败：不转圈、不能看结果；当前步写「需人工复核」（沿用状态词），不出现错误信息', () => {
    const m = build([run('failed', { errorMessage: 'SECRET stack trace' })], [doc('extracted')]);
    expect(m.phase).toBe('failed');
    expect(m.headline).toBe('Pegawai koperasi akan menyemak.');
    expect(m.spinning).toBe(false);
    expect(m.showEta).toBe(false);
    expect(m.canSeeResult).toBe(false);
    expect(m.steps?.map((s) => [s.state, s.icon])).toEqual([
      ['done', '✓'],
      ['review', '?'],
      ['pending', '○'],
      ['pending', '○'],
    ]);
    expect(m.steps?.[1].stateText).toBe('Menunggu pegawai');
    expect(JSON.stringify(m)).not.toContain('SECRET');
  });

  it('没有评估：写「belum diperiksa」，不转圈、不列步骤、不能看结果', () => {
    const m = build([]);
    expect(m.phase).toBe('none');
    expect(m.headline).toBe('Tanah ini belum diperiksa.');
    expect(m.steps).toBeNull();
    expect(m.spinning).toBe(false);
    expect(m.showEta).toBe(false);
    expect(m.canSeeResult).toBe(false);
  });

  it('取最新一次：最新一次还在跑，更早的 done 不算当前状态', () => {
    const m = build([
      item('old', asData({ runStatus: 'done', createdAt: new Date('2026-10-01T00:00:00Z') })),
      item('new', asData({ runStatus: 'running', createdAt: new Date('2026-10-09T00:00:00Z') })),
    ]);
    expect(m.phase).toBe('running');
    expect(m.canSeeResult).toBe(false);
  });

  it('英文', () => {
    const m = buildChecking(en, { assessments: [run('running')], documents: [] });
    expect(m.headline).toBe('Checking your land…');
    expect(m.steps?.map((s) => s.label)).toEqual([
      'Reading documents',
      'Checking the details',
      'Checking satellite images for forest',
      'Preparing your to-do list',
    ]);
    expect(m.steps?.[1].stateText).toBe('In progress');
    const failed = buildChecking(en, { assessments: [run('failed')], documents: [] });
    expect(failed.steps?.[1].stateText).toBe('Officer to review');
  });

  it('隐私：输出里没有说明文字、id、中文', () => {
    const text = JSON.stringify(
      build([item('ASSESSMENT-SECRET', asData({ runStatus: 'done' }))], [doc('extracted')]),
    );
    for (const secret of [
      'INTERNAL-SUMMARY',
      'ASSESSMENT-SECRET',
      'SNAPSHOT-SECRET',
      'MODEL-SECRET',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(CJK);
    expect(
      JSON.stringify(buildChecking(en, { assessments: [run('failed')], documents: [] })),
    ).not.toMatch(CJK);
  });
});
