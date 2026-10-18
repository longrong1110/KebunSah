// 生成演示用的仿真证件照（地契、MPOB 执照、MSPO 证书），写到 seed/photos/。
// 用法（需要 puppeteer-core 和 Chrome）：
//   PUPPETEER_DIR=<装了 puppeteer-core 的目录> node seed/photos/kit/render-kit.mjs [名字片段…]
// 内容取自 seed/src/demo.mjs 里的虚构演示数据（绿：TAN AH KOW；黄：AHMAD ZAKI BIN ROSLI；红：MUTHU A/L RAMAN，
// 地契仍在已故父亲 RAMAN A/L SUBRAMANIAM 名下，执照已过期）。全部带「CONTOH / SIMULATED」水印，不仿真官方徽章。
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
const require = createRequire(join(process.env.PUPPETEER_DIR ?? here, 'noop.js'));
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME ?? 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';

// ---- 数据 ----
const COND = 'Tanah ini hendaklah digunakan bagi pertanian sahaja';
const LOTS = {
  green: {
    titleNo: 'GRN 51234', lotNo: '1052', mukim: 'Kampar', district: 'Kampar', state: 'Perak', area: '4.20 Hektar',
    regDate: '03/02/2004', fileNo: 'PA 3341/2004', stampDate: '03 FEB 2004', condition: COND, sig: 0,
    plan: {
      points: [[150, 96], [690, 70], [742, 300], [212, 352]],
      bearings: [[300, 62, "N 88°30' E 540.2 m", -2], [760, 110, "S 12°10' E 232.1 m", 82], [380, 350, "S 85°40' W 532.8 m", -5], [128, 250, "N 14°50' W 261.4 m", -80]],
    },
    owner: { name: 'TAN AH KOW', ic: '720304-07-5117' },
  },
  yellow: {
    titleNo: 'HSM 2217/91', lotNo: '2217', mukim: 'Kampar', district: 'Kampar', state: 'Perak', area: '3.04 Hektar',
    regDate: '14/06/1991', fileNo: 'PA 1187/1991', stampDate: '14 JUN 1991', condition: COND, sig: 1,
    plan: {
      points: [[120, 120], [520, 64], [760, 160], [700, 330], [260, 350], [150, 250]],
      bearings: [[270, 78, "N 82°10' E 403.5 m", -8], [660, 100, "S 67°20' E 258.0 m", 24], [748, 262, "S 18°40' W 183.2 m", 78], [450, 352, "S 88°15' W 440.9 m", 1], [150, 306, "N 33°20' W 118.6 m", -42], [96, 190, "N 5°45' E 134.0 m", -84]],
    },
    owner: { name: 'AHMAD ZAKI BIN ROSLI', ic: '800512-08-5231' },
  },
  red: {
    titleNo: 'GRN 30977', lotNo: '88', mukim: 'Kampar', district: 'Kampar', state: 'Perak', area: '2.00 Hektar',
    regDate: '22/09/1978', fileNo: 'PA 0922/1978', stampDate: '22 SEP 1978', condition: COND, sig: 0,
    plan: {
      points: [[210, 100], [620, 90], [650, 330], [190, 318]],
      bearings: [[330, 82, "N 89°05' E 410.0 m", -1], [640, 210, "S 06°30' E 240.5 m", 85], [400, 340, "S 87°10' W 460.2 m", 1], [180, 214, "N 02°20' W 218.0 m", -88]],
    },
    owner: { name: 'RAMAN A/L SUBRAMANIAM', ic: '391101-01-5009' },
  },
};

const LICENCE = {
  green: { licenceNo: '810200000011', holderName: 'TAN AH KOW', holderIc: '720304-07-5117', premises: 'Lot 1052, Mukim Kampar, Perak', issued: '01/04/2024', validUntil: '31/03/2027', sig: 0 },
  yellow: { licenceNo: '810200000022', holderName: 'AHMAD ZAKI BIN ROSLI', holderIc: '800512-08-5231', premises: 'Lot 2217, Mukim Kampar, Perak', issued: '06/12/2023', validUntil: '05/12/2026', sig: 1 },
  red: { licenceNo: '810200000033', holderName: 'MUTHU A/L RAMAN', holderIc: '650820-01-5333', premises: 'Lot 88, Mukim Kampar, Perak', issued: '01/05/2023', validUntil: '30/04/2026', sig: 1 },
};

