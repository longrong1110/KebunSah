// 固定参数与名称池。改这里会改变整批输出（种子不变也一样），所以改完要重新生成并校验。

export const SEED = 20261009;

// 基准日：所有"距到期几天"都从这天算。演示在这天前后 10 天内，状态不会变。
export const AS_OF = '2026-10-09';

export const DEMO_COOP_ID = 'c0000000-0000-4000-8000-000000000001';
export const DEMO_OFFICER_UID = 'demo-officer-1';
export const DEMO_ADMIN_UID = 'demo-admin-1';

// 规则阈值，取自 contract/schema.sql 的 rule_params（basis：law / mpob / team）
export const RULE_PARAMS = {
  'CC-01': {
    area_tolerance_pct: { value: 10, unit: '%', basis: 'team', note: '允许的面积差：地契面积的 10% 与 0.1 公顷取较大者（队友文档）' },
    area_tolerance_min_ha: { value: 0.1, unit: 'ha', basis: 'team', note: '同上，下限 0.1 公顷' },
    area_fail_over_pct: { value: 50, unit: '%', basis: 'team', note: '超出 50% 直接不通过（队友文档）' },
  },
  'CC-02': {
    expiry_warn_days: { value: 90, unit: 'days', basis: 'team', note: '距到期不足 90 天给警告（队友文档）' },
  },
  'CC-03': {
    name_similarity_min: { value: 0.85, unit: 'ratio', basis: 'team', note: '姓名相似度不低于 0.85 算同一人（队友文档）' },
  },
  EXTRACT: {
    confidence_min: { value: 0.7, unit: 'ratio', basis: 'team', note: '读出置信度低于 0.7 要请用户确认（队友文档）' },
  },
  PLOT: {
    point_max_ha: { value: 4, unit: 'ha', basis: 'law', note: 'EUDR：小于 4 公顷可只给一个点；恰好 4 公顷各来源写法不一，保守按多边形' },
    smallholder_max_ha: { value: 40.46, unit: 'ha', basis: 'mpob', note: 'MPOB 小园主执照：100 英亩（40.46 公顷）以下' },
  },
};

// 规则引擎直接用的数字
export const P = {
  areaTolerancePct: RULE_PARAMS['CC-01'].area_tolerance_pct.value,
  areaToleranceMinHa: RULE_PARAMS['CC-01'].area_tolerance_min_ha.value,
  areaFailOverPct: RULE_PARAMS['CC-01'].area_fail_over_pct.value,
  expiryWarnDays: RULE_PARAMS['CC-02'].expiry_warn_days.value,
  nameSimilarityMin: RULE_PARAMS['CC-03'].name_similarity_min.value,
  confidenceMin: RULE_PARAMS.EXTRACT.confidence_min.value,
  pointMaxHa: RULE_PARAMS.PLOT.point_max_ha.value,
};

// 造数据时留的"安全带"：避开阈值附近，队友后端换一种比较写法也不会翻转结果
export const BAND = {
  expiryOkMinDays: 120, // 通过的执照至少还有这么多天
  expiringDays: [20, 80], // 临期的天数范围
  expiredDays: [10, 400], // 已过期多少天
  nameSimilarityPassMin: 0.9,
  nameSimilarityFailMax: 0.6,
};

// 单个文件大小上限：Firestore 单文档 1 MiB
export const MAX_DOC_BYTES = 1024 * 1024;

// Perak 的县。锚点是该县县城的大致经纬度，只用来把虚构地块撒在附近，不是测绘数据。
// mukim 与 kampung 名称是示意，没有逐一核对（见企划书 §8.8 第 1 项）。
export const STATE = 'Perak';
export const PERAK_BOUNDS = { minLat: 3.6, maxLat: 5.9, minLng: 100.0, maxLng: 101.9 };

