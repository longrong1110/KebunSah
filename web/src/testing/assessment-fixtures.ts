// 屏 9／屏 10 测试共用的样本，形状照种子的评估文档。
// 缺口说明故意带上中文占位、第三人姓名和「已故」这类推断，ruleResults.detail、summaryText、errorMessage 也带上：
// 界面一律不该渲染它们，测试里据此断言。

export const CJK = /[㐀-鿿]/;

export const plot = (over: Record<string, unknown> = {}) => ({
  landTitleId: 't1',
  status: 'yellow',
  areaHaComputed: 3.49,
  lastAssessedAt: new Date('2026-10-03T02:24:00Z'),
  district: 'Kampar',
  ...over,
});

export const gap = (gapCode: string, severity = 'medium', docType: string | null = null) => ({
  gapCode,
  severity,
  docType,
  status: 'open',
  description: `中文说明 ${gapCode} RAMAN A/L SUBRAMANIAM`,
  suggestedAction: '中文建议 已故父亲',
  citation: 'CITATION-SECRET',
});

export const rules = [
  {
    ruleCode: 'CC-01',
    result: 'warn',
    expectedValue: '3.0400 ha',
    actualValue: '3.4900 ha',
    detail: '多出 0.45 公顷',
    evidence: [{ documentId: 'DOC-SECRET-1', fieldKey: 'land_title.area_value' }],
  },
  {
    ruleCode: 'CC-02',
    result: 'warn',
    expectedValue: '>= 90 天',
    actualValue: '58 天',
    detail: 'MPOB 执照 2026-12-05 到期',
  },
  {
    ruleCode: 'CC-03',
    result: 'pass',
    expectedValue: '>= 0.85',
    actualValue: '1.00',
    detail: '姓名一致',
  },
];

export const assessment = (over: Record<string, unknown> = {}) => ({
  runStatus: 'done',
  result: 'yellow',
  createdAt: new Date('2026-10-03T02:22:00Z'),
  startedAt: new Date('2026-10-03T02:22:00Z'),
  finishedAt: new Date('2026-10-03T02:24:00Z'),
  forestRisk: 'low',
  forestLossAfter2020Ha: 0,
  summaryText: '中文摘要 INTERNAL-SUMMARY',
  modelVersion: 'MODEL-SECRET-1',
  rulesVersion: 'RULES-SECRET-1',
  inputSnapshot: { note: 'SNAPSHOT-SECRET' },
  errorMessage: null,
  ruleResults: rules,
  gaps: [gap('area_mismatch'), gap('expiring', 'medium', 'mpob_licence')],
  ...over,
});

/** 一个正方形多边形（JSON 字符串，和种子里 polygonGeojson 的存法一致） */
export const polygonGeojson = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [101.149037, 4.309105],
      [101.150963, 4.309105],
      [101.150963, 4.310895],
      [101.149037, 4.310895],
      [101.149037, 4.309105],
    ],
  ],
});
