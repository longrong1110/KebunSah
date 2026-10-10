import { en } from '../../core/i18n/dict.en';
import { ms } from '../../core/i18n/dict.ms';
import { CJK, assessment, gap, polygonGeojson, rules } from '../../../testing/assessment-fixtures';
import type { PlotData, TitleData } from '../plots/plot-types';
import type { AssessmentData, AssessmentItem } from '../result/assessment';
import {
  DASH,
  MAX_VERTICES,
  buildDossier,
  cleanText,
  type DossierDocument,
  type DossierInput,
} from './dossier';

const asData = (over: Record<string, unknown> = {}) => assessment(over) as AssessmentData;
const item = (id: string, data: AssessmentData): AssessmentItem => ({ id, data });

const title: TitleData = {
  lotNo: '2217',
  titleNo: 'HSM 2217/91',
  mukim: 'Kampar',
  district: 'Kampar',
  state: 'Perak',
  tenure: 'freehold',
  landUseCategory: 'agriculture',
};

const plotData = (over: Partial<PlotData> = {}): PlotData => ({
  landTitleId: 't1',
  nickname: 'Kebun Arwah Ayah',
  district: 'Kampar',
  state: 'Perak',
  titleNo: 'HSM 2217/91',
  countryCode: 'MY',
  areaHaComputed: 3.49,
  centroidLat: 4.31,
  centroidLng: 101.15,
  oilPalmPlantedYear: 2012,
  geometryRecordedAt: new Date('2026-10-03T02:20:00Z'),
  polygonGeojson,
  isSynthetic: true,
  ...over,
});

const docs: DossierDocument[] = [
  { docType: 'land_title', pageNo: 1, isCurrent: true, extractionStatus: 'extracted' },
  { docType: 'land_title', pageNo: 2, isCurrent: true, extractionStatus: 'extracted' },
  { docType: 'land_title', pageNo: 3, isCurrent: false, extractionStatus: 'failed' },
  { docType: 'mpob_licence', pageNo: 1, isCurrent: true, extractionStatus: 'needs_review' },
  { docType: 'mspo_cert', pageNo: 1, isCurrent: true, extractionStatus: 'extracted' },
  { docType: 'ic_card', pageNo: 1, isCurrent: true, extractionStatus: 'extracted' },
];

const input = (over: Partial<DossierInput> = {}): DossierInput => ({
  plot: plotData(),
  title,
  person: { fullName: 'AHMAD ZAKI BIN ROSLI' },
  coop: { name: 'Koperasi Pekebun Kecil Contoh (虚构)' },
  mpob: { licenceNo: '810212345678', validUntil: '2026-12-05' },
  mspo: { certNo: 'MSPO 900001', expiryDate: '2029-02-28' },
  assessments: [item('a1', asData())],
  documents: docs,
  generatedAt: new Date('2026-10-10T04:00:00Z'),
  ...over,
});

const build = (over: Partial<DossierInput> = {}) => buildDossier(ms, 'ms', input(over));
const infoOf = (m: ReturnType<typeof build>, key: string) =>
  m.info.find((r) => r.key === key)?.value;

describe('cleanText', () => {
  it('去掉含中文的括号段，剩下的留着', () => {
    expect(cleanText('Koperasi Pekebun Kecil Contoh (虚构)')).toBe('Koperasi Pekebun Kecil Contoh');
    expect(cleanText('Contoh Sdn. Bhd. （虚构）')).toBe('Contoh Sdn. Bhd.');
  });

  it('整段是中文、为空、过长、不是字符串：null', () => {
    expect(cleanText('中文名')).toBeNull();
    expect(cleanText('Kebun 中文')).toBeNull();
    expect(cleanText('   ')).toBeNull();
    expect(cleanText('x'.repeat(81))).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(42)).toBeNull();
  });
});

