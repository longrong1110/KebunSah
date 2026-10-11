// 3 个演示地块（绿 / 黄 / 红），照 contract/schema.sql 末尾的 INSERT 逐字段搬过来，只做命名转换与类型转换：
//   列名 snake_case → camelCase；timestamptz → ISO 字符串；polygon_geojson → 紧凑 JSON 字符串。
// schema.sql 里 created_at 取 now()，不可重现，这里统一固定为 DEMO_CREATED。
// 演示评估里的 detail / description / suggested_action 与数值字符串，schema.sql 里原是中文，这里换成马来语（与生成的地块一致，格式见 rules.mjs）；
// 数值和结论不变。前端只解析天数、日期、公顷这几个数，不显示这些说明文字。
import { camelKeys } from './shape.mjs';
import { identityFromIc } from './people.mjs';
import { myt } from './dates.mjs';
import { toHa } from './units.mjs';
import { DEMO_COOP_ID, DEMO_OFFICER_UID, DEMO_ADMIN_UID } from './constants.mjs';

export const DEMO_CREATED = '2026-10-01T02:00:00.000Z';

const base = { isSynthetic: true };

// 演示用的虚构身份证号，来自 schema.sql（已在仓库里，全部虚构）。明文只在这里算哈希，不写入任何输出。
const IC = {
  tan: '720304075117',
  ahmad: '800512085231',
  muthu: '650820015333',
  raman: '391101015009',
};

const PLOT_PREFIX = '90000000-0000-4000-8000-00000000000';
const id = (prefix, n) => `${prefix}-0000-4000-8000-00000000000${n}`;

export const DEMO_IDS = {
  coop: DEMO_COOP_ID,
  person: [id('a0000000', 1), id('a0000000', 2), id('a0000000', 3)],
  title: [id('b0000000', 1), id('b0000000', 2), id('b0000000', 3)],
  licence: [id('d0000000', 1), id('d0000000', 2), id('d0000000', 3)],
  cert: id('e0000000', 1),
  member: [id('f0000000', 1), id('f0000000', 2)],
  plot: [`${PLOT_PREFIX}1`, `${PLOT_PREFIX}2`, `${PLOT_PREFIX}3`],
  assessment: [id('70000000', 1), id('70000000', 2), id('70000000', 3)],
  // 黄色地块原有的 3 个文件（schema.sql 里的 id）
  yellowDocs: ['80000000-0000-4000-8000-000000000021', '80000000-0000-4000-8000-000000000022', '80000000-0000-4000-8000-000000000023'],
};

const expressCond = 'Tanah ini hendaklah digunakan bagi pertanian sahaja';

