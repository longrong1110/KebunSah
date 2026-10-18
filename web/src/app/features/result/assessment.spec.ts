import {
  areaCompare,
  assessmentTime,
  bannerKey,
  checkedAt,
  concludedAssessment,
  forestNote,
  formatDiff,
  gapFacts,
  latestAssessment,
  openGaps,
  parseDays,
  parseHa,
  passedRules,
  type AssessmentData,
  type AssessmentItem,
  worstResult,
} from './assessment';

const d = (iso: string) => new Date(iso);
const item = (id: string, data: AssessmentData): AssessmentItem => ({ id, data });

describe('latestAssessment', () => {
  it('没有评估：null', () => {
    expect(latestAssessment([])).toBeNull();
  });

  it('按 createdAt 新→旧取第一条，不论状态：最新一次还在跑就是它，不退回旧的 done', () => {
    const items = [
      item('a', { runStatus: 'done', result: 'green', createdAt: d('2026-10-01T00:00:00Z') }),
      item('b', { runStatus: 'running', createdAt: d('2026-10-05T00:00:00Z') }),
      item('c', { runStatus: 'done', result: 'red', createdAt: d('2026-09-01T00:00:00Z') }),
    ];
    expect(latestAssessment(items)?.id).toBe('b');
  });

  it('缺 createdAt 用 startedAt、再缺用 finishedAt；没有任何时间的排最后', () => {
    expect(assessmentTime({ startedAt: d('2026-10-02T00:00:00Z') })).toBe(
      d('2026-10-02T00:00:00Z').getTime(),
    );
    expect(assessmentTime({ finishedAt: d('2026-10-03T00:00:00Z') })).toBe(
      d('2026-10-03T00:00:00Z').getTime(),
    );
    expect(assessmentTime({})).toBeNull();
    expect(assessmentTime({ createdAt: new Date('x') })).toBeNull();

    const items = [item('none', {}), item('t', { startedAt: d('2026-10-02T00:00:00Z') })];
    expect(latestAssessment(items)?.id).toBe('t');
  });

  it('时间相同按 id，每次选出同一条（与输入顺序无关）', () => {
    const t = d('2026-10-01T00:00:00Z');
    const a = item('a', { createdAt: t });
    const b = item('b', { createdAt: t });
    expect(latestAssessment([b, a])?.id).toBe('a');
    expect(latestAssessment([a, b])?.id).toBe('a');
  });
});

describe('bannerKey', () => {
  it('没有评估：Belum mula，不凭别的下结论', () => {
    expect(bannerKey(null)).toBe('pending');
  });

  it('done 且 result 是四种结论之一：就是它', () => {
    for (const r of ['green', 'yellow', 'red', 'needs_review'] as const) {
      expect(bannerKey({ runStatus: 'done', result: r })).toBe(r);
    }
  });

  it('queued／running：Sedang disemak，哪怕带着旧的 result', () => {
    expect(bannerKey({ runStatus: 'queued' })).toBe('running');
    expect(bannerKey({ runStatus: 'running', result: 'green' })).toBe('running');
  });

  it('failed、result 缺失或未知：按需人工复核，不当成通过', () => {
    expect(bannerKey({ runStatus: 'failed', result: 'green' })).toBe('needs_review');
    expect(bannerKey({ runStatus: 'done' })).toBe('needs_review');
    expect(bannerKey({ runStatus: 'done', result: 'purple' })).toBe('needs_review');
    expect(bannerKey({})).toBe('needs_review');
  });
});

describe('concludedAssessment', () => {
  it('没有评估、还在跑（queued／running）、失败（failed）：不下结论，返回 null', () => {
    expect(concludedAssessment(null)).toBeNull();
    for (const runStatus of ['queued', 'running', 'failed']) {
      expect(concludedAssessment({ runStatus, result: 'green' }), runStatus).toBeNull();
    }
  });

  it('done，或 runStatus 缺失／未知：原样返回（结论缺失的由 bannerKey 兜成需人工复核）', () => {
    const done = { runStatus: 'done', result: 'yellow' };
    expect(concludedAssessment(done)).toBe(done);
    const unknown = { result: 'red' };
    expect(concludedAssessment(unknown)).toBe(unknown);
  });
});

describe('checkedAt', () => {
  it('finishedAt，缺则 startedAt，都没有或无效为 null', () => {
    expect(checkedAt({ finishedAt: d('2026-10-03T02:24:00Z') })?.toISOString()).toBe(
      '2026-10-03T02:24:00.000Z',
    );
    expect(checkedAt({ startedAt: d('2026-10-03T02:22:00Z') })?.toISOString()).toBe(
      '2026-10-03T02:22:00.000Z',
    );
    expect(checkedAt({})).toBeNull();
    expect(checkedAt({ finishedAt: new Date('x') })).toBeNull();
  });
});

