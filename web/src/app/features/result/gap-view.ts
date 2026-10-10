import type { Dict } from '../../core/i18n/dict.ms';
import type { Lang } from '../../core/i18n/i18n.service';
import { gapFacts, type AssessmentData, type ForestNote, type GapItem } from './assessment';

/** 森林初筛的一句话（不含「Ini saringan awal sahaja.」，调用方另加）。只是初筛，不夸大 */
export function forestLine(t: Dict, note: ForestNote): string {
  return note.kind === 'low'
    ? t.result.forest.low
    : note.kind === 'loss'
      ? t.result.forest.loss(note.ha)
      : t.result.forest.unknown;
}

/**
 * 一个缺口给用户看的文案：标题、一句带数字的详情、可能原因、建议、屏 9 卡片按钮。
 * 全部由 gapCode（及 docType）用词典生成，数字从 ruleResults 里解析；不读缺口自带的 description／suggestedAction
 * （可能含第三人姓名，种子里还是中文占位）。未知 gapCode 走通用兜底文案。屏 9、屏 10、看板共用。
 */
export function gapView(t: Dict, lang: Lang, assessment: AssessmentData, gap: GapItem) {
  const text = gap.known ? t.result.gapText[gap.known] : t.result.gapUnknown;
  const ctx = {
    doc: t.result.docName(gap.docType),
    docType: gap.docType,
    facts: gapFacts(assessment, gap, lang),
  };
  return {
    title: text.title(ctx),
    detail: text.detail(ctx),
    cause: text.cause,
    advice: text.advice(ctx),
    button: text.button,
  };
}
