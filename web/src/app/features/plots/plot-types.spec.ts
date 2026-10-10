import { sortPlots, type PlotItem } from './plot-types';

const plot = (id: string, at: Date | null | undefined): PlotItem => ({
  id,
  data: { lastAssessedAt: at },
});

describe('sortPlots', () => {
  it('按评估时间新→旧排', () => {
    const out = sortPlots([
      plot('a', new Date('2026-10-01T00:00:00Z')),
      plot('b', new Date('2026-10-05T00:00:00Z')),
      plot('c', new Date('2026-10-03T00:00:00Z')),
    ]);
    expect(out.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('没有时间（null、undefined、无效日期）的排最后', () => {
    const out = sortPlots([
      plot('n', null),
      plot('a', new Date('2026-10-01T00:00:00Z')),
      plot('u', undefined),
      plot('bad', new Date('nope')),
    ]);
    expect(out[0].id).toBe('a');
    expect(out.slice(1).map((p) => p.id)).toEqual(['bad', 'n', 'u']); // 同为无时间：按 id 稳定
  });

  it('时间相同按 id，每次顺序一样', () => {
    const t = new Date('2026-10-01T00:00:00Z');
    const input = [plot('b', t), plot('c', t), plot('a', t)];
    expect(sortPlots(input).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(sortPlots([...input].reverse()).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('不修改入参', () => {
    const input = [plot('b', null), plot('a', new Date('2026-10-01T00:00:00Z'))];
    sortPlots(input);
    expect(input.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
