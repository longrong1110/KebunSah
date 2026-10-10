import { formatArea, formatDay, titleCaseName, formatIsoDay } from './format';

describe('formatArea', () => {
  it('取 areaHaComputed，最多 2 位小数、去掉尾零', () => {
    expect(formatArea(4.23, null)).toBe('4.23');
    expect(formatArea(2.1, null)).toBe('2.1');
    expect(formatArea(3, null)).toBe('3');
    expect(formatArea(4.2, null)).toBe('4.2');
    expect(formatArea(3.456, null)).toBe('3.46');
    expect(formatArea(0.004, null)).toBeNull(); // 四舍五入成 0 的面积不显示成「0 ha」
  });

  it('computed 为空（point 地块）时取 areaHaDeclared', () => {
    expect(formatArea(null, 2.5)).toBe('2.5');
    expect(formatArea(undefined, 1.1)).toBe('1.1');
  });

  it('computed 与 declared 都空、为 0 或不是数字：返回 null（卡片显示「Belum diisi」）', () => {
    expect(formatArea(null, null)).toBeNull();
    expect(formatArea(undefined, undefined)).toBeNull();
    expect(formatArea(0, null)).toBeNull();
    expect(formatArea('3', null)).toBeNull();
    expect(formatArea(Number.NaN, null)).toBeNull();
  });
});

describe('formatDay', () => {
  it('写成「5 Okt」：日不补零，月份缩写按语言', () => {
    const d = new Date('2026-10-05T04:00:00Z'); // 马来西亚时间 12:00
    expect(formatDay(d, 'ms')).toBe('5 Okt');
    expect(formatDay(d, 'en')).toBe('5 Oct');
  });

  it('马来语与英语的月份缩写不同的几个月', () => {
    expect(formatDay(new Date('2026-03-10T04:00:00Z'), 'ms')).toBe('10 Mac');
    expect(formatDay(new Date('2026-03-10T04:00:00Z'), 'en')).toBe('10 Mar');
    expect(formatDay(new Date('2026-05-02T04:00:00Z'), 'ms')).toBe('2 Mei');
    expect(formatDay(new Date('2026-08-31T04:00:00Z'), 'ms')).toBe('31 Ogo');
    expect(formatDay(new Date('2026-12-25T04:00:00Z'), 'ms')).toBe('25 Dis');
  });

  it('固定按马来西亚时间（UTC+8）算日期：UTC 的 17:00 已经是第二天', () => {
    expect(formatDay(new Date('2026-10-05T17:00:00Z'), 'ms')).toBe('6 Okt');
    expect(formatDay(new Date('2026-10-05T15:59:00Z'), 'ms')).toBe('5 Okt');
    expect(formatDay(new Date('2026-12-31T16:30:00Z'), 'ms')).toBe('1 Jan'); // 跨年
  });

  it('空、无效日期、不是 Date：返回 null（调用方整段省略）', () => {
    expect(formatDay(null, 'ms')).toBeNull();
    expect(formatDay(undefined, 'ms')).toBeNull();
    expect(formatDay(new Date('nope'), 'ms')).toBeNull();
    expect(formatDay('2026-10-05', 'ms')).toBeNull();
  });
});

describe('titleCaseName', () => {
  it('词首大写，bin / binti / a/l / a/p 保持小写', () => {
    expect(titleCaseName('AHMAD ZAKI BIN ROSLI')).toBe('Ahmad Zaki bin Rosli');
    expect(titleCaseName('SITI AISHAH BINTI ABDULLAH')).toBe('Siti Aishah binti Abdullah');
    expect(titleCaseName('MUTHU A/L RAMAN')).toBe('Muthu a/l Raman');
    expect(titleCaseName('KAMALA A/P KANNAN')).toBe('Kamala a/p Kannan');
    expect(titleCaseName('TAN AH KOW')).toBe('Tan Ah Kow');
  });

  it('撇号、连字符、多余空格也能处理', () => {
    expect(titleCaseName("O'BRIEN")).toBe("O'Brien");
    expect(titleCaseName('LIM-TAN  MEI')).toBe('Lim-Tan Mei');
    expect(titleCaseName('  ZAKI ')).toBe('Zaki');
    expect(titleCaseName('')).toBe('');
  });
});

describe('formatIsoDay', () => {
  it('2026-04-30 → 30 Apr 2026；月份缩写按语言', () => {
    expect(formatIsoDay('2026-04-30', 'ms')).toBe('30 Apr 2026');
    expect(formatIsoDay('2026-05-09', 'ms')).toBe('9 Mei 2026');
    expect(formatIsoDay('2026-05-09', 'en')).toBe('9 May 2026');
    expect(formatIsoDay('2026-12-25', 'ms')).toBe('25 Dis 2026');
  });

  it('以日期开头的字符串也行（后端写的「2026-04-30 已过期」）', () => {
    expect(formatIsoDay('2026-04-30 已过期', 'en')).toBe('30 Apr 2026');
  });

  it('不是合法日期：null（不显示 NaN）', () => {
    for (const bad of [
      '2026-13-01',
      '2026-02-30',
      '2026-00-10',
      '2026-04-31',
      '26-04-30',
      '2026-4-30',
      '2026-04-300',
      '',
      'x',
      null,
      undefined,
      20260430,
      new Date(),
    ]) {
      expect(formatIsoDay(bad, 'ms'), String(bad)).toBeNull();
    }
  });

  it('闰年的 2 月 29 日合法，平年不合法', () => {
    expect(formatIsoDay('2028-02-29', 'en')).toBe('29 Feb 2028');
    expect(formatIsoDay('2026-02-29', 'en')).toBeNull();
  });
});