describe('buildDossier：页头', () => {
  it('标题、地块标题、生成日期（UTC+8）、合作社名（去掉中文括号）、模拟数据提示', () => {
    const h = build().header;
    expect(h.title).toBe('Dossier pematuhan tanah');
    expect(h.heading).toBe('Lot 2217, Kampar');
    expect(h.generatedOn).toBe('Dijana pada 2026-10-10');
    expect(h.coop).toBe('Koperasi Pekebun Kecil Contoh');
    expect(h.synthetic).toBe('Data simulasi (CONTOH) — bukan data sebenar');
  });

  it('不是模拟数据：没有提示；合作社读不到：null；生成时间无效：不写日期', () => {
    const h = build({
      plot: plotData({ isSynthetic: false }),
      coop: null,
      generatedAt: new Date('x'),
    }).header;
    expect(h.synthetic).toBeNull();
    expect(h.coop).toBeNull();
    expect(h.generatedOn).toBeNull();
  });

  it('地块标题：没登记地契 → Lot baharu；地契读不到 → 用 plots 上复制的地契号；都没有 → Belum diisi；从不用 nickname', () => {
    expect(build({ plot: plotData({ landTitleId: null }) }).header.heading).toBe('Lot baharu');
    expect(build({ title: null }).header.heading).toBe('HSM 2217/91, Kampar');
    const bare = build({ title: null, plot: plotData({ titleNo: null, district: null }) });
    expect(bare.header.heading).toBe('Belum diisi');
    expect(JSON.stringify(bare)).not.toContain('Arwah');
  });

  it('英文', () => {
    const h = buildDossier(en, 'en', input()).header;
    expect(h.title).toBe('Land compliance dossier');
    expect(h.generatedOn).toBe('Generated on 2026-10-10');
    expect(h.synthetic).toBe('Simulated data (SAMPLE) — not real data');
  });
});

describe('buildDossier：信息表', () => {
  it('地契优先；国家、成员名词首大写、面积、权属与用途翻译、种植年份、边界记录日期', () => {
    const m = build();
    expect(infoOf(m, 'lot')).toBe('2217');
    expect(infoOf(m, 'titleNo')).toBe('HSM 2217/91');
    expect(infoOf(m, 'mukim')).toBe('Kampar');
    expect(infoOf(m, 'district')).toBe('Kampar');
    expect(infoOf(m, 'state')).toBe('Perak');
    expect(infoOf(m, 'country')).toBe('Malaysia');
    expect(infoOf(m, 'operator')).toBe('Ahmad Zaki bin Rosli');
    expect(infoOf(m, 'coop')).toBe('Koperasi Pekebun Kecil Contoh');
    expect(infoOf(m, 'area')).toBe('3.49 ha');
    expect(infoOf(m, 'planted')).toBe('2012');
    expect(infoOf(m, 'tenure')).toBe('Hak milik kekal (freehold)');
    expect(infoOf(m, 'landUse')).toBe('Pertanian');
    expect(infoOf(m, 'boundaryDate')).toBe('2026-10-03');
  });

  it('地契读不到：地契号、daerah、negeri 退回 plots 上复制的字段，lot 与 mukim 写「—」', () => {
    const m = build({ title: null });
    expect(infoOf(m, 'titleNo')).toBe('HSM 2217/91');
    expect(infoOf(m, 'district')).toBe('Kampar');
    expect(infoOf(m, 'state')).toBe('Perak');
    expect(infoOf(m, 'lot')).toBe(DASH);
    expect(infoOf(m, 'mukim')).toBe(DASH);
    expect(infoOf(m, 'tenure')).toBe(DASH);
  });

  it('面积：没有计算值用申报值；都没有写「—」', () => {
    expect(
      infoOf(build({ plot: plotData({ areaHaComputed: null, areaHaDeclared: 2.1 }) }), 'area'),
    ).toBe('2.1 ha');
    expect(
      infoOf(build({ plot: plotData({ areaHaComputed: null, areaHaDeclared: null }) }), 'area'),
    ).toBe(DASH);
  });

  it('不认得的权属与用途不写原文，成员、种植年份、日期读不到写「—」', () => {
    const m = build({
      title: { ...title, tenure: 'weird-tenure', landUseCategory: 'weird-use' },
      person: null,
      plot: plotData({ oilPalmPlantedYear: 1800, geometryRecordedAt: null, countryCode: 'SG' }),
    });
    expect(infoOf(m, 'tenure')).toBe(DASH);
    expect(infoOf(m, 'landUse')).toBe(DASH);
    expect(infoOf(m, 'operator')).toBe(DASH);
    expect(infoOf(m, 'planted')).toBe(DASH);
    expect(infoOf(m, 'boundaryDate')).toBe(DASH);
    expect(infoOf(m, 'country')).toBe('SG');
    expect(JSON.stringify(m)).not.toContain('weird');
  });

  it('英文标签与翻译', () => {
    const m = buildDossier(en, 'en', input());
    expect(m.info.find((r) => r.key === 'tenure')?.value).toBe('Freehold');
    expect(m.info.find((r) => r.key === 'landUse')?.value).toBe('Agriculture');
    expect(m.info.find((r) => r.key === 'operator')?.label).toBe('Operator');
  });
});

