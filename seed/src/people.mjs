// 虚构的人：姓名、身份证号（只留哈希与后四位）、姓名拼写差异。
import { createHash } from 'node:crypto';
import { daysInMonth } from './dates.mjs';
import { NAMES, ETHNIC_WEIGHTS, BAND } from './constants.mjs';
import { similarity } from './similarity.mjs';

// 与 schema.sql 演示一致：对 12 位纯数字串做 SHA-256，输出十六进制。
// schema.sql 文件头提醒上线前要加服务端秘密值（pepper）；seed 全是虚构数据，沿用裸 SHA-256 以便和演示对上。
export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

export const maskIc = (last4) => `******-**-${last4}`;

// 出生地代码 01–16（各州与联邦直辖区）；半数落在 08（Perak）
function pickBirthplace(rng) {
  if (rng.chance(0.5)) return '08';
  return String(rng.int(1, 16)).padStart(2, '0');
}

// 生成一个合法的虚构身份证号 YYMMDD-PB-###G，返回 12 位数字串。
// 2000 年前出生的序号多以 5、6、7 开头，2000 年后多以 0 开头；末位奇数为男、偶数为女。
export function makeIc(rng, { bornYear, gender }) {
  const month = rng.int(1, 12);
  const day = rng.int(1, daysInMonth(bornYear, month));
  const yy = String(bornYear % 100).padStart(2, '0');
  const first = bornYear < 2000 ? rng.pick([5, 6, 7]) : rng.pick([0, 0, 0, 1, 2]);
  const second = rng.int(0, 9);
  const third = rng.int(0, 9);
  const g = gender === 'male' ? rng.pick([1, 3, 5, 7, 9]) : rng.pick([0, 2, 4, 6, 8]);
  return `${yy}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}${pickBirthplace(rng)}${first}${second}${third}${g}`;
}

// 明文号码只在内存里算出哈希与后四位，调用方拿不到完整号码
export function makeIdentity(rng, { bornYear, gender }) {
  const ic = makeIc(rng, { bornYear, gender });
  return { icHash: sha256Hex(ic), icLast4: ic.slice(-4) };
}

export const identityFromIc = (ic) => ({ icHash: sha256Hex(ic), icLast4: ic.slice(-4) });

// 三种族群的姓名：全大写，保留 BIN / BINTI、A/L、A/P
export function makeName(rng, ethnic, gender) {
  switch (ethnic) {
    case 'malay': {
      const given = gender === 'male'
        ? [rng.pick(NAMES.malayMaleGiven), ...(rng.chance(0.6) ? [rng.pick(NAMES.malayMaleSecond)] : [])]
        : [rng.pick(NAMES.malayFemaleGiven), ...(rng.chance(0.7) ? [rng.pick(NAMES.malayFemaleSecond)] : [])];
      const link = gender === 'male' ? 'BIN' : 'BINTI';
      return `${given.join(' ')} ${link} ${rng.pick(NAMES.malayFather)}`;
    }
    case 'indian': {
      const given = gender === 'male' ? rng.pick(NAMES.indianMaleGiven) : rng.pick(NAMES.indianFemaleGiven);
      const link = gender === 'male' ? 'A/L' : 'A/P';
      return `${given} ${link} ${rng.pick(NAMES.indianFather)}`;
    }
    case 'chinese': {
      const given = gender === 'male' ? rng.pick(NAMES.chineseMaleGiven) : rng.pick(NAMES.chineseFemaleGiven);
      return `${rng.pick(NAMES.chineseSurname)} ${given}`;
    }
    default:
      throw new Error(`未知族群：${ethnic}`);
  }
}

export const pickEthnic = (rng) => rng.weighted(ETHNIC_WEIGHTS);

// 已故父亲的姓名：和园主明显不同（相似度 ≤ 0.60），否则换一个再试
export function makeFatherName(rng, operatorName, ethnic) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = makeName(rng, ethnic, 'male');
    if (similarity(name, operatorName) <= BAND.nameSimilarityFailMax) return name;
  }
  throw new Error(`造不出与 ${operatorName} 足够不同的姓名`);
}

// 共有人的姓名：同样要和园主拉开距离，免得意外凑出"高相似度"
export function makeOtherName(rng, operatorName, ethnic) {
  return makeFatherName(rng, operatorName, ethnic);
}

// 纸面拼写差异：BIN 写成 B.、BINTI 写成 BT.、MOHD 与 MUHAMMAD 互换等。
// 只返回与原名相似度仍 ≥ 0.90 的候选；没有就返回 null（调用方不造差异）。
export function nameVariant(rng, name) {
  const tokens = name.split(' ');
  // 手写／录入常见的小误差：漏一个字母、多打一个字母（只动 5 个字母以上的词）
  const typos = tokens.flatMap((t, i) => {
    if (t.length < 5) return [];
    const drop = tokens.map((x, j) => (j === i ? x.slice(0, 2) + x.slice(3) : x)).join(' ');
    const dup = tokens.map((x, j) => (j === i ? x.slice(0, 2) + x[2] + x.slice(2) : x)).join(' ');
    return [drop, dup];
  });
  const candidates = [
    name.replace(/ BINTI /, ' BT. '),
    name.replace(/ BIN /, ' B. '),
    name.replace(/^MUHAMMAD /, 'MOHD '),
    name.replace(/^MOHD /, 'MOHD. '),
    name.replace(/ A\/L /, ' AL '),
    name.replace(/ A\/P /, ' AP '),
    ...typos,
  ].filter((c) => c !== name && similarity(c, name) >= BAND.nameSimilarityPassMin);
  return candidates.length ? rng.pick(candidates) : null;
}
