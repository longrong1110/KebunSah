import { en } from '../../core/i18n/dict.en';
import { ms } from '../../core/i18n/dict.ms';
import type { PlotItem } from '../plots/plot-types';
import type { AssessmentData, AssessmentItem } from '../result/assessment';
import {
  BUCKETS,
  EMPTY_FILTER,
  ISSUE_CATEGORIES,
  buildRows,
  countBuckets,
  countIssues,
  csvCell,
  filterRows,
  filterToParams,
  isFilterEmpty,
  mainIssue,
  parseFilter,
  plotIdOf,
  rowHeading,
  rowTexts,
  sortRows,
  summaryCsv,
  toCsv,
  type DashboardFilter,
  type DashboardRow,
} from './rows';

const d = (iso: string) => new Date(iso);

const plot = (id: string, over: Record<string, unknown> = {}): PlotItem => ({
  id,
  data: {
    operatorPersonId: `pe-${id}`,
    coopId: 'c1',
    landTitleId: `t-${id}`,
    district: 'Kampar',
    status: 'yellow',
    lastAssessedAt: d('2026-10-01T04:00:00Z'),
    ...over,
  },
});

const gap = (gapCode: string, severity = 'medium', docType: string | null = null) => ({
  gapCode,
  severity,
  docType,
  status: 'open',
});

const assessment = (
  id: string,
  plotId: string,
  over: Partial<AssessmentData> = {},
): AssessmentItem => ({
  id,
  data: {
    plotId,
    runStatus: 'done',
    result: 'yellow',
    createdAt: d('2026-10-03T02:22:00Z'),
    finishedAt: d('2026-10-03T02:24:00Z'),
    forestRisk: 'low',
    forestLossAfter2020Ha: 0,
    gaps: [],
    ruleResults: [],
    ...over,
  },
});

const persons = [
  { id: 'pe-a', data: { fullName: 'AHMAD ZAKI BIN ROSLI' } },
  { id: 'pe-b', data: { fullName: 'MUTHU A/L RAMAN' } },
  { id: 'pe-c', data: { fullName: '=HYPERLINK("http://evil")' } },
];
const titles = [
  { id: 't-a', data: { lotNo: '507', district: 'Kampar' } },
  { id: 't-b', data: { lotNo: '1234', district: 'Kluang' } },
];

function rows(input: Partial<Parameters<typeof buildRows>[0]> = {}): DashboardRow[] {
  return buildRows({ plots: [], assessments: [], persons, titles, ...input });
}

