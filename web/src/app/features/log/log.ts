import type { AssessmentData } from '../result/assessment';

// 「智能体日志」页（屏 7 旁边的演示画面、评委看「AI 做了什么」）用的纯逻辑：把评估文档里的 steps[] 整理成能显示的行。
// steps[] 是后端流水线每完成一步写一条；评估还在跑时一步一步出现。

export type StepStatus = 'ok' | 'degraded' | 'failed';
export const KNOWN_STEPS = ['read', 'check', 'forest', 'actions', 'pipeline'] as const;
export type KnownStep = (typeof KNOWN_STEPS)[number];

export interface LogRow {
  /** 已知的步骤名；后端以后加了新步骤也不会崩：未知的显示原名 */
  step: string;
  known: KnownStep | null;
  status: StepStatus;
  ms: number | null;
  /** 后端写的英文一句话，原样显示（纯文本） */
  detail: string;
}

const STATUSES: readonly StepStatus[] = ['ok', 'degraded', 'failed'];
const MAX_DETAIL = 300;

export function logRows(a: AssessmentData | null): LogRow[] {
  const steps = Array.isArray(a?.steps) ? a.steps : [];
  return steps.flatMap((s) => {
    if (!s || typeof s.step !== 'string' || s.step === '') return [];
    const status = (STATUSES as readonly unknown[]).includes(s.status)
      ? (s.status as StepStatus)
      : 'ok';
    const ms =
      typeof s.ms === 'number' && Number.isFinite(s.ms) && s.ms >= 0 ? Math.round(s.ms) : null;
    return [
      {
        step: s.step,
        known: (KNOWN_STEPS as readonly string[]).includes(s.step) ? (s.step as KnownStep) : null,
        status,
        ms,
        detail: typeof s.detail === 'string' ? s.detail.slice(0, MAX_DETAIL) : '',
      },
    ];
  });
}

export interface LogFacts {
  /** 读证件的模型（可能不止一个：备选切换过） */
  readers: string[];
  /** 写说明的模型；'template' = 没调模型 */
  writer: string | null;
  forestDataset: string | null;
  rulesVersion: string | null;
}

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

export function logFacts(a: AssessmentData | null): LogFacts {
  return {
    readers: (text(a?.modelVersion) ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    writer: text(a?.summaryModel),
    forestDataset: text(a?.forestDataset),
    rulesVersion: text(a?.rulesVersion),
  };
}
