import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRng } from '../src/rng.mjs';
import { makeIc, makeIdentity, makeName, nameVariant, maskIc, sha256Hex, identityFromIc } from '../src/people.mjs';
import { NAMES, NAME_BLOCKLIST } from '../src/constants.mjs';
import { similarity } from '../src/similarity.mjs';
import { camelKeys, toCamel, firestoreProblems, TIMESTAMP_FIELDS } from '../src/shape.mjs';
import { resolveEmulatorHost, toValue, toFields } from '../load-emulator.mjs';

test('虚构身份证号：日期合法、出生地代码 01–16、序号首位随年代、末位奇偶对应性别', () => {
  const rng = createRng(2026);
  for (let n = 0; n < 3000; n++) {
    const bornYear = 1930 + (n % 74); // 1930–2003
    const gender = n % 2 ? 'male' : 'female';
    const ic = makeIc(rng, { bornYear, gender });
    assert.match(ic, /^\d{12}$/);
    const [yy, mm, dd, pb] = [ic.slice(0, 2), Number(ic.slice(2, 4)), Number(ic.slice(4, 6)), Number(ic.slice(6, 8))];
    assert.equal(yy, String(bornYear % 100).padStart(2, '0'));
    const d = new Date(Date.UTC(bornYear, mm - 1, dd));
    assert.equal(d.getUTCMonth() + 1, mm, `月份非法：${ic}`);
    assert.equal(d.getUTCDate(), dd, `日期非法：${ic}`);
    assert.ok(pb >= 1 && pb <= 16, `出生地代码 ${pb}`);
    const first = Number(ic[8]);
    if (bornYear < 2000) assert.ok([5, 6, 7].includes(first), `${bornYear} 年出生序号首位 ${first}`);
    else assert.ok([0, 1, 2].includes(first), `${bornYear} 年出生序号首位 ${first}`);
    assert.equal(Number(ic[11]) % 2, gender === 'male' ? 1 : 0);
  }
});

test('闰年 2 月 29 日是合法生日，非闰年不会出现', () => {
  const rng = createRng(9);
  let sawLeapDay = false;
  for (let i = 0; i < 4000; i++) {
    const year = i % 2 ? 1996 : 1997;
    const ic = makeIc(rng, { bornYear: year, gender: 'male' });
    if (ic.slice(2, 6) === '0229') { sawLeapDay = true; assert.equal(year, 1996); }
  }
  assert.ok(sawLeapDay);
});

test('身份证只留哈希与后四位；哈希与 schema.sql 演示的 sha256 一致', () => {
  const ident = identityFromIc('720304075117');
  assert.equal(ident.icLast4, '5117');
  assert.equal(ident.icHash, createHash('sha256').update('720304075117').digest('hex'));
  assert.equal(sha256Hex('x').length, 64);
  assert.equal(maskIc('5117'), '******-**-5117');
  const made = makeIdentity(createRng(3), { bornYear: 1980, gender: 'male' });
  assert.deepEqual(Object.keys(made).sort(), ['icHash', 'icLast4']);
});

test('姓名：全大写，三种族群的写法，名称池里没有政要或头衔用词', () => {
  const rng = createRng(11);
  for (let i = 0; i < 300; i++) {
    const malayM = makeName(rng, 'malay', 'male'), malayF = makeName(rng, 'malay', 'female');
    const indM = makeName(rng, 'indian', 'male'), indF = makeName(rng, 'indian', 'female');
    const chi = makeName(rng, 'chinese', i % 2 ? 'male' : 'female');
    assert.match(malayM, /^[A-Z ]+ BIN [A-Z ]+$/);
    assert.match(malayF, /^[A-Z ]+ BINTI [A-Z ]+$/);
    assert.match(indM, /^[A-Z]+ A\/L [A-Z]+$/);
    assert.match(indF, /^[A-Z]+ A\/P [A-Z]+$/);
    assert.match(chi, /^[A-Z]+ [A-Z ]+$/);
  }
  const words = new Set(Object.values(NAMES).flat().flatMap((s) => s.split(' ')));
  for (const banned of NAME_BLOCKLIST) {
    if (banned.includes(' ')) continue;
    assert.equal(words.has(banned), false, `名称池里出现禁用词 ${banned}`);
  }
  assert.throws(() => makeName(rng, 'martian', 'male'));
});

