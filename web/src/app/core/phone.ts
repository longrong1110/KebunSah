// 手机号规范化：把用户随手输入的各种写法统一成 E.164（+60…），格式限制与合同 users.phone 一致（^\+[0-9]{8,15}$）。

export type PhoneResult = { ok: true; e164: string } | { ok: false; reason: 'empty' | 'format' };

const E164 = /^\+[0-9]{8,15}$/;

export function normalizePhone(input: string): PhoneResult {
  // 去掉空格、连字符、括号、点：+60 12-345 6789 / (012) 345.6789 都能认
  const s = input.replace(/[\s\-().]/g, '');
  if (s === '') return { ok: false, reason: 'empty' };

  let e164: string;
  if (s.startsWith('+')) {
    e164 = s;
  } else if (s.startsWith('00') && /^\d+$/.test(s)) {
    // 0060… 是国际前缀的另一种写法，等同于 +60…；不能当成本地号码补一遍 +60
    e164 = `+${s.slice(2)}`;
  } else if (s.startsWith('0') && /^\d+$/.test(s)) {
    // 本地写法 012-345 6789：去掉开头的 0，补马来西亚国家码
    e164 = `+60${s.slice(1)}`;
  } else {
    return { ok: false, reason: 'format' };
  }
  return E164.test(e164) ? { ok: true, e164 } : { ok: false, reason: 'format' };
}
