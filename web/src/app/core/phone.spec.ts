import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+60100000001'],
    ['0100000001'],
    ['010-000 0001'],
    ['+60 10-000 0001'],
    ['(010) 000.0001'],
  ])('把 %s 规范成 +60100000001', (input) => {
    expect(normalizePhone(input)).toEqual({ ok: true, e164: '+60100000001' });
  });

  it('接受符合合同 ^\\+[0-9]{8,15}$ 的国际号码', () => {
    expect(normalizePhone('+65 9123 4567')).toEqual({ ok: true, e164: '+6591234567' });
  });

  it('00 开头是国际前缀的另一种写法：0060… 等同于 +60…，不会被当成本地号码重复补 +60', () => {
    expect(normalizePhone('0060123456789')).toEqual({ ok: true, e164: '+60123456789' });
    expect(normalizePhone('0065 9123 4567')).toEqual({ ok: true, e164: '+6591234567' });
  });

  it('空输入：reason = empty', () => {
    expect(normalizePhone('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizePhone('  - ')).toEqual({ ok: false, reason: 'empty' });
  });

  it.each([
    ['abc'],
    ['12345'],
    ['+60'],
    ['+1234567'],
    ['+6010000000000000000'],
    ['0100a00001'],
    ['60100000001'],
  ])('格式错：%s', (input) => {
    expect(normalizePhone(input)).toEqual({ ok: false, reason: 'format' });
  });
});
