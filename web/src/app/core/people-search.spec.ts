import { matchesQuery } from './people-search';

describe('matchesQuery', () => {
  it('空查询匹配所有人', () => {
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', '')).toBe(true);
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', '   ')).toBe(true);
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', '/-')).toBe(true);
  });

  it('大小写不敏感，忽略多余空格', () => {
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', 'ahmad')).toBe(true);
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', 'AhMaD')).toBe(true);
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', '  ahmad   zaki ')).toBe(true);
  });

  it('多个词每个都要出现，顺序不限', () => {
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', 'zaki rosli')).toBe(true);
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', 'rosli zaki')).toBe(true);
    expect(matchesQuery('AHMAD ZAKI BIN ROSLI', 'zaki tan')).toBe(false);
  });

  it('a/l、al、a l 三种写法等价，都能命中 A/L', () => {
    const name = 'MUTHU A/L RAMAN';
    expect(matchesQuery(name, 'a/l')).toBe(true);
    expect(matchesQuery(name, 'al')).toBe(true);
    expect(matchesQuery(name, 'a l')).toBe(true);
    expect(matchesQuery(name, 'muthu a/l raman')).toBe(true);
    expect(matchesQuery(name, 'muthu al raman')).toBe(true);
  });

  it('a/l 与 al 的结果集完全相同：词内标点只是去掉，不会把 / 当分隔符', () => {
    const names = [
      'MUTHU A/L RAMAN',
      'SITI AISHAH BINTI ABDULLAH', // 同时含 a 和 l，但没有连着的 al
      'AHMAD ZAKI BIN ROSLI',
      'LAKSHMI A/P SUPPIAH',
      'KAMALA A/P KANNAN',
      'AZMAN BIN SAAD',
    ];
    const hits = (q: string) => names.filter((n) => matchesQuery(n, q));
    expect(hits('a/l')).toEqual(hits('al'));
    expect(hits('a/l')).toContain('MUTHU A/L RAMAN');
    expect(hits('a/l')).not.toContain('SITI AISHAH BINTI ABDULLAH');
    // 「a l」是两个词，范围更宽：这是按空格拆词的正常结果
    expect(hits('a l')).toContain('SITI AISHAH BINTI ABDULLAH');
  });

  it('binti 命中 BINTI；不做同义词展开：bt. 不会命中 BINTI', () => {
    expect(matchesQuery('SITI AISHAH BINTI ABDULLAH', 'binti')).toBe(true);
    expect(matchesQuery('SITI AISHAH BINTI ABDULLAH', 'bt')).toBe(false);
    expect(matchesQuery('SITI AISHAH BINTI ABDULLAH', 'siti binti abdullah')).toBe(true);
  });

  it('没有匹配', () => {
    expect(matchesQuery('TAN AH KOW', 'ahmad')).toBe(false);
    expect(matchesQuery('', 'ahmad')).toBe(false);
  });

  it("被搜的姓名里的标点不影响匹配（O'BRIEN、LIM-TAN）", () => {
    expect(matchesQuery("O'BRIEN", 'obrien')).toBe(true);
    expect(matchesQuery('LIM-TAN MEI', 'limtan')).toBe(true);
    expect(matchesQuery('LIM-TAN MEI', 'lim tan')).toBe(true);
  });
});