describe('openGaps', () => {
  it('只列 open 的；没写 status 也算没解决；其他状态（如 closed）不列', () => {
    const gaps = openGaps({
      gaps: [
        { gapCode: 'area_mismatch', severity: 'medium', status: 'open' },
        { gapCode: 'expired', severity: 'high', status: 'closed' },
        { gapCode: 'missing_doc', severity: 'medium' },
      ],
    });
    expect(gaps.map((g) => g.code)).toEqual(['area_mismatch', 'missing_doc']);
  });

  it('按轻重排：high → medium → low → 其他，同级保持原顺序', () => {
    const gaps = openGaps({
      gaps: [
        { gapCode: 'expiring', severity: 'low', status: 'open' },
        { gapCode: 'not_in_mspo', severity: 'medium', status: 'open' },
        { gapCode: 'weird', severity: 'banana', status: 'open' },
        { gapCode: 'name_mismatch', severity: 'high', status: 'open' },
        { gapCode: 'area_mismatch', severity: 'medium', status: 'open' },
      ],
    });
    expect(gaps.map((g) => g.code)).toEqual([
      'name_mismatch',
      'not_in_mspo',
      'area_mismatch',
      'expiring',
      'weird',
    ]);
  });

  it('known 只对已知 gapCode 有值；缺失的 gapCode 记为 unknown', () => {
    const gaps = openGaps({ gaps: [{ gapCode: 'area_mismatch' }, { gapCode: 'x' }, {}] });
    expect(gaps.map((g) => g.known)).toEqual(['area_mismatch', null, null]);
    expect(gaps[2].code).toBe('unknown');
  });

  it('key：gapCode 唯一就用 gapCode；同 gapCode 不同 docType 分项并带上 docType', () => {
    const gaps = openGaps({
      gaps: [
        { gapCode: 'low_confidence', docType: 'land_title', severity: 'medium', status: 'open' },
        { gapCode: 'low_confidence', docType: 'mpob_licence', severity: 'medium', status: 'open' },
        { gapCode: 'expired', docType: 'mpob_licence', severity: 'high', status: 'open' },
      ],
    });
    expect(gaps.map((g) => g.key).sort()).toEqual([
      'expired',
      'low_confidence~land_title',
      'low_confidence~mpob_licence',
    ]);
  });

  it('key 不随轻重变化（按原顺序生成），并且同码同 docType 也不冲突', () => {
    const a = openGaps({
      gaps: [
        { gapCode: 'low_confidence', docType: 'land_title', severity: 'low', status: 'open' },
        { gapCode: 'low_confidence', docType: 'land_title', severity: 'high', status: 'open' },
      ],
    });
    expect(a.map((g) => g.key)).toEqual([
      'low_confidence~land_title~2',
      'low_confidence~land_title',
    ]);
    expect(new Set(a.map((g) => g.key)).size).toBe(2);
  });

  it('没有 gaps：空数组', () => {
    expect(openGaps({})).toEqual([]);
    expect(openGaps({ gaps: [] })).toEqual([]);
  });
});

describe('parseHa／parseDays', () => {
  it('parseHa：认得 "3.0400 ha"、"3.04"、数字；其余一律 null', () => {
    expect(parseHa('3.0400 ha')).toBe(3.04);
    expect(parseHa(' 4 HA ')).toBe(4);
    expect(parseHa('0')).toBe(0);
    expect(parseHa(2.5)).toBe(2.5);
    for (const bad of [
      '',
      'ha',
      '2026-04-30',
      '>= 90 天',
      '-1 ha',
      'Beza 0.09 ha',
      null,
      undefined,
      {},
    ]) {
      expect(parseHa(bad), String(bad)).toBeNull();
    }
    expect(parseHa(-1)).toBeNull();
    expect(parseHa(NaN)).toBeNull();
  });

  it('parseDays："58 天"、"58 hari"、"58 days"；其余 null', () => {
    expect(parseDays('58 天')).toBe(58);
    expect(parseDays('58 hari')).toBe(58);
    expect(parseDays('1 day')).toBe(1);
    for (const bad of ['2026-04-30 已过期', '>= 90 天', '', '天', null, 58]) {
      expect(parseDays(bad), String(bad)).toBeNull();
    }
  });
});

