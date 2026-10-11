import type { Dict } from '../../core/i18n/dict.ms';
import {
  RESULTS,
  latestAssessment,
  type AssessmentData,
  type AssessmentItem,
} from '../result/assessment';

// 屏 7「评估中」的版面数据。合同里 assessments 只有 run_status、没有逐步进度字段，所以步骤只用真实信号推：
// 第 1 步看 documents 里还有没有没读完的文件，第 2 步在评估 running 且文件读完后是当前步，
// 第 3、4 步（森林、行动清单）在评估结束前保持「未开始」，结束时一起变「完成」。不按时间假装前进。
// 只声明用得到的字段：errorMessage、summaryText 等不声明，也就不会被渲染出来。

export type Phase = 'none' | 'queued' | 'running' | 'done' | 'failed';
export type StepKey = 'read' | 'check' | 'forest' | 'actions';
export type StepState = 'done' | 'current' | 'pending' | 'review';

export const STEP_KEYS: readonly StepKey[] = ['read', 'check', 'forest', 'actions'];

export interface CheckingDocument {
  isCurrent?: boolean;
  /** uploaded → extracting → extracted，或 failed／needs_review（contract/status.md） */
  extractionStatus?: string;
}

/**
 * 最新一次评估所处的阶段（不论状态：最新一次还在跑就如实说在跑，不拿更早的 done 当当前状态）。
 * 没有评估 → none；queued／running／failed 照写；其余（done，或没写／不认得的 runStatus）要有合法的 result 才算已完成，
 * 没有就按 failed（与屏 9 的 bannerKey 同一口径：那里是「需人工复核」，不会说「全部完成」）。
 */
export function phaseOf(latest: AssessmentData | null): Phase {
  if (!latest) return 'none';
  if (latest.runStatus === 'queued') return 'queued';
  if (latest.runStatus === 'running') return 'running';
  if (latest.runStatus === 'failed') return 'failed';
  return (RESULTS as readonly unknown[]).includes(latest.result) ? 'done' : 'failed';
}

/** 还有当前页的文件没读完（uploaded／extracting）；非当前页、其他状态（含 failed、needs_review、没写）都算读完 */
export function stillReading(docs: readonly CheckingDocument[]): boolean {
  return docs.some(
    (d) =>
      d.isCurrent !== false &&
      (d.extractionStatus === 'uploaded' || d.extractionStatus === 'extracting'),
  );
}

const all = (s: StepState): Record<StepKey, StepState> => ({
  read: s,
  check: s,
  forest: s,
  actions: s,
});

/** 每个阶段四步各是什么状态。failed：当前那一步标「需人工复核」，前面的完成，后面的未开始 */
export function stepStates(phase: Phase, reading: boolean): Record<StepKey, StepState> {
  switch (phase) {
    case 'none':
      return all('pending');
    case 'done':
      return all('done');
    case 'queued':
      return { ...all('pending'), read: 'current' };
    case 'running':
      return reading
        ? { ...all('pending'), read: 'current' }
        : { ...all('pending'), read: 'done', check: 'current' };
    case 'failed':
      return reading
        ? { ...all('pending'), read: 'review' }
        : { ...all('pending'), read: 'done', check: 'review' };
  }
}

const ICON: Record<StepState, string> = { done: '✓', current: '●', pending: '○', review: '?' };

export interface StepRow {
  key: StepKey;
  label: string;
  state: StepState;
  icon: string;
  /** 给读屏器的状态文字；review 用 status.needs_review 的词 */
  stateText: string;
}

export interface CheckingInput {
  assessments: readonly AssessmentItem[];
  documents: readonly CheckingDocument[];
}

export interface CheckingModel {
  phase: Phase;
  headline: string;
  /** 完成时的一句话；其他阶段为 null */
  help: string | null;
  /** 没有评估时为 null（不列步骤） */
  steps: StepRow[] | null;
  /** 只有 queued／running 才转圈 */
  spinning: boolean;
  /** 「Kira-kira 2 minit…」只在进行中显示 */
  showEta: boolean;
  /** 评估已有结论：显示「Lihat keputusan」 */
  canSeeResult: boolean;
}

export function buildChecking(t: Dict, input: CheckingInput): CheckingModel {
  const latest = latestAssessment(input.assessments)?.data ?? null;
  const phase = phaseOf(latest);
  const states = stepStates(phase, stillReading(input.documents));

  const steps: StepRow[] | null =
    phase === 'none'
      ? null
      : STEP_KEYS.map((key) => {
          const state = states[key];
          return {
            key,
            label: t.checking.steps[key],
            state,
            icon: ICON[state],
            stateText: state === 'review' ? t.status.needs_review : t.checking.stepState[state],
          };
        });

  const inProgress = phase === 'queued' || phase === 'running';
  return {
    phase,
    headline:
      phase === 'none'
        ? t.checking.notStarted
        : phase === 'done'
          ? t.checking.doneHeadline
          : phase === 'failed'
            ? t.checking.failedHeadline
            : t.checking.headline,
    help: phase === 'done' ? t.checking.doneHelp : null,
    steps,
    spinning: inProgress,
    showEta: inProgress,
    canSeeResult: phase === 'done',
  };
}