const CERT = {
  holder: 'Contoh Sawit Sdn. Bhd. (rekaan)', certNo: 'MSPO 900001', unit: 'Contoh Group Scheme - Perak Smallholders (2 members)',
  start: '01/03/2024', expiry: '28/02/2029', body: 'Badan Pensijilan Contoh (rekaan)',
};

const PEN_GREEN = { top: 1010, rot: -3, text: '± 4.2 ha  (ukur semula 2026)' };
const PEN_RED = { top: 1080, rot: -2, text: 'Arwah 12/2019 — belum tukar nama waris' };

const own = (k) => ({ ...LOTS[k], owner: LOTS[k].owner });
const p1 = (k) => ({ ...LOTS[k], owner: null });
const p2 = (k, hand) => ({ ...LOTS[k], name: LOTS[k].owner.name, ic: LOTS[k].owner.ic, hand });

// 拍照效果：rz 歪斜角度、rx 俯仰、blur 模糊、dark 偏暗、light 灯光强度
const CLEAR = (seed, rz = 0.4) => ({ seed, rz, rx: 2.5, light: 1 });

export const SAMPLES = [
  // 绿
  { name: 'green-1-title-page1', kind: 'geran1', data: p1('green'), look: CLEAR(11, -0.5) },
  { name: 'green-2-title-page2', kind: 'geran2', data: p2('green'), look: CLEAR(12, 0.7) },
  { name: 'green-3-title-single-page', kind: 'geran1', data: own('green'), look: CLEAR(13, -0.8) },
  { name: 'green-4-licence', kind: 'lesen', data: LICENCE.green, look: CLEAR(14, 0.5) },
  { name: 'green-extra-title-handwritten', kind: 'geran1', data: { ...own('green'), hand: PEN_GREEN }, look: { seed: 15, rz: 2.4, rx: 4, blur: 0.4, light: 0.95 } },
  // 黄
  { name: 'yellow-1-title-page1', kind: 'geran1', data: p1('yellow'), look: CLEAR(21, 0.6) },
  { name: 'yellow-2-title-page2', kind: 'geran2', data: p2('yellow'), look: CLEAR(22, -0.7) },
  { name: 'yellow-3-title-single-page', kind: 'geran1', data: own('yellow'), look: CLEAR(23, 0.3) },
  { name: 'yellow-4-licence', kind: 'lesen', data: LICENCE.yellow, look: CLEAR(24, -0.4) },
  { name: 'yellow-extra-licence-blurry', kind: 'lesen', data: LICENCE.yellow, look: { seed: 25, rz: 3.2, rx: 5, blur: 2.4, light: 0.8, dark: 0.18 } },
  // 红
  { name: 'red-1-title-page1', kind: 'geran1', data: p1('red'), look: CLEAR(31, -1.1) },
  { name: 'red-2-title-page2', kind: 'geran2', data: p2('red', PEN_RED), look: CLEAR(32, 0.9) },
  { name: 'red-3-title-single-page', kind: 'geran1', data: own('red'), look: CLEAR(33, -1.2) },
  { name: 'red-4-licence-expired', kind: 'lesen', data: LICENCE.red, look: CLEAR(34, 0.8) },
  // MSPO（绿和黄共用同一张证书）
  { name: 'mspo-cert-clear', kind: 'mspo', data: CERT, look: CLEAR(41, -0.3) },
  { name: 'mspo-cert-extra-dark-tilted', kind: 'mspo', data: CERT, look: { seed: 42, rz: -3.4, rx: 5, blur: 0.8, light: 0.6, dark: 0.22, shadowBand: true } },
];

// ---- 渲染 ----
const only = process.argv.slice(2);
const todo = SAMPLES.filter((s) => only.length === 0 || only.some((o) => s.name.includes(o)));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1900, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(here, 'template.html')).href, { waitUntil: 'networkidle0', timeout: 60000 });
  for (const s of todo) {
    await page.evaluate((kind, data, look) => window.renderDoc(kind, data, look), s.kind, s.data, s.look);
    const buf = await page.screenshot({ type: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: 1400, height: 1900 } });
    writeFileSync(join(out, `${s.name}.jpg`), buf);
    console.log(`${s.name}.jpg  ${Math.round(buf.length / 1024)} KB`);
  }
} finally {
  await browser.close();
}
