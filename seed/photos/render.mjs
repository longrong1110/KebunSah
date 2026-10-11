// 生成仿真证件照（地契、MPOB 执照、MSPO 证书）：用浏览器的 canvas 画，不新增依赖。
//
//   node seed/photos/render.mjs        # 起一个本机小服务，打印网址
//   然后用 Chrome／Edge 打开 http://127.0.0.1:4310/ ，页面会把每张图 POST 回来，存成 seed/photos/*.jpg
//
// 全部是自制样本：姓名、证件号、地契号、执照号都取自 seed/data（虚构），每张都有对角的「SIMULATED / CONTOH」水印，
// 不仿真官方印章、徽章与条形码。字段值与种子里这几块演示地块的 documents.fields 一致，便于对照读出的结果。
// 身份证号取自 src/demo.mjs 里那几个虚构号码（schema.sql 里本来就有）。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const data = (name) => JSON.parse(readFileSync(join(here, '..', 'data', `${name}.json`), 'utf8'));
const byId = (name, id) => data(name).find((d) => d.path.endsWith(`/${id}`))?.data;

// 演示地块的 id（与 src/demo.mjs 的 DEMO_IDS 一致）
const T = (n) => byId('titles', `b0000000-0000-4000-8000-00000000000${n}`);
const L = (n) => byId('mpobLicences', `d0000000-0000-4000-8000-00000000000${n}`);
const CERT = byId('mspoCertificates', 'e0000000-0000-4000-8000-000000000001');

// 虚构身份证号（来自 src/demo.mjs，全部虚构），按纸面写法 YYMMDD-PB-###G
const ic = (digits) => `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
const IC = { tan: ic('720304075117'), ahmad: ic('800512085231'), muthu: ic('650820015333'), raman: ic('391101015009') };
const dmy = (iso) => iso.split('-').reverse().join('/');

const title = (t, holders) => ({
  titleNo: t.titleNo,
  lotNo: t.lotNo,
  mukim: t.mukim,
  district: t.district,
  state: t.state,
  area: `${t.areaValue.toFixed(2)} Hektar`,
  landUse: 'Pertanian',
  tenure: 'Pegangan Bebas (Freehold)',
  condition: t.expressConditions,
  holders,
});
const licence = (l, holderName, holderIc, lot) => ({
  licenceNo: l.licenceNo,
  holderName,
  holderIc,
  validUntil: dmy(l.validUntil),
  type: l.licenceType,
  premises: lot,
});

const t1 = T(1), t2 = T(2), t3 = T(3);
const l1 = L(1), l2 = L(2), l3 = L(3);

/** 样本清单：name = 输出文件名；kind = 画哪种证件；look = 拍照效果（见 generate.html） */
export const SAMPLES = [
  { name: 'title-1-clear', kind: 'title1', doc: title(t2, [{ name: 'AHMAD ZAKI BIN ROSLI', ic: IC.ahmad }]), look: { seed: 11, rot: -0.6, blur: 0, light: 1 } },
  { name: 'title-2-proprietor', kind: 'title2', doc: title(t2, [{ name: 'AHMAD ZAKI BIN ROSLI', ic: IC.ahmad }]), look: { seed: 12, rot: 0.8, blur: 0, light: 1 } },
  {
    name: 'title-3-handwritten-area',
    kind: 'title1',
    doc: { ...title(t1, [{ name: 'TAN AH KOW', ic: IC.tan }]), handwrittenArea: '± 4.2 ha  (ukur semula 2026)' },
    look: { seed: 13, rot: 2.4, blur: 0.4, light: 0.95 },
  },
  { name: 'title-4-deceased-father', kind: 'title2', doc: title(t3, [{ name: 'RAMAN A/L SUBRAMANIAM', ic: IC.raman }]), look: { seed: 14, rot: -1.5, blur: 0.3, light: 0.92 } },
  { name: 'licence-1-clear', kind: 'licence', doc: licence(l2, 'AHMAD ZAKI BIN ROSLI', IC.ahmad, `Lot ${t2.lotNo}, Mukim ${t2.mukim}, ${t2.district}, ${t2.state}`), look: { seed: 21, rot: 0.5, blur: 0, light: 1 } },
  { name: 'licence-2-blurry', kind: 'licence', doc: licence(l2, 'AHMAD ZAKI BIN ROSLI', IC.ahmad, `Lot ${t2.lotNo}, Mukim ${t2.mukim}, ${t2.district}, ${t2.state}`), look: { seed: 22, rot: 3.2, blur: 2.6, light: 0.85, noise: 22 } },
  { name: 'licence-3-expired', kind: 'licence', doc: licence(l3, 'MUTHU A/L RAMAN', IC.muthu, `Lot ${t3.lotNo}, Mukim ${t3.mukim}, ${t3.district}, ${t3.state}`), look: { seed: 23, rot: -1.1, blur: 0.2, light: 1 } },
  {
    name: 'mspo-cert-1-clear',
    kind: 'cert',
    doc: {
      certNo: CERT.certNo,
      holder: CERT.certificateHolder,
      unit: CERT.certificationUnit,
      standard: CERT.standard,
      start: dmy(CERT.startDate),
      expiry: dmy(CERT.expiryDate),
      body: 'Badan Pensijilan Contoh (rekaan)',
    },
    look: { seed: 31, rot: 0.3, blur: 0, light: 1 },
  },
  {
    name: 'mspo-cert-2-dark-tilted',
    kind: 'cert',
    doc: {
      certNo: CERT.certNo,
      holder: CERT.certificateHolder,
      unit: CERT.certificationUnit,
      standard: CERT.standard,
      start: dmy(CERT.startDate),
      expiry: dmy(CERT.expiryDate),
      body: 'Badan Pensijilan Contoh (rekaan)',
    },
    look: { seed: 32, rot: -3.6, blur: 0.9, light: 0.62, shadow: true, noise: 18 },
  },
];

const PORT = 4310;
const saved = new Set();

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...cors });
    return res.end(readFileSync(join(here, 'generate.html'), 'utf8'));
  }
  if (req.method === 'GET' && url.pathname === '/spec.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    return res.end(JSON.stringify(SAMPLES));
  }
  if (req.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name') ?? '';
    if (!SAMPLES.some((s) => s.name === name)) return res.writeHead(400, cors).end('unknown sample');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      writeFileSync(join(here, `${name}.jpg`), Buffer.concat(chunks));
      saved.add(name);
      console.log(`保存 ${name}.jpg (${Buffer.concat(chunks).length} 字节)  ${saved.size}/${SAMPLES.length}`);
      res.writeHead(200, cors).end('ok');
      if (saved.size === SAMPLES.length) {
        console.log('全部保存完成，退出。');
        setTimeout(() => process.exit(0), 300);
      }
    });
    return;
  }
  res.writeHead(404, cors).end('not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`打开 http://127.0.0.1:${PORT}/ ，页面会自动画出 ${SAMPLES.length} 张图并存到 seed/photos/`);
});