test('拼写差异：只返回与原名相似度仍 ≥ 0.90 的写法', () => {
  const rng = createRng(5);
  let produced = 0;
  for (let i = 0; i < 200; i++) {
    const name = makeName(rng, i % 3 === 0 ? 'indian' : 'malay', 'male');
    const v = nameVariant(rng, name);
    if (v) { produced++; assert.ok(similarity(v, name) >= 0.9, `${name} → ${v}`); assert.notEqual(v, name); }
  }
  assert.ok(produced > 100, `能造出差异的名字太少：${produced}`);
});

test('映射层：snake→camel 只转第一层键，带点的字段键与 paramsUsed 键保持原样', () => {
  assert.equal(toCamel('area_ha_computed'), 'areaHaComputed');
  assert.equal(toCamel('ic_last4'), 'icLast4');
  const row = camelKeys({ title_no: 'GRN 1', fields: { 'land_title.lot_no': 1 }, params_used: { tol_pct: 10 } });
  assert.deepEqual(Object.keys(row), ['titleNo', 'fields', 'paramsUsed']);
  assert.deepEqual(Object.keys(row.fields), ['land_title.lot_no']);
  assert.deepEqual(Object.keys(row.paramsUsed), ['tol_pct']);
  assert.ok(TIMESTAMP_FIELDS.has('createdAt') && !TIMESTAMP_FIELDS.has('validUntil'));
});

test('Firestore 可写性检查：抓住嵌套数组、undefined、NaN、空键', () => {
  assert.deepEqual(firestoreProblems({ a: [1, 2], b: { c: [{ d: 1 }] } }), []);
  assert.equal(firestoreProblems({ coordinates: [[[1, 2]]] }).length > 0, true); // GeoJSON 原样不行
  assert.equal(firestoreProblems({ x: undefined }).length, 1);
  assert.equal(firestoreProblems({ x: NaN }).length, 1);
  assert.equal(firestoreProblems({ '': 1 }).length, 1);
  assert.deepEqual(firestoreProblems({ polygonGeojson: JSON.stringify({ coordinates: [[[1, 2]]] }) }), []); // 存成字符串就行
});

test('灌入：JSON 转 Firestore 类型化值（整数／小数／时间戳／嵌套）', () => {
  assert.deepEqual(toValue(2008), { integerValue: '2008' });
  assert.deepEqual(toValue(4.2), { doubleValue: 4.2 });
  assert.deepEqual(toValue(null), { nullValue: null });
  assert.deepEqual(toValue('abc', 'nickname'), { stringValue: 'abc' });
  assert.deepEqual(toValue('2026-10-02T01:10:00.000Z', 'createdAt'), { timestampValue: '2026-10-02T01:10:00.000Z' });
  assert.deepEqual(toValue('2026-10-02T01:10:00.000Z', 'note'), { stringValue: '2026-10-02T01:10:00.000Z' }); // 键不在注册表里就不转
  assert.deepEqual(toValue('2027-03-31', 'validUntil'), { stringValue: '2027-03-31' }); // 日期列保持字符串
  const f = toFields({ fields: { 'land_title.lot_no': { confirmedAt: '2026-10-03T02:30:00.000Z', confidence: 0.64 } }, list: [{ a: 1 }] });
  assert.deepEqual(f.fields.mapValue.fields['land_title.lot_no'].mapValue.fields.confirmedAt, { timestampValue: '2026-10-03T02:30:00.000Z' });
  assert.deepEqual(f.list.arrayValue.values[0].mapValue.fields.a, { integerValue: '1' });
});

test('灌入护栏：只认回环地址，没设变量就不连', () => {
  assert.equal(resolveEmulatorHost({}).ok, false);
  assert.equal(resolveEmulatorHost({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).base, 'http://127.0.0.1:8080');
  assert.equal(resolveEmulatorHost({ FIRESTORE_EMULATOR_HOST: 'localhost:9000' }).base, 'http://localhost:9000');
  assert.equal(resolveEmulatorHost({ FIRESTORE_EMULATOR_HOST: 'http://localhost:8080/' }).base, 'http://localhost:8080');
  assert.equal(resolveEmulatorHost({ FIRESTORE_EMULATOR_HOST: '[::1]:8080' }).base, 'http://[::1]:8080');
  for (const bad of ['firestore.googleapis.com:443', '10.0.0.5:8080', '192.168.1.2:8080', 'evil.localhost.com:8080', '0.0.0.0:8080', 'localhost.evil.com']) {
    assert.equal(resolveEmulatorHost({ FIRESTORE_EMULATOR_HOST: bad }).ok, false, bad);
  }
});