export const DISTRICTS = [
  { name: 'Kampar', anchor: [4.31, 101.15], weight: 18, mukim: ['Kampar', 'Teja', 'Kuala Dipang'] },
  { name: 'Batang Padang', anchor: [4.22, 101.26], weight: 14, mukim: ['Batang Padang', 'Chenderiang', 'Bidor'] },
  { name: 'Hilir Perak', anchor: [4.025, 101.02], weight: 14, mukim: ['Hutan Melintang', 'Sungai Manik', 'Changkat Jong'] },
  { name: 'Manjung', anchor: [4.2, 100.69], weight: 10, mukim: ['Sitiawan', 'Lumut', 'Beruas'] },
  { name: 'Perak Tengah', anchor: [4.37, 100.98], weight: 10, mukim: ['Kota Setia', 'Bota', 'Lambor Kanan'] },
  { name: 'Kuala Kangsar', anchor: [4.77, 100.94], weight: 8, mukim: ['Kota Lama Kanan', 'Sungai Siput', 'Padang Rengas'] },
  { name: 'Larut, Matang dan Selama', anchor: [4.85, 100.74], weight: 8, mukim: ['Asam Kumbang', 'Bukit Gantang', 'Kamunting'] },
  { name: 'Kerian', anchor: [5.13, 100.49], weight: 6, mukim: ['Parit Buntar', 'Selinsing', 'Bagan Serai'] },
  { name: 'Bagan Datuk', anchor: [3.99, 100.77], weight: 7, mukim: ['Rungkup', 'Sungai Sumun', 'Bagan Datuk'] },
  { name: 'Muallim', anchor: [3.83, 101.4], weight: 5, mukim: ['Slim', 'Behrang', 'Tanjong Malim'] },
];

export const LOCALITIES = [
  'Kampung Sungai Buluh', 'Kampung Bukit Lalang', 'Kampung Paya Redan', 'Kampung Tanjung Batu',
  'Kampung Seri Aman', 'Kampung Pasir Putih', 'Kampung Batu 12', 'Kampung Baru', 'Kampung Tersusun',
  'Kampung Sungai Lang', 'Kampung Kuala Pari', 'Kampung Bukit Jaya',
];

export const PLOT_NICKNAMES = [
  'Kebun Utama', 'Kebun Belakang', 'Kebun Hujung', 'Kebun Tepi Sungai', 'Kebun Bukit', 'Kebun Lama',
  'Kebun Pusaka', 'Kebun Sawit Kecil', 'Kebun Hadapan', 'Kebun Paya',
];

export const EXPRESS_CONDITIONS = [
  'Tanah ini hendaklah digunakan bagi pertanian sahaja',
  'Tanah ini hendaklah ditanam dengan kelapa sawit atau tanaman kekal',
  'Pertanian - tanaman kekal',
];

export const RESTRICTIONS = [
  'Tanah ini tidak boleh dipindahmilik, dipajak atau digadai tanpa kebenaran Pihak Berkuasa Negeri',
  null,
  null,
];