const CC01 = (expectedValue: string | null, actualValue: string | null) => ({
  ruleCode: 'CC-01',
  result: 'warn',
  expectedValue,
  actualValue,
});

describe('areaCompare／formatDiff', () => {
  it('取 CC-01：差值与百分比（多出为正、少于为负）', () => {
    const more = areaCompare({ ruleResults: [CC01('3.0400 ha', '3.4900 ha')] })!;
    expect(more.diffHa).toBeCloseTo(0.45);
    expect(more.pct).toBe(15);
    expect(formatDiff(more)).toBe('+0.45 ha (15%)');

    const less = areaCompare({ ruleResults: [CC01('2.0000 ha', '1.5000 ha')] })!;
    expect(formatDiff(less)).toBe('−0.5 ha (25%)');
  });

  it('线框里的例子：1.6 → 2.1 是 +0.5 ha (31%)', () => {
    expect(formatDiff(areaCompare({ ruleResults: [CC01('1.6 ha', '2.1 ha')] })!)).toBe(
      '+0.5 ha (31%)',
    );
  });

  it('读不全就是 null：没有 CC-01、缺值、解析不了；不显示 NaN', () => {
    expect(areaCompare({})).toBeNull();
    expect(areaCompare({ ruleResults: [CC01(null, '3 ha')] })).toBeNull();
    expect(areaCompare({ ruleResults: [CC01('3 ha', '一些')] })).toBeNull();
    expect(areaCompare({ ruleResults: [{ ruleCode: 'CC-02', actualValue: '3 ha' }] })).toBeNull();
  });

  it('地契面积为 0：不能除，只写公顷；差小到四舍五入成 0：不显示', () => {
    const zero = areaCompare({ ruleResults: [CC01('0 ha', '2 ha')] })!;
    expect(zero.pct).toBeNull();
    expect(formatDiff(zero)).toBe('+2 ha');
    expect(formatDiff(areaCompare({ ruleResults: [CC01('3.000 ha', '3.004 ha')] })!)).toBeNull();
  });
});

describe('gapFacts', () => {
  const gap = (code: string) => openGaps({ gaps: [{ gapCode: code, status: 'open' }] })[0];
  const a: AssessmentData = {
    ruleResults: [
      CC01('3.0400 ha', '3.4900 ha'),
      { ruleCode: 'CC-02', result: 'warn', actualValue: '58 天' },
    ],
  };

  it('area_mismatch：地契与量出的面积（格式化）；其余字段 null', () => {
    expect(gapFacts(a, gap('area_mismatch'), 'ms')).toEqual({
      geran: '3.04',
      lukisan: '3.49',
      days: null,
      date: null,
    });
  });

  it('expiring：剩余天数；日期解析不出来就是 null', () => {
    expect(gapFacts(a, gap('expiring'), 'ms')).toEqual({
      geran: null,
      lukisan: null,
      days: 58,
      date: null,
    });
  });

  it('expired："2026-04-30 已过期" 按语言格式化成日期；天数 null', () => {
    const expired: AssessmentData = {
      ruleResults: [{ ruleCode: 'CC-02', result: 'fail', actualValue: '2026-04-30 已过期' }],
    };
    expect(gapFacts(expired, gap('expired'), 'ms')).toMatchObject({
      days: null,
      date: '30 Apr 2026',
    });
    expect(gapFacts(expired, gap('expired'), 'en').date).toBe('30 Apr 2026');
    const may: AssessmentData = {
      ruleResults: [{ ruleCode: 'CC-02', result: 'fail', actualValue: '2026-05-09 已过期' }],
    };
    expect(gapFacts(may, gap('expired'), 'ms').date).toBe('9 Mei 2026');
    expect(gapFacts(may, gap('expired'), 'en').date).toBe('9 May 2026');
  });

  it('别的类别和未知类别：全是 null，不串味', () => {
    for (const code of ['name_mismatch', 'not_in_mspo', 'low_confidence', 'missing_doc', 'zzz']) {
      expect(gapFacts(a, gap(code), 'ms'), code).toEqual({
        geran: null,
        lukisan: null,
        days: null,
        date: null,
      });
    }
  });

  it('同一评估里不止一件到期类缺口：CC-02 只有一条，分不清是哪份文件，不带数字（不张冠李戴）', () => {
    const two: AssessmentData = {
      ruleResults: [{ ruleCode: 'CC-02', result: 'warn', actualValue: '58 天' }],
      gaps: [
        { gapCode: 'expiring', docType: 'mpob_licence', severity: 'medium', status: 'open' },
        { gapCode: 'expiring', docType: 'mspo_cert', severity: 'medium', status: 'open' },
      ],
    };
    const [first, second] = openGaps(two);
    expect(gapFacts(two, first, 'ms')).toMatchObject({ days: null, date: null });
    expect(gapFacts(two, second, 'ms')).toMatchObject({ days: null, date: null });

    // expiring 与 expired 混在一起也一样
    const mixed: AssessmentData = {
      ruleResults: [{ ruleCode: 'CC-02', result: 'fail', actualValue: '2026-04-30 已过期' }],
      gaps: [
        { gapCode: 'expired', docType: 'mpob_licence', status: 'open' },
        { gapCode: 'expiring', docType: 'mspo_cert', status: 'open' },
      ],
    };
    for (const g of openGaps(mixed)) expect(gapFacts(mixed, g, 'ms').date).toBeNull();

    // 另一件已解决后只剩一件：数字回来
    const one = { ...two, gaps: [two.gaps![0], { ...two.gaps![1], status: 'closed' }] };
    expect(gapFacts(one, openGaps(one)[0], 'ms').days).toBe(58);
  });

  it('规则缺失：不崩，全是 null', () => {
    expect(gapFacts({}, gap('area_mismatch'), 'ms')).toEqual({
      geran: null,
      lukisan: null,
      days: null,
      date: null,
    });
    expect(gapFacts({}, gap('expired'), 'ms').date).toBeNull();
  });
});