describe('buildDossier：位置', () => {
  it('中心点 6 位小数，顶点表去掉结尾重复点，有形状预览', () => {
    const l = build().location;
    expect(l.centroid).toBe('4.310000, 101.150000');
    expect(l.vertices).toEqual([
      { no: 1, lat: '4.309105', lng: '101.149037' },
      { no: 2, lat: '4.309105', lng: '101.150963' },
      { no: 3, lat: '4.310895', lng: '101.150963' },
      { no: 4, lat: '4.310895', lng: '101.149037' },
    ]);
    expect(l.more).toBeNull();
    expect(l.svgPoints).toMatch(/^[\d.,\s]+$/);
    expect(l.empty).toBe(false);
  });

  it('顶点超过上限：只列前 50 个并写还有多少', () => {
    const n = 60;
    const ring = Array.from({ length: n }, (_, i) => [
      101.15 + 0.001 * Math.cos((2 * Math.PI * i) / n),
      4.31 + 0.001 * Math.sin((2 * Math.PI * i) / n),
    ]);
    const geo = JSON.stringify({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });
    const l = build({ plot: plotData({ polygonGeojson: geo }) }).location;
    expect(l.vertices).toHaveLength(MAX_VERTICES);
    expect(l.more).toBe('…dan 10 lagi');
    expect(l.svgPoints?.split(' ')).toHaveLength(n);
  });

  it('多边形坏了：只写中心点，没有顶点表与预览', () => {
    const l = build({ plot: plotData({ polygonGeojson: 'not json' }) }).location;
    expect(l.centroid).toBe('4.310000, 101.150000');
    expect(l.vertices).toEqual([]);
    expect(l.svgPoints).toBeNull();
    expect(l.empty).toBe(false);
  });

  it('什么坐标都没有、或坐标越界：empty', () => {
    const none = plotData({ centroidLat: null, centroidLng: null, polygonGeojson: null });
    expect(build({ plot: none }).location.empty).toBe(true);
    const bad = plotData({ centroidLat: 91, centroidLng: 101, polygonGeojson: null });
    const l = build({ plot: bad }).location;
    expect(l.centroid).toBeNull();
    expect(l.empty).toBe(true);
  });
});

describe('buildDossier：摘要', () => {
  it('黄：用屏 9 的横幅文案与图标，带缺口数与评估日期', () => {
    const s = build().summary;
    expect(s.key).toBe('yellow');
    expect(s.icon).toBe('⚠');
    expect(s.tone).toBe('warn');
    expect(s.headline).toBe('Hampir siap');
    expect(s.sub).toBe('2 perkara perlu dibuat sebelum dokumen anda lengkap.');
    expect(s.checkedOn).toBe('Disemak pada 3 Okt 2026');
  });

  it('没有评估：Belum mula + 「Tanah ini belum diperiksa.」，不写规则、缺口、森林', () => {
    const m = build({ assessments: [] });
    expect(m.summary.key).toBe('pending');
    expect(m.summary.headline).toBe('Belum mula');
    expect(m.summary.sub).toBe('Tanah ini belum diperiksa.');
    expect(m.summary.checkedOn).toBeNull();
    expect(m.checks).toBeNull();
    expect(m.open).toBeNull();
    expect(m.forest).toBeNull();
  });

  it('最新一次还在检查：Sedang disemak，不写结论；失败：Perlu semakan pegawai，不写结论', () => {
    const running = build({
      assessments: [
        item('old', asData({ createdAt: new Date('2026-10-01T00:00:00Z') })),
        item('new', asData({ runStatus: 'running', createdAt: new Date('2026-10-05T00:00:00Z') })),
      ],
    });
    expect(running.summary.key).toBe('running');
    expect(running.checks).toBeNull();
    expect(running.open).toBeNull();
    expect(running.forest).toBeNull();

    const failed = build({ assessments: [item('f', asData({ runStatus: 'failed' }))] });
    expect(failed.summary.key).toBe('needs_review');
    expect(failed.summary.checkedOn).toBeNull();
    expect(failed.checks).toBeNull();
    expect(failed.forest).toBeNull();
  });

  it('绿：没有缺口，Semua lulus', () => {
    const m = build({
      assessments: [item('g', asData({ result: 'green', gaps: [] }))],
    });
    expect(m.summary.headline).toBe('Semua lulus');
    expect(m.summary.icon).toBe('✓');
    expect(m.open).toEqual([]);
  });
});

