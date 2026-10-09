import { Timestamp } from 'firebase/firestore';
import { convertTimestamps } from './timestamps';

describe('convertTimestamps', () => {
  it('顶层与嵌套的 Timestamp 都转成 Date', () => {
    const when = new Date('2026-10-05T04:00:00Z');
    // convertTimestamps 的静态类型是入参类型，运行时才是 Date：这里标成转换后的形状
    const out = convertTimestamps({
      lastAssessedAt: Timestamp.fromDate(when),
      fields: { 'land_title.lot_no': { confirmedAt: Timestamp.fromDate(when) } },
      list: [{ at: Timestamp.fromDate(when) }, Timestamp.fromDate(when)],
    }) as unknown as {
      lastAssessedAt: Date;
      fields: Record<string, { confirmedAt: Date }>;
      list: unknown[];
    };
    expect(out.lastAssessedAt).toBeInstanceOf(Date);
    expect(out.lastAssessedAt.getTime()).toBe(when.getTime());
    expect(out.fields['land_title.lot_no'].confirmedAt).toBeInstanceOf(Date);
    expect(out.list[0]).toEqual({ at: when });
    expect(out.list[1]).toEqual(when);
  });

  it('其他值原样不变：字符串（含日期列）、数字、布尔、null、undefined', () => {
    const input = {
      validUntil: '2027-03-31',
      n: 4.2,
      ok: true,
      none: null,
      missing: undefined,
      s: 'x',
    };
    expect(convertTimestamps(input)).toEqual(input);
  });

  it('已经是 Date 的不动，也不会被拆成空对象', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const out = convertTimestamps({ d });
    expect(out.d).toBe(d);
  });

  it('不修改入参', () => {
    const when = Timestamp.fromDate(new Date('2026-10-05T04:00:00Z'));
    const input = { at: when };
    convertTimestamps(input);
    expect(input.at).toBe(when);
  });

  it('null、基本类型也能直接传', () => {
    expect(convertTimestamps(null)).toBeNull();
    expect(convertTimestamps('x')).toBe('x');
    expect(convertTimestamps(3)).toBe(3);
  });
});