describe('passedRules', () => {
  it('只数 result = pass 的规则，去重，缺失的规则不算', () => {
    expect(
      passedRules({
        ruleResults: [
          { ruleCode: 'CC-01', result: 'pass' },
          { ruleCode: 'CC-02', result: 'warn' },
          { ruleCode: 'CC-03', result: 'pass' },
          { ruleCode: 'CC-03', result: 'pass' },
          { result: 'pass' },
        ],
      }),
    ).toEqual(['CC-01', 'CC-03']);
    expect(passedRules({})).toEqual([]);
  });

  it('CC-02 每份文件一行：每一行都通过才算通过（有一行没过就不算）', () => {
    const rows = (a: string, b: string): AssessmentData => ({
      ruleResults: [
        { ruleCode: 'CC-02', docType: 'mpob_licence', result: a },
        { ruleCode: 'CC-02', docType: 'mspo_cert', result: b },
      ],
    });
    expect(passedRules(rows('pass', 'pass'))).toEqual(['CC-02']);
    expect(passedRules(rows('pass', 'warn'))).toEqual([]);
    expect(passedRules(rows('warn', 'pass'))).toEqual([]);
    expect(passedRules(rows('pass', 'needs_review'))).toEqual([]);
  });
});

describe('worstResult', () => {
  it('同一编号取最重的：fail > needs_review > warn > pass；没有这个编号是 undefined', () => {
    const a: AssessmentData = {
      ruleResults: [
        { ruleCode: 'CC-02', result: 'pass' },
        { ruleCode: 'CC-02', result: 'fail' },
        { ruleCode: 'CC-02', result: 'warn' },
        { ruleCode: 'CC-03', result: 'pass' },
      ],
    };
    expect(worstResult(a, 'CC-02')).toBe('fail');
    expect(worstResult(a, 'CC-03')).toBe('pass');
    expect(worstResult(a, 'CC-01')).toBeUndefined();
    expect(
      worstResult(
        {
          ruleResults: [
            { ruleCode: 'CC-02', result: 'warn' },
            { ruleCode: 'CC-02', result: 'needs_review' },
          ],
        },
        'CC-02',
      ),
    ).toBe('needs_review');
    expect(
      worstResult(
        {
          ruleResults: [
            { ruleCode: 'CC-02', result: 'pass' },
            { ruleCode: 'CC-02', result: 'weird' },
          ],
        },
        'CC-02',
      ),
    ).toBe('weird');
  });
});