export function buildDemo() {
  const identities = {
    tan: identityFromIc(IC.tan), ahmad: identityFromIc(IC.ahmad),
    muthu: identityFromIc(IC.muthu), raman: identityFromIc(IC.raman),
  };

  const cooperative = {
    path: `cooperatives/${DEMO_COOP_ID}`,
    data: {
      ...camelKeys({ name: 'Koperasi Pekebun Kecil Contoh (rekaan)', registration_body: 'SKM', registration_no: null, state: 'Perak' }),
      ...base, createdAt: DEMO_CREATED,
    },
  };

  const personRows = [
    ['TAN AH KOW', identities.tan],
    ['AHMAD ZAKI BIN ROSLI', identities.ahmad],
    ['MUTHU A/L RAMAN', identities.muthu],
  ];
  const persons = personRows.map(([fullName, ident], i) => ({
    path: `persons/${DEMO_IDS.person[i]}`,
    data: { fullName, icHash: ident.icHash, icLast4: ident.icLast4, ...base, createdAt: DEMO_CREATED },
  }));

  const users = [
    { uid: DEMO_OFFICER_UID, phone: '+60100000001', role: 'field_officer', language: 'ms' },
    { uid: DEMO_ADMIN_UID, phone: '+60100000002', role: 'coop_admin', language: 'en' },
  ].map(({ uid, ...rest }) => ({
    path: `users/${uid}`,
    data: { ...camelKeys({ ...rest, person_id: null, coop_id: DEMO_COOP_ID, last_login_at: null }), ...base, createdAt: DEMO_CREATED },
  }));

  const titleRows = [
    { title_type: 'GRN', title_no: 'GRN 51234', lot_no: '1052', mukim: 'Kampar', district: 'Kampar', state: 'Perak', area_value: 4.2, area_unit: 'ha', verification_level: 'confirmed' },
    { title_type: 'HSM', title_no: 'HSM 2217/91', lot_no: '2217', mukim: 'Kampar', district: 'Kampar', state: 'Perak', area_value: 3.04, area_unit: 'ha', verification_level: 'confirmed' },
    { title_type: 'GRN', title_no: 'GRN 30977', lot_no: '88', mukim: 'Kampar', district: 'Kampar', state: 'Perak', area_value: 2.0, area_unit: 'ha', verification_level: 'extracted' },
  ];
  const proprietors = [
    { name: 'TAN AH KOW', ident: identities.tan, personId: DEMO_IDS.person[0] },
    { name: 'AHMAD ZAKI BIN ROSLI', ident: identities.ahmad, personId: DEMO_IDS.person[1] },
    // 红色地块仍在已故父亲名下（tanah pusaka），他不是 persons 里的人
    { name: 'RAMAN A/L SUBRAMANIAM', ident: identities.raman, personId: null },
  ];
  const titles = titleRows.map((row, i) => ({
    path: `titles/${DEMO_IDS.title[i]}`,
    data: {
      ...camelKeys({
        ...row,
        locality: null, area_ha: toHa(row.area_value, row.area_unit), land_use_category: 'agriculture', tenure: 'freehold',
        lease_expiry: null, date_first_alienation: null, express_conditions: expressCond, restrictions_in_interest: null,
        annual_rent_rm: null, special_area_type: 'none', special_area_gazette: null, standard_sheet_no: null, certified_plan_no: null,
      }),
      sourceDocumentPath: i === 1 ? `plots/${DEMO_IDS.plot[1]}/documents/${DEMO_IDS.yellowDocs[0]}` : null,
      proprietors: [{
        seq: 1, nameAsPrinted: proprietors[i].name, icHash: proprietors[i].ident.icHash, icLast4: proprietors[i].ident.icLast4,
        shareText: null, personId: proprietors[i].personId,
      }],
      ...base, createdAt: DEMO_CREATED, updatedAt: DEMO_CREATED,
    },
  }));

  const licenceRows = [
    ['810200000011', 'TAN AH KOW', identities.tan, DEMO_IDS.person[0], '2027-03-31', 'confirmed'],
    ['810200000022', 'AHMAD ZAKI BIN ROSLI', identities.ahmad, DEMO_IDS.person[1], '2026-12-05', 'confirmed'],
    ['810200000033', 'MUTHU A/L RAMAN', identities.muthu, DEMO_IDS.person[2], '2026-04-30', 'extracted'],
  ];
  const mpobLicences = licenceRows.map(([licenceNo, holderName, ident, personId, validUntil, verificationLevel], i) => ({
    path: `mpobLicences/${DEMO_IDS.licence[i]}`,
    data: {
      licenceNo, licenceType: 'SH', holderName, holderIcHash: ident.icHash, holderIcLast4: ident.icLast4, holderPersonId: personId,
      validUntil, lotText: null, sourceDocumentPath: i === 1 ? `plots/${DEMO_IDS.plot[1]}/documents/${DEMO_IDS.yellowDocs[2]}` : null,
      verificationLevel, ...base, createdAt: DEMO_CREATED, updatedAt: DEMO_CREATED,
    },
  }));

  const mspoCertificate = {
    path: `mspoCertificates/${DEMO_IDS.cert}`,
    data: {
      certNo: 'MSPO 900001', certificateHolder: 'Contoh Sawit Sdn. Bhd. (rekaan)',
      certificationUnit: 'Contoh Group Scheme - Perak Smallholders (2 members)',
      standard: 'MS 2530-2:2013 General Principles for Independent Smallholders', scope: 'estate',
      startDate: '2024-03-01', firstCertifiedDate: '2019-03-01', expiryDate: '2029-02-28', membersCount: 2,
      plantedHa: null, hcvHa: null, infrastructureOtherHa: null, totalAreaHa: null, certBody: null,
      emspoTrackId: null, spocNo: null, sourceDocumentPath: null, verificationLevel: 'extracted',
      ...base, createdAt: DEMO_CREATED, updatedAt: DEMO_CREATED,
    },
  };
  const memberRows = [
    ['TAN AH KOW', 'P1', 'Lot 1052 No. GRN 51234 - 4.200ha, Kampar, Agriculture. Perpetuity ownership.', '810200000011', 0],
    ['AHMAD ZAKI BIN ROSLI', 'P2', 'Lot 2217 No. HSM 2217/91 - 3.040ha, Kampar, Agriculture. Perpetuity ownership.', '810200000022', 1],
  ];
  const mspoMembers = memberRows.map(([memberName, plotNo, landTitleText, mpobLicenceNo, i]) => ({
    path: `mspoCertificates/${DEMO_IDS.cert}/members/${DEMO_IDS.member[i]}`,
    data: {
      certificateId: DEMO_IDS.cert, memberNo: i + 1, memberName, plotNo, landTitleText, mpobLicenceNo,
      personId: DEMO_IDS.person[i], landTitleId: DEMO_IDS.title[i], ...base, createdAt: DEMO_CREATED,
    },
  }));

  const polygons = [
    '{"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895], [101.149037, 4.310895], [101.149037, 4.309105]]]}',
    '{"type": "Polygon", "coordinates": [[[101.161125, 4.324187], [101.162875, 4.324187], [101.162875, 4.325813], [101.161125, 4.325813], [101.161125, 4.324187]]]}',
    '{"type": "Polygon", "coordinates": [[[101.140137, 4.297198], [101.141863, 4.297198], [101.141863, 4.298802], [101.140137, 4.298802], [101.140137, 4.297198]]]}',
  ];
  const plotRows = [
    { nickname: 'Kebun Utama', centroid_lat: 4.31, centroid_lng: 101.15, area_ha_computed: 4.23, oil_palm_planted_year: 2008, status: 'green', rec: ['2026-10-02', '09:10'], assessed: ['2026-10-02', '09:14'], member: DEMO_IDS.member[0] },
    { nickname: 'Kebun Belakang', centroid_lat: 4.325, centroid_lng: 101.162, area_ha_computed: 3.49, oil_palm_planted_year: 2012, status: 'yellow', rec: ['2026-10-03', '10:20'], assessed: ['2026-10-03', '10:24'], member: DEMO_IDS.member[1] },
    { nickname: 'Kebun Arwah Ayah', centroid_lat: 4.298, centroid_lng: 101.141, area_ha_computed: 3.4, oil_palm_planted_year: 2015, status: 'red', rec: ['2026-10-04', '15:02'], assessed: ['2026-10-04', '15:07'], member: null },
  ];
  const plots = plotRows.map((r, i) => ({
    path: `plots/${DEMO_IDS.plot[i]}`,
    data: {
      nickname: r.nickname, operatorPersonId: DEMO_IDS.person[i], coopId: DEMO_COOP_ID,
      landTitleId: DEMO_IDS.title[i], mpobLicenceId: DEMO_IDS.licence[i],
      mspoCertificateId: r.member ? DEMO_IDS.cert : null, mspoMemberId: r.member,
      countryCode: 'MY', geometryType: 'polygon', centroidLat: r.centroid_lat, centroidLng: r.centroid_lng,
      polygonGeojson: JSON.stringify(JSON.parse(polygons[i])), areaHaComputed: r.area_ha_computed, areaHaDeclared: null,
      oilPalmPlantedYear: r.oil_palm_planted_year, status: r.status,
      geometryRecordedAt: myt(...r.rec), lastAssessedAt: myt(...r.assessed),
      // §8.9：为看板筛选，复制 state / district / titleNo
      state: 'Perak', district: 'Kampar', titleNo: titleRows[i].title_no,
      ...base, createdAt: myt(r.rec[0], '08:50'), updatedAt: myt(...r.assessed),
    },
  }));

  // 评估：只有 AI 服务会写；演示的 ruleResults / gaps 原样搬来
  const cc = (ruleCode, result, expectedValue, actualValue, paramsUsed, detail) =>
    ({ ruleCode, result, expectedValue, actualValue, paramsUsed, evidence: [], detail });
  const gap = (gapCode, severity, docType, description, suggestedAction) =>
    ({ gapCode, severity, docType, description, suggestedAction, citation: null, status: 'open' });
  const assessRows = [
    {
      run: [['2026-10-02', '09:12'], ['2026-10-02', '09:14']], forest: [0, 0, 'low'], text: 'Semua semakan lulus.',
      rules: [
        cc('CC-01', 'pass', '4.2000 ha', '4.2300 ha', { tol_pct: 10, tol_min_ha: 0.1 }, 'Beza 0.03 ha, dalam had yang dibenarkan'),
        cc('CC-02', 'pass', '>= 90 hari', '174 hari', { warn_days: 90 }, 'Lesen MPOB tamat pada 2027-03-31'),
        cc('CC-03', 'pass', '>= 0.85', '1.00', { min_similarity: 0.85 }, 'Nama pada geran, lesen dan senarai adalah sama'),
      ],
      gaps: [],
    },
    {
      run: [['2026-10-03', '10:22'], ['2026-10-03', '10:24']], forest: [0, 0, 'low'],
      text: 'Luas pada peta lebih besar daripada geran, dan lesen MPOB hampir tamat.',
      rules: [
        cc('CC-01', 'warn', '3.0400 ha', '3.4900 ha', { tol_pct: 10, tol_min_ha: 0.1 }, 'Lebih 0.45 ha (+14.8%), melebihi had 0.304 ha'),
        cc('CC-02', 'warn', '>= 90 hari', '58 hari', { warn_days: 90 }, 'Lesen MPOB tamat pada 2026-12-05'),
        cc('CC-03', 'pass', '>= 0.85', '1.00', { min_similarity: 0.85 }, 'Nama sepadan'),
      ],
      gaps: [
        gap('area_mismatch', 'medium', null, 'Luas pada peta lebih besar 0.45 ha daripada geran', 'Lukis semula sempadan, atau semak sama ada tanah telah dipecahkan atau ada geran bersebelahan.'),
        gap('expiring', 'medium', 'mpob_licence', 'Lesen MPOB tamat dalam 58 hari', 'Mohon pembaharuan lebih awal, kemudian muat naik lesen baharu.'),
      ],
    },
    {
      run: [['2026-10-04', '15:05'], ['2026-10-04', '15:07']], forest: [12.5, 0.8, 'high'],
      text: 'Lesen MPOB telah tamat, geran atas nama arwah ayah, dan luas jauh berbeza.',
      rules: [
        cc('CC-01', 'fail', '2.0000 ha', '3.4000 ha', { tol_pct: 10, tol_min_ha: 0.1, fail_over_pct: 50 }, 'Lebih 70%, melebihi had merah 50%'),
        cc('CC-02', 'fail', '>= 90 hari', '2026-04-30 telah tamat', { warn_days: 90 }, 'Lesen MPOB telah tamat tempoh'),
        cc('CC-03', 'fail', '>= 0.85', '0.21', { min_similarity: 0.85 }, 'Pemegang geran ialah RAMAN A/L SUBRAMANIAM, berbeza daripada pengusaha'),
      ],
      gaps: [
        gap('expired', 'high', 'mpob_licence', 'Lesen MPOB telah tamat tempoh', 'Perbaharui lesen dahulu (fi lewat dikenakan), kemudian muat naik lesen baharu.'),
        gap('name_mismatch', 'high', 'land_title', 'Geran masih atas nama arwah ayah', 'Sediakan dokumen pusaka atau surat kuasa wakil daripada semua waris, kemudian muat naik salinan yang jelas.'),
        gap('area_mismatch', 'high', null, 'Luas pada peta lebih besar 70% daripada geran', 'Semak sempadan tanah; jika membeli tanah bersebelahan, sediakan geran tanah itu juga.'),
        gap('not_in_mspo', 'medium', 'mspo_member_list', 'Pengusaha tiada dalam senarai ahli skim kumpulan MSPO', 'Sahkan dengan koperasi sama ada sudah menyertai skim kumpulan MSPO.'),
      ],
    },
  ];
  const assessments = assessRows.map((a, i) => ({
    path: `plots/${DEMO_IDS.plot[i]}/assessments/${DEMO_IDS.assessment[i]}`,
    data: {
      plotId: DEMO_IDS.plot[i], runStatus: 'done', result: plotRows[i].status,
      startedAt: myt(...a.run[0]), finishedAt: myt(...a.run[1]), modelVersion: 'demo', rulesVersion: 'rules-0.1',
      inputSnapshot: null, forestDataset: null,
      forestCover2020Pct: a.forest[0], forestLossAfter2020Ha: a.forest[1], forestRisk: a.forest[2],
      summaryText: a.text, summaryLang: 'ms', errorMessage: null,
      ruleResults: a.rules, gaps: a.gaps,
      ...base, createdAt: myt(...a.run[0]),
    },
  }));

  // 黄色地块原有的 3 个文件与 6 个读出字段（schema.sql 里的示意）；mpob valid_until 置信度 0.64 < 0.70，已由外勤确认
  const confirmedAt = myt('2026-10-03', '10:30');
  const f = (rawText, normalizedValue, confidence, extra = {}) => ({ rawText, normalizedValue, confidence, ...extra });
  const yellowDocRows = [
    { n: 0, docType: 'land_title', pageNo: 1, path: 'seed/p2/title-1.jpg', fields: {
      'land_title.lot_no': f('2217', '2217', 0.97),
      'land_title.area_value': f('3.04 Hektar', '3.0400', 0.93),
      'land_title.area_unit': f('Hektar', 'ha', 0.95),
    } },
    { n: 1, docType: 'land_title', pageNo: 2, path: 'seed/p2/title-2.jpg', fields: {
      'land_title.proprietor_1_name': f('AHMAD ZAKI BIN ROSLI', 'AHMAD ZAKI BIN ROSLI', 0.88),
      'land_title.proprietor_1_ic': f('******-**-5231', '5231', 0.9),
    } },
    { n: 2, docType: 'mpob_licence', pageNo: 1, path: 'seed/p2/licence-1.jpg', fields: {
      'mpob_licence.valid_until': f('05/12/2026', '2026-12-05', 0.64, { confirmedValue: '2026-12-05', confirmedBy: DEMO_OFFICER_UID, confirmedAt }),
    } },
  ];
  const yellowDocuments = yellowDocRows.map((d) => ({
    path: `plots/${DEMO_IDS.plot[1]}/documents/${DEMO_IDS.yellowDocs[d.n]}`,
    data: {
      plotId: DEMO_IDS.plot[1], docType: d.docType, pageNo: d.pageNo, isCurrent: true, storagePath: d.path,
      mimeType: null, sha256: null, source: 'seed', uploadedBy: null, capturedAt: null,
      extractionStatus: 'extracted', extractedAt: null, modelVersion: 'demo', fields: d.fields,
      ...base, createdAt: myt('2026-10-03', '09:50'),
    },
  }));

  return {
    cooperative, persons, users, titles, mpobLicences, mspoCertificate, mspoMembers, plots, assessments, yellowDocuments,
    // 给文件生成器用的"演示地块的原始数据"
    facts: [
      { operatorName: 'TAN AH KOW', titleNames: ['TAN AH KOW'], licenceName: 'TAN AH KOW', memberName: 'TAN AH KOW' },
      { operatorName: 'AHMAD ZAKI BIN ROSLI', titleNames: ['AHMAD ZAKI BIN ROSLI'], licenceName: 'AHMAD ZAKI BIN ROSLI', memberName: 'AHMAD ZAKI BIN ROSLI' },
      { operatorName: 'MUTHU A/L RAMAN', titleNames: ['RAMAN A/L SUBRAMANIAM'], licenceName: 'MUTHU A/L RAMAN', memberName: null },
    ],
  };
}