describe('buildDossier：规则', () => {
  it('CC-01／02／03：结果标签、图标与只用解析数字造的一句话', () => {
    const rows = build().checks ?? [];
    expect(rows.map((r) => r.code)).toEqual(['CC-01', 'CC-02', 'CC-03']);
    expect(rows[0]).toMatchObject({
      name: 'Keluasan: geran lawan lukisan',
      label: 'Perlu perhatian',
      icon: '⚠',
      tone: 'warn',
      sentence: 'Geran 3.04 ha, lukisan 3.49 ha',
    });
    expect(rows[1]).toMatchObject({ name: 'Tempoh sah dokumen', sentence: 'Baki 58 hari' });
    expect(rows[2]).toMatchObject({
      name: 'Nama pemilik',
      label: 'Lulus',
      icon: '✓',
      tone: 'ok',
      sentence: 'Nama sepadan dengan pengusaha',
    });
  });

  it('CC-02 只有到期日：写「Tamat pada 30 Apr 2026」', () => {
    const r = [
      {
        ruleCode: 'CC-02',
        result: 'fail',
        expectedValue: '>= 90 天',
        actualValue: '2026-04-30 已过期',
      },
    ];
    const m = build({
      assessments: [
        item('a', asData({ ruleResults: r, gaps: [gap('expired', 'high', 'mpob_licence')] })),
      ],
    });
    expect(m.checks?.[0].sentence).toBe('Tamat pada 30 Apr 2026');
    expect(m.checks?.[0].label).toBe('Tidak lulus');
    expect(m.checks?.[0].icon).toBe('✕');
  });

  it('CC-02：到期类缺口不止一件时分不清数字属于哪份文件，不写', () => {
    const m = build({
      assessments: [
        item(
          'a',
          asData({
            gaps: [gap('expiring', 'medium', 'mpob_licence'), gap('expired', 'high', 'mspo_cert')],
          }),
        ),
      ],
    });
    expect(m.checks?.find((r) => r.code === 'CC-02')?.sentence).toBeNull();
  });

  it('解析不出数字：不写一句话，不显示原始字符串', () => {
    const r = [
      { ruleCode: 'CC-01', result: 'warn', expectedValue: '三点零四', actualValue: 'N/A' },
      { ruleCode: 'CC-02', result: 'warn', actualValue: '快到期' },
    ];
    const m = build({ assessments: [item('a', asData({ ruleResults: r }))] });
    expect(m.checks?.map((c) => c.sentence)).toEqual([null, null]);
    expect(JSON.stringify(m)).not.toContain('N/A');
  });

  it('未知规则用通用名，不认得的结果当「需复核」，重复的规则编号只留第一条，没编号的丢掉', () => {
    const r = [
      { ruleCode: 'CC-99', result: 'surprise' },
      { ruleCode: 'CC-99', result: 'pass' },
      { result: 'pass' },
    ];
    const rows = build({ assessments: [item('a', asData({ ruleResults: r }))] }).checks ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Semakan lain',
      label: 'Perlu semakan',
      icon: '?',
      sentence: null,
    });
    // 后端写的任意规则编号不进档案：未知的换成序号
    expect(rows[0].code).toBe('rule-1');
    expect(JSON.stringify(rows)).not.toContain('CC-99');
  });

  it('CC-03 的一句话随结果变化；英文', () => {
    const r = [{ ruleCode: 'CC-03', result: 'fail' }];
    const m = buildDossier(
      en,
      'en',
      input({ assessments: [item('a', asData({ ruleResults: r }))] }),
    );
    expect(m.checks?.[0]).toMatchObject({
      name: 'Owner name',
      label: 'Not passed',
      sentence: "Name doesn't match the operator",
    });
  });
});