// ---- 姓名池（全部虚构拼接，避开知名人物与头衔） ----
export const NAMES = {
  malayMaleGiven: [
    'AHMAD', 'MOHD', 'MUHAMMAD', 'ABDUL', 'AZMAN', 'HAIRUL', 'ZULKIFLI', 'SHAHRIL', 'FAIZAL', 'HASRUL',
    'NORAZMI', 'SYAFIQ', 'ADLI', 'AMIRUL', 'RIDZUAN', 'KHAIRUL', 'ROSLAN', 'SALLEH', 'SAMSUDIN', 'YUSOF',
    'ZAINAL', 'HISHAM', 'MOKHTAR', 'JAAFAR', 'OTHMAN', 'RAHMAT', 'SULAIMAN', 'TARMIZI', 'HASAN', 'KAMARUL',
  ],
  malayMaleSecond: [
    'ZAKI', 'FIRDAUS', 'HAFIZ', 'AZIZ', 'AMIN', 'FARHAN', 'IKHWAN', 'RAZIF', 'NAZRI', 'IZZAT', 'SYAZWAN',
    'AFIQ', 'HAKIM', 'LUQMAN', 'NAIM',
  ],
  malayFemaleGiven: [
    'NURUL', 'SITI', 'NOR', 'AZIZAH', 'FATIMAH', 'HALIMAH', 'ROHANI', 'ZAINAB', 'MARIAM', 'RAHIMAH',
    'SALMAH', 'KAMARIAH', 'RUSLINA', 'AISHAH', 'NORAINI',
  ],
  malayFemaleSecond: ['AIN', 'HUDA', 'AMIRAH', 'SYAZWANI', 'FARHANA', 'IZZATI', 'HASANAH', 'SOFEA', 'AFIQAH', 'ATIKAH'],
  malayFather: [
    'ROSLI', 'ISMAIL', 'HASSAN', 'OSMAN', 'ABU BAKAR', 'ZAINUDDIN', 'MAT ISA', 'DAUD', 'HAMZAH', 'LATIF',
    'MAHMUD', 'NORDIN', 'SAAD', 'TAIB', 'YAAKOB', 'ABDULLAH', 'IBRAHIM', 'MUSA', 'BAKAR', 'SALIM',
    'JAMALUDIN', 'KASSIM', 'RAMLI', 'SHAARI', 'WAHAB',
  ],
  indianMaleGiven: [
    'MUTHU', 'KUMAR', 'SELVAM', 'GOVINDASAMY', 'ARUMUGAM', 'KRISHNAN', 'LETCHUMANAN', 'MANIAM',
    'PERUMAL', 'RAVICHANDRAN', 'SARAVANAN', 'THANGARAJU', 'VELU', 'NADARAJAH', 'MURUGAN', 'PALANISAMY',
  ],
  indianFemaleGiven: ['KAMALA', 'LAKSHMI', 'MALATHI', 'PUSHPA', 'SAROJA', 'VASANTHI', 'REVATHI', 'SELVI', 'ANITHA', 'DEVI'],
  indianFather: [
    'RAMAN', 'SUBRAMANIAM', 'SINNATHAMBY', 'KANNAN', 'CHELLIAH', 'MARIMUTHU', 'RAMASAMY', 'VELAYUTHAM',
    'SUPPIAH', 'KUPPUSAMY', 'ANNAMALAI', 'PONNUSAMY',
  ],
  chineseSurname: [
    'TAN', 'LIM', 'LEE', 'WONG', 'CHAN', 'LAU', 'NG', 'CHONG', 'YAP', 'LOW', 'TEOH', 'KOH', 'CHEW',
    'LIEW', 'FOONG', 'LEONG', 'SIM', 'HO', 'CHIN', 'YEOH', 'GOH',
  ],
  chineseMaleGiven: [
    'AH KOW', 'AH HOCK', 'SOON HOCK', 'KIM SENG', 'WEI MING', 'CHEE KEONG', 'AH LEK', 'KOK WAI',
    'CHIN HOCK', 'KWAN YEW', 'POH KIM', 'SWEE HOCK', 'SEE HOCK', 'BOON TECK', 'CHOON KIAT',
  ],
  chineseFemaleGiven: ['MEI LING', 'SIEW LAN', 'YOKE LAN', 'LAI FONG', 'AH MOI', 'SOOK YEE', 'KIM LIAN', 'POH LIN'],
};

// 名字里不得出现的词：政要、王室与头衔（测试会逐个检查名称池）
export const NAME_BLOCKLIST = [
  'NAJIB', 'MAHATHIR', 'ANWAR', 'MUHYIDDIN', 'SULTAN', 'TUNKU', 'TUAN', 'TUN', 'DATO', 'DATUK', 'DATIN',
  'TAN SRI', 'PUAN SRI', 'RAJA', 'TENGKU', 'YANG', 'PENGIRAN', 'RAZAK', 'HADI', 'ZAHID', 'RAFIZI',
];

export const ETHNIC_WEIGHTS = [['malay', 58], ['chinese', 20], ['indian', 22]];

// MSPO 团体证书：名称都带"(虚构)"，不使用真实机构
export const MSPO_SCHEMES = [
  { holder: 'Kebun Makmur Sdn. Bhd. (虚构)', unit: 'Kebun Makmur Group Scheme - Perak Smallholders', start: '2024-06-15', first: '2019-06-15', weight: 36 },
  { holder: 'Sawit Bersatu Berhad (虚构)', unit: 'Sawit Bersatu Group Scheme - Lembah Perak', start: '2025-02-01', first: '2020-02-01', weight: 34 },
  { holder: 'Ladang Harapan Sdn. Bhd. (虚构)', unit: 'Ladang Harapan Group Scheme - Perak Tengah', start: '2024-11-20', first: '2019-11-20', weight: 30 },
];
export const MSPO_STANDARD = 'MS 2530-2:2013 General Principles for Independent Smallholders';
export const MSPO_CERT_BODY = 'Badan Pensijilan Contoh (虚构)';

export const MODEL_VERSION = 'demo';
export const RULES_VERSION = 'rules-0.1';