describe('buildRows', () => {
  it('一块地一行；每块地取最新一次评估；没有评估是 pending，不凭 plots.status 下结论', () => {
    const result = rows({
      plots: [plot('a', { status: 'green' }), plot('b')],
      assessments: [
        assessment('old', 'a', { result: 'red', createdAt: d('2026-09-01T00:00:00Z') }),
        assessment('new', 'a', { result: 'green', createdAt: d('2026-10-05T00:00:00Z') }),
      ],
    });
    expect(result.map((r) => [r.id, r.bucket])).toEqual([
      ['a', 'green'],
      ['b', 'pending'],
    ]);
  });

  it('对不上这些地块的评估（别的合作社的、没有 plotId 的）忽略', () => {
    const result = rows({
      plots: [plot('a')],
      assessments: [
        assessment('x', 'someone-elses-plot', { result: 'red' }),
        { id: 'y', data: { result: 'red', runStatus: 'done' } },
      ],
    });
    expect(result[0].bucket).toBe('pending');
  });

  it('最新一次还在跑：running，不拿更早的 done；失败：needs_review；都没有缺口也没有森林损失', () => {
    const running = rows({
      plots: [plot('a'), plot('b')],
      assessments: [
        assessment('1', 'a', {
          result: 'red',
          createdAt: d('2026-09-01T00:00:00Z'),
          gaps: [gap('expired')],
        }),
        assessment('2', 'a', {
          runStatus: 'running',
          result: undefined,
          createdAt: d('2026-10-09T00:00:00Z'),
        }),
        assessment('3', 'b', {
          runStatus: 'failed',
          result: undefined,
          gaps: [gap('expired')],
          forestRisk: 'high',
        }),
      ],
    });
    expect(running[0]).toMatchObject({
      bucket: 'running',
      gaps: [],
      forestLoss: false,
      categories: [],
    });
    expect(running[1]).toMatchObject({
      bucket: 'needs_review',
      gaps: [],
      forestLoss: false,
      concluded: null,
    });
  });

  it('问题类别：gapCode 归并（expired 与 expiring 同类）；森林损失派生出 forest；未知 gapCode 没有类别', () => {
    const [r] = rows({
      plots: [plot('a')],
      assessments: [
        assessment('1', 'a', {
          gaps: [
            gap('expiring', 'medium', 'mpob_licence'),
            gap('expired', 'high', 'mspo_cert'),
            gap('area_mismatch'),
            gap('totally_new'),
          ],
          forestRisk: 'high',
          forestLossAfter2020Ha: 0.8,
        }),
      ],
    });
    expect(r.categories).toEqual(['area', 'expiry', 'forest']);
    expect(r.forestLoss).toBe(true);
    expect(r.gaps).toHaveLength(4);
  });

  it('已解决的缺口不算；成员名词首大写；读不到成员名为 null', () => {
    const [a, c, none] = rows({
      plots: [
        plot('a'),
        plot('c', { operatorPersonId: 'pe-c' }),
        plot('z', { operatorPersonId: 'ghost' }),
      ],
      assessments: [
        assessment('1', 'a', { gaps: [{ ...gap('area_mismatch'), status: 'closed' }] }),
      ],
    });
    expect(a.gaps).toEqual([]);
    expect(a.member).toBe('Ahmad Zaki bin Rosli');
    expect(c.member).toBe('=Hyperlink("Http://Evil")');
    expect(none.member).toBeNull();
  });

  it('updated：最新评估的时间（finishedAt 优先），没有评估取 plots.lastAssessedAt，再没有为 null', () => {
    const [a, b, c] = rows({
      plots: [plot('a'), plot('b'), plot('c', { lastAssessedAt: null })],
      assessments: [assessment('1', 'a', { finishedAt: d('2026-10-07T01:00:00Z') })],
    });
    expect(a.updated?.toISOString()).toBe('2026-10-07T01:00:00.000Z');
    expect(b.updated?.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(c.updated).toBeNull();
  });
});

describe('plotIdOf／按路径对上地块', () => {
  it('优先看文档路径 plots/{id}/assessments/{aid}；没有路径再退回 plotId 字段；都没有为 null', () => {
    expect(plotIdOf({ id: 'a', path: 'plots/p1/assessments/a', data: {} })).toBe('p1');
    expect(plotIdOf({ id: 'a', data: { plotId: 'p2' } })).toBe('p2');
    expect(plotIdOf({ id: 'a', data: {} })).toBeNull();
    expect(plotIdOf({ id: 'a', data: { plotId: '' } })).toBeNull();
  });

  it('路径和字段不一致时路径说了算（路径是评估的权威位置）', () => {
    expect(plotIdOf({ id: 'a', path: 'plots/p1/assessments/a', data: { plotId: 'other' } })).toBe(
      'p1',
    );
  });

  it('不是评估路径的忽略（别的集合、层级不对），退回字段', () => {
    expect(plotIdOf({ id: 'a', path: 'persons/x', data: { plotId: 'p3' } })).toBe('p3');
    expect(plotIdOf({ id: 'a', path: 'plots/p1/assessments', data: {} })).toBeNull();
    expect(plotIdOf({ id: 'a', path: 'plots/p1/documents/a', data: {} })).toBeNull();
  });

  it('文档里没有 plotId 字段，只靠路径也能对上地块（后端不写这个字段也不会全变成 Belum mula）', () => {
    const noField: AssessmentItem = {
      id: 'a',
      path: 'plots/a/assessments/a',
      data: {
        runStatus: 'done',
        result: 'red',
        createdAt: d('2026-10-03T02:22:00Z'),
        gaps: [],
        ruleResults: [],
      },
    };
    const [r] = rows({ plots: [plot('a')], assessments: [noField] });
    expect(r.bucket).toBe('red');
  });

  it('路径指向别的合作社的地块：忽略', () => {
    const foreign: AssessmentItem = {
      id: 'a',
      path: 'plots/not-mine/assessments/a',
      data: { runStatus: 'done', result: 'red', plotId: 'a' },
    };
    const [r] = rows({ plots: [plot('a')], assessments: [foreign] });
    expect(r.bucket).toBe('pending');
  });
});

describe('rowHeading', () => {
  it('规则同屏 2：有地契读到 lotNo → Lot {lotNo}, {district}；读不到回退；没有地契 Lot baharu', () => {
    const [a, none, missing] = rows({
      plots: [
        plot('a'),
        plot('n', { landTitleId: null }),
        plot('m', { landTitleId: 't-ghost', titleNo: 'GRN 9', district: 'Segamat' }),
      ],
    });
    expect(rowHeading(ms, a)).toBe('Lot 507, Kampar');
    expect(rowHeading(ms, none)).toBe('Lot baharu');
    expect(rowHeading(ms, missing)).toBe('GRN 9, Segamat');
  });
});

describe('sortRows', () => {
  const mk = (
    id: string,
    bucket: DashboardRow['bucket'],
    updated: string | null,
  ): DashboardRow => ({
    id,
    plot: {},
    title: null,
    member: null,
    bucket,
    concluded: null,
    gaps: [],
    forestLoss: false,
    categories: [],
    updated: updated ? d(updated) : null,
  });

  it('红色最前：red → needs_review → yellow → pending → running → green', () => {
    const sorted = sortRows(
      BUCKETS.slice()
        .reverse()
        .map((b) => mk(b, b, null)),
    );
    expect(sorted.map((r) => r.bucket)).toEqual([...BUCKETS]);
  });

  it('同桶按时间新→旧，没有时间的排最后，时间相同按 id；与输入顺序无关', () => {
    const input = [
      mk('c', 'red', '2026-10-01T00:00:00Z'),
      mk('d', 'red', null),
      mk('b', 'red', '2026-10-05T00:00:00Z'),
      mk('a', 'red', '2026-10-01T00:00:00Z'),
    ];
    expect(sortRows(input).map((r) => r.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(sortRows([...input].reverse()).map((r) => r.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('不改动传入的数组', () => {
    const input = [mk('b', 'green', null), mk('a', 'red', null)];
    sortRows(input);
    expect(input.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('mainIssue／rowTexts', () => {
  const [multi, forestOnly, clean] = rows({
    plots: [plot('a'), plot('b', { landTitleId: null }), plot('c', { landTitleId: null })],
    assessments: [
      assessment('1', 'a', {
        gaps: [
          gap('area_mismatch', 'medium'),
          gap('expired', 'high', 'mpob_licence'),
          gap('missing_doc', 'medium', 'mspo_cert'),
        ],
        ruleResults: [{ ruleCode: 'CC-02', result: 'fail', actualValue: '2026-04-30 已过期' }],
      }),
      assessment('2', 'b', { forestRisk: 'medium', forestLossAfter2020Ha: 0.45 }),
      assessment('3', 'c', { result: 'green' }),
    ],
  });

  it('最重的缺口当主问题，多于一件带 +n', () => {
    expect(mainIssue(ms, 'ms', multi)).toEqual({ text: 'Lesen MPOB sudah tamat', more: 2 });
    expect(rowTexts(ms, 'ms', multi).mainIssue).toBe('Lesen MPOB sudah tamat (+2)');
    expect(rowTexts(en, 'en', multi).mainIssue).toBe('MPOB licence has expired (+2)');
  });

  it('没有缺口但森林有损失：写森林；都没有：null', () => {
    expect(mainIssue(ms, 'ms', forestOnly)).toEqual({
      text: 'Kemungkinan kehilangan hutan selepas 2020',
      more: 0,
    });
    expect(mainIssue(ms, 'ms', clean)).toBeNull();
    expect(rowTexts(ms, 'ms', clean).mainIssue).toBeNull();
  });

  it('rowTexts：状态标签、日期（本地与 YYYY-MM-DD）、地区；不含缺口自带的任何文字', () => {
    const x = rowTexts(ms, 'ms', multi);
    expect(x.plot).toBe('Lot 507, Kampar');
    expect(x.status).toBe(ms.status.yellow);
    expect(x.updated).toBe('3 Okt');
    expect(x.updatedYmd).toBe('2026-10-03');
    expect(x.district).toBe('Kampar');
  });
});

describe('filterRows／计数', () => {
  const all = sortRows(
    rows({
      plots: [plot('a'), plot('b'), plot('c', { operatorPersonId: 'ghost' }), plot('d')],
      assessments: [
        assessment('1', 'a', {
          result: 'yellow',
          gaps: [gap('area_mismatch'), gap('expiring', 'medium', 'mpob_licence')],
        }),
        assessment('2', 'b', {
          result: 'red',
          gaps: [gap('name_mismatch', 'high', 'land_title')],
          forestRisk: 'high',
          forestLossAfter2020Ha: 0.8,
        }),
        assessment('3', 'c', { result: 'red', gaps: [gap('area_mismatch', 'high')] }),
      ],
    }),
  );
  const ids = (f: Partial<DashboardFilter>) =>
    filterRows(all, { ...EMPTY_FILTER, ...f }).map((r) => r.id);

  it('没有条件：全部', () => {
    expect(ids({})).toHaveLength(4);
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
  });

  it('状态单选', () => {
    expect(ids({ status: 'red' }).sort()).toEqual(['b', 'c']);
    expect(ids({ status: 'pending' })).toEqual(['d']);
    expect(ids({ status: 'green' })).toEqual([]);
  });

  it('问题类型多选：同类 OR（有其中任一类就算）', () => {
    expect(ids({ issues: ['area'] }).sort()).toEqual(['a', 'c']);
    expect(ids({ issues: ['area', 'name'] }).sort()).toEqual(['a', 'b', 'c']);
    expect(ids({ issues: ['forest'] })).toEqual(['b']);
    expect(ids({ issues: ['expiry'] })).toEqual(['a']);
  });

  it('成员搜索：忽略大小写与标点；成员名读不到的搜不到', () => {
    expect(ids({ q: 'ahmad' })).toEqual(['a']);
    expect(ids({ q: 'a/l raman' })).toEqual(['b']);
    expect(ids({ q: 'ghost' })).toEqual([]);
    expect(ids({ q: 'pe-c' })).toEqual([]); // 不能靠 id 搜到
  });

  it('不同类条件 AND', () => {
    expect(ids({ status: 'red', issues: ['area'] })).toEqual(['c']);
    expect(ids({ status: 'red', issues: ['area'], q: 'muthu' })).toEqual([]);
    expect(isFilterEmpty({ ...EMPTY_FILTER, q: '  ' })).toBe(true);
    expect(isFilterEmpty({ ...EMPTY_FILTER, status: 'red' })).toBe(false);
  });

  it('计数恒为全部：各桶之和＝总数；问题类型按涉及的地块数', () => {
    const buckets = countBuckets(all);
    expect(buckets).toEqual({
      red: 2,
      needs_review: 0,
      yellow: 1,
      pending: 1,
      running: 0,
      green: 0,
    });
    expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(all.length);
    expect(countIssues(all)).toEqual({
      area: 2,
      expiry: 1,
      name: 1,
      missing: 0,
      mspo: 0,
      unclear: 0,
      forest: 1,
    });
  });
});

describe('parseFilter／filterToParams', () => {
  const params = (o: Record<string, string>) => (k: string) => o[k] ?? null;

  it('往返：序列化再解析得到同一个条件', () => {
    const f: DashboardFilter = { status: 'red', issues: ['expiry', 'area'], q: 'ahmad zaki' };
    const p = filterToParams(f);
    expect(p).toEqual({ status: 'red', issue: 'area,expiry', q: 'ahmad zaki' });
    expect(parseFilter(params({ status: p.status!, issue: p.issue!, q: p.q! }))).toEqual({
      status: 'red',
      issues: ['area', 'expiry'],
      q: 'ahmad zaki',
    });
  });

  it('空条件序列化成 null（从地址里去掉）', () => {
    expect(filterToParams(EMPTY_FILTER)).toEqual({ status: null, issue: null, q: null });
    expect(filterToParams({ ...EMPTY_FILTER, q: '   ' }).q).toBeNull();
  });

  it('非法值忽略：未知状态、未知类别；类别去重并按固定顺序；q 限长', () => {
    expect(
      parseFilter(params({ status: 'purple', issue: 'bogus,,area,area,forest,AREA' })),
    ).toEqual({
      status: null,
      issues: ['area', 'forest'],
      q: '',
    });
    expect(parseFilter(params({ q: 'x'.repeat(500) })).q).toHaveLength(100);
    expect(parseFilter(params({}))).toEqual(EMPTY_FILTER);
  });

  it('所有桶和类别都能被解析', () => {
    for (const b of BUCKETS) expect(parseFilter(params({ status: b })).status).toBe(b);
    expect(parseFilter(params({ issue: ISSUE_CATEGORIES.join(',') })).issues).toEqual([
      ...ISSUE_CATEGORIES,
    ]);
  });
});

describe('CSV', () => {
  it('csvCell：普通文本原样；含逗号、引号、换行的加引号并把引号写两遍', () => {
    expect(csvCell('Lot 507, Kampar')).toBe('"Lot 507, Kampar"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('')).toBe('');
  });

  it("csvCell：以 = + - @ Tab CR 开头的前面加 '（防公式注入），再按需加引号", () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) {
      expect(csvCell(bad).replace(/^"/, '').startsWith("'"), JSON.stringify(bad)).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell('a=b')).toBe('a=b'); // 不在开头就不用动
    expect(csvCell('2026-10-03')).toBe('2026-10-03');
  });

  it('toCsv：UTF-8 BOM、CRLF、末尾换行；空表只有表头', () => {
    const out = toCsv(['A', 'B'], [['1', 'x,y']]);
    expect(out).toBe('﻿A,B\r\n1,"x,y"\r\n');
    expect(toCsv(['A'], [])).toBe('﻿A\r\n');
  });

  it('summaryCsv：当前筛选后的行；表头与状态、主问题按语言；成员名防公式注入；不含 id、gapCode、证件信息', () => {
    const list = sortRows(
      rows({
        plots: [plot('a'), plot('c', { operatorPersonId: 'pe-c', landTitleId: null })],
        assessments: [
          assessment('1', 'a', { gaps: [gap('area_mismatch')] }),
          assessment('2', 'c', { result: 'green' }),
        ],
      }),
    );
    const csv = summaryCsv(en, 'en', list);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Plot,District,Member,Status,Main issue,Updated');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      '"Lot 507, Kampar",Kampar,Ahmad Zaki bin Rosli,Needs review,The areas don\'t match,2026-10-03',
    );
    // 成员名以 = 开头：前面加了 '，且因为含引号和逗号整格加引号
    expect(lines[2]).toContain('"\'=Hyperlink(""Http://Evil"")"');
    expect(csv).not.toMatch(/pe-|area_mismatch|plotId|icHash|icLast4/);

    const bm = summaryCsv(ms, 'ms', list);
    expect(bm.split('\r\n')[0]).toBe('﻿Tanah,Daerah,Ahli,Status,Masalah utama,Dikemas kini');
    expect(bm).toContain('Keluasan tidak sepadan');
  });

  it('summaryCsv：没有行时只有表头', () => {
    expect(summaryCsv(ms, 'ms', []).trim().split('\r\n')).toHaveLength(1);
  });
});