describe('buildDossier：未解决的缺口', () => {
  it('标题、带数字的详情、建议都由词典生成，按轻重排', () => {
    const items = build().open ?? [];
    expect(items.map((i) => i.title)).toEqual([
      'Keluasan tidak sepadan',
      'Lesen MPOB hampir tamat',
    ]);
    expect(items[0].detail).toBe('Geran 3.04 ha, lukisan anda 3.49 ha');
    expect(items[1].detail).toBe('Tamat dalam 58 hari.');
    expect(items[0].advice).toContain('sempadan');
  });

  it('已解决的缺口不列；没有就是空数组', () => {
    const g = { ...gap('area_mismatch'), status: 'resolved' };
    expect(build({ assessments: [item('a', asData({ gaps: [g] }))] }).open).toEqual([]);
  });

  it('未知 gapCode 走通用文案，不显示缺口自带的说明', () => {
    const m = build({ assessments: [item('a', asData({ gaps: [gap('brand_new_gap')] }))] });
    expect(m.open).toHaveLength(1);
    expect(JSON.stringify(m.open)).not.toContain('brand_new_gap');
    expect(JSON.stringify(m.open)).not.toMatch(CJK);
  });
});

describe('buildDossier：森林初筛', () => {
  it('没有损失：一句话＋初筛说明；损失 0 是合法值，覆盖率没给就不写', () => {
    const f = build().forest;
    expect(f?.line).toBe('Saringan hutan: tiada kehilangan hutan dikesan.');
    expect(f?.prelim).toBe('Ini saringan awal sahaja.');
    expect(f?.cover).toBeNull();
    expect(f?.loss).toBe('Kehilangan hutan selepas 2020: 0 ha');
  });

  it('有损失：一句话带公顷数；覆盖率最多两位小数', () => {
    const m = build({
      assessments: [
        item(
          'a',
          asData({ forestRisk: 'high', forestLossAfter2020Ha: 0.8, forestCover2020Pct: 12.5 }),
        ),
      ],
    });
    expect(m.forest?.line).toContain('(0.8 ha)');
    expect(m.forest?.loss).toBe('Kehilangan hutan selepas 2020: 0.8 ha');
    expect(m.forest?.cover).toBe('Tutupan hutan pada 2020: 12.5%');
  });

  it('不是数字或越界：不写，null 不当 0；一句话是「belum dapat disemak」', () => {
    const m = build({
      assessments: [
        item(
          'a',
          asData({
            forestRisk: null,
            forestLossAfter2020Ha: null,
            forestCover2020Pct: 150,
          }),
        ),
      ],
    });
    expect(m.forest?.line).toBe('Saringan hutan belum dapat disemak. Pegawai akan menyemak.');
    expect(m.forest?.loss).toBeNull();
    expect(m.forest?.cover).toBeNull();
    const nan = build({
      assessments: [
        item('a', asData({ forestLossAfter2020Ha: Number.NaN, forestCover2020Pct: -1 })),
      ],
    });
    expect(nan.forest?.loss).toBeNull();
    expect(nan.forest?.cover).toBeNull();
  });

  it('风险没写（一句话是「belum dapat disemak」）时不再写「损失 0 ha」，免得自相矛盾；覆盖率照写', () => {
    const m = build({
      assessments: [
        item('a', asData({ forestRisk: null, forestLossAfter2020Ha: 0, forestCover2020Pct: 10 })),
      ],
    });
    expect(m.forest?.line).toBe('Saringan hutan belum dapat disemak. Pegawai akan menyemak.');
    expect(m.forest?.loss).toBeNull();
    expect(m.forest?.cover).toBe('Tutupan hutan pada 2020: 10%');
  });

  it('覆盖率 0 是合法值', () => {
    const m = build({ assessments: [item('a', asData({ forestCover2020Pct: 0 }))] });
    expect(m.forest?.cover).toBe('Tutupan hutan pada 2020: 0%');
  });
});