describe('gapFacts：CC-02 每份文件一行（带 docType）', () => {
  const a: AssessmentData = {
    ruleResults: [
      { ruleCode: 'CC-02', docType: 'mpob_licence', result: 'warn', actualValue: '49 hari' },
      { ruleCode: 'CC-02', docType: 'mspo_cert', result: 'pass', actualValue: '865 hari' },
    ],
    gaps: [{ gapCode: 'expiring', docType: 'mpob_licence', severity: 'medium', status: 'open' }],
  };

  it('按缺口的 docType 取那一份的天数，不取别的文件的', () => {
    expect(gapFacts(a, openGaps(a)[0], 'ms').days).toBe(49);
    // 第一行是通过的证书、缺口说的是执照：不能取第一行
    const swapped: AssessmentData = { ...a, ruleResults: [...a.ruleResults!].reverse() };
    expect(gapFacts(swapped, openGaps(swapped)[0], 'ms').days).toBe(49);
  });

  it('不止一件到期类缺口：各取各的，不再因为分不清而丢掉数字', () => {
    const two: AssessmentData = {
      ruleResults: [
        { ruleCode: 'CC-02', docType: 'mpob_licence', result: 'warn', actualValue: '49 hari' },
        {
          ruleCode: 'CC-02',
          docType: 'mspo_cert',
          result: 'fail',
          actualValue: '2026-04-30 telah tamat',
        },
      ],
      gaps: [
        { gapCode: 'expiring', docType: 'mpob_licence', severity: 'medium', status: 'open' },
        { gapCode: 'expired', docType: 'mspo_cert', severity: 'high', status: 'open' },
      ],
    };
    const byCode = Object.fromEntries(openGaps(two).map((g) => [g.code, gapFacts(two, g, 'ms')]));
    expect(byCode['expiring'].days).toBe(49);
    expect(byCode['expired'].date).toBe('30 Apr 2026');
  });

  it('缺口的 docType 在行里找不到（缺文件那一类）：不猜', () => {
    const miss: AssessmentData = {
      ruleResults: a.ruleResults,
      gaps: [{ gapCode: 'expiring', docType: 'land_title', severity: 'medium', status: 'open' }],
    };
    expect(gapFacts(miss, openGaps(miss)[0], 'ms')).toMatchObject({ days: null, date: null });
  });
});

describe('forestNote', () => {
  it('low 且损失明确为 0：没有损失', () => {
    expect(forestNote({ forestRisk: 'low', forestLossAfter2020Ha: 0 })).toEqual({ kind: 'low' });
  });

  it('medium／high：按有损失处理；带公顷数（>0 时）', () => {
    expect(forestNote({ forestRisk: 'medium', forestLossAfter2020Ha: 0.45 })).toEqual({
      kind: 'loss',
      ha: '0.45',
    });
    expect(forestNote({ forestRisk: 'high', forestLossAfter2020Ha: 1.234 })).toEqual({
      kind: 'loss',
      ha: '1.23',
    });
    expect(forestNote({ forestRisk: 'high' })).toEqual({ kind: 'loss', ha: null });
  });

  it('low 但损失 > 0（数据矛盾）：按有损失处理，不说「没有」', () => {
    expect(forestNote({ forestRisk: 'low', forestLossAfter2020Ha: 0.3 })).toEqual({
      kind: 'loss',
      ha: '0.3',
    });
  });

  it('缺失、unknown、null、low 但损失没填：不当成 0，也不说「没有」', () => {
    expect(forestNote({})).toEqual({ kind: 'unknown' });
    expect(forestNote({ forestRisk: 'unknown' })).toEqual({ kind: 'unknown' });
    expect(forestNote({ forestRisk: null, forestLossAfter2020Ha: null })).toEqual({
      kind: 'unknown',
    });
    expect(forestNote({ forestRisk: 'low' })).toEqual({ kind: 'unknown' });
    expect(forestNote({ forestRisk: 'low', forestLossAfter2020Ha: null })).toEqual({
      kind: 'unknown',
    });
  });
});

describe('forestNote：演示数据不下结论', () => {
  it('forestDataset = precomputed-demo：不管风险和数值写什么，都是 demo（不说「没有毁林」）', () => {
    const demo = { forestDataset: 'precomputed-demo' };
    expect(forestNote({ ...demo, forestRisk: 'low', forestLossAfter2020Ha: 0 })).toEqual({
      kind: 'demo',
    });
    expect(forestNote({ ...demo, forestRisk: 'high', forestLossAfter2020Ha: 2 })).toEqual({
      kind: 'demo',
    });
    expect(forestNote({ ...demo })).toEqual({ kind: 'demo' });
  });

  it('别的数据来源（真的查询）：照常判断', () => {
    expect(
      forestNote({ forestDataset: 'JRC/GFC2020', forestRisk: 'low', forestLossAfter2020Ha: 0 }),
    ).toEqual({ kind: 'low' });
    expect(
      forestNote({ forestDataset: null, forestRisk: 'low', forestLossAfter2020Ha: 0 }),
    ).toEqual({
      kind: 'low',
    });
  });
});