describe('buildDossier：文件', () => {
  it('按固定顺序，每种一行；页数只数当前页；状态汇总；MPOB 与 MSPO 带编号与日期；不认得的类型忽略', () => {
    const rows = build().documents;
    expect(rows.map((r) => r.type)).toEqual(['land_title', 'mpob_licence', 'mspo_cert']);
    expect(rows[0]).toMatchObject({
      name: 'Geran tanah',
      pages: '2 halaman',
      status: 'Dibaca',
      detail: null,
    });
    expect(rows[1]).toMatchObject({
      name: 'Lesen MPOB',
      pages: '1 halaman',
      status: 'Perlu semakan',
      detail: 'No. 810212345678 · sah sehingga 5 Dis 2026',
    });
    expect(rows[2]).toMatchObject({
      name: 'Sijil MSPO',
      status: 'Dibaca',
      detail: 'No. MSPO 900001 · tamat 28 Feb 2029',
    });
  });

  it('有一页读取失败：整种文件写「Tidak dapat dibaca」；状态混着认不出的：不写状态', () => {
    const failed = build({
      documents: [
        { docType: 'land_title', pageNo: 1, isCurrent: true, extractionStatus: 'extracted' },
        { docType: 'land_title', pageNo: 2, isCurrent: true, extractionStatus: 'failed' },
      ],
    });
    expect(failed.documents[0].status).toBe('Tidak dapat dibaca');
    const unknown = build({
      documents: [{ docType: 'land_title', pageNo: 1, extractionStatus: 'pending' }],
    });
    expect(unknown.documents[0].status).toBeNull();
    expect(unknown.documents[0].pages).toBe('1 halaman');
  });

  it('MPOB 执照读不到：只有页数与状态，没有 detail；没有文档：空数组', () => {
    const m = build({ mpob: null });
    expect(m.documents.find((r) => r.type === 'mpob_licence')?.detail).toBeNull();
    expect(build({ documents: [] }).documents).toEqual([]);
  });

  it('只有编号或只有日期也能写；日期格式不对不写', () => {
    const m = build({
      mpob: { licenceNo: '810212345678', validUntil: '五月' },
      mspo: { certNo: null, expiryDate: '2029-02-28' },
    });
    expect(m.documents.find((r) => r.type === 'mpob_licence')?.detail).toBe('No. 810212345678');
    expect(m.documents.find((r) => r.type === 'mspo_cert')?.detail).toBe('tamat 28 Feb 2029');
  });

  it('到期日若是 Date（真实后端写成 Timestamp）也照样显示', () => {
    const m = build({
      mpob: { licenceNo: '810212345678', validUntil: new Date('2026-12-05T04:00:00Z') },
      mspo: { certNo: 'MSPO 900001', expiryDate: new Date('x') },
    });
    expect(m.documents.find((r) => r.type === 'mpob_licence')?.detail).toBe(
      'No. 810212345678 · sah sehingga 5 Dis 2026',
    );
    expect(m.documents.find((r) => r.type === 'mspo_cert')?.detail).toBe('No. MSPO 900001');
  });

  it('英文', () => {
    const m = buildDossier(en, 'en', input());
    expect(m.documents[1].detail).toBe('No. 810212345678 · valid until 5 Dec 2026');
    expect(m.documents[0].pages).toBe('2 pages');
  });
});

describe('buildDossier：隐私', () => {
  it('整个输出里没有证件、说明文字、持有人名称、中文、原始数值字符串、id、存储路径、哈希、nickname', () => {
    const m = buildDossier(
      ms,
      'ms',
      input({
        person: {
          fullName: 'AHMAD ZAKI BIN ROSLI',
          icHash: 'IC-HASH-SECRET',
          icLast4: '4321',
        } as never,
        mspo: {
          certNo: 'MSPO 900001',
          expiryDate: '2029-02-28',
          certificateHolder: 'Contoh Sawit Sdn. Bhd. HOLDER-SECRET',
        } as never,
        documents: docs.map((d) => ({
          ...d,
          storagePath: 'seed/PLOT-SECRET/land_title-1.jpg',
          fileHash: 'HASH-SECRET',
          id: 'DOC-SECRET-2',
        })) as never,
        assessments: [item('ASSESSMENT-SECRET', asData({ plotId: 'PLOT-SECRET' }))],
      }),
    );
    const text = JSON.stringify(m);
    expect(text).not.toMatch(CJK);
    for (const secret of [
      'IC-HASH',
      '4321',
      'HOLDER-SECRET',
      'PLOT-SECRET',
      'DOC-SECRET',
      'ASSESSMENT-SECRET',
      'HASH-SECRET',
      'CITATION-SECRET',
      'INTERNAL-SUMMARY',
      'SNAPSHOT-SECRET',
      'MODEL-SECRET',
      'RULES-SECRET',
      'RAMAN',
      'Arwah',
      'storagePath',
      'seed/',
      '58 天',
      '3.0400',
      '>= 90',
    ]) {
      expect(text).not.toContain(secret);
    }
    // 规则的原始值只通过解析后的数字出现
    expect(rules[0].actualValue).toBe('3.4900 ha');
    expect(text).not.toContain('3.4900');
  });

  it('英文输出同样没有中文', () => {
    const text = JSON.stringify(buildDossier(en, 'en', input()));
    expect(text).not.toMatch(CJK);
  });
});
