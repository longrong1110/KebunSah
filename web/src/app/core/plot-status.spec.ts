import { PLOT_STATUSES, STATUS_VIEW, countByStatus } from './plot-status';

const doc = (status: unknown) => ({ data: { status } });

describe('countByStatus', () => {
  it('五个合同状态值各自计数，总和等于总数', () => {
    const docs = [
      doc('green'),
      doc('green'),
      doc('yellow'),
      doc('red'),
      doc('needs_review'),
      doc('pending'),
    ];
    const c = countByStatus(docs);
    expect(c.total).toBe(6);
    expect(c.byStatus).toEqual({ green: 2, yellow: 1, red: 1, needs_review: 1, pending: 1 });
    expect(c.unknown).toBe(0);
  });

  it('不认识的状态值单独数出来，不吞掉，总数仍对得上', () => {
    const c = countByStatus([doc('green'), doc('purple'), doc(undefined), doc(42)]);
    expect(c.total).toBe(4);
    expect(c.byStatus.green).toBe(1);
    expect(c.unknown).toBe(3);
    expect(Object.values(c.byStatus).reduce((a, b) => a + b, 0) + c.unknown).toBe(c.total);
  });

  it('空集合：全是 0', () => {
    const c = countByStatus([]);
    expect(c.total).toBe(0);
    expect(Object.values(c.byStatus).every((n) => n === 0)).toBe(true);
  });

  it('每个状态都有图标与文字（不只靠颜色）', () => {
    for (const s of PLOT_STATUSES) {
      expect(STATUS_VIEW[s].icon.length).toBeGreaterThan(0);
      expect(STATUS_VIEW[s].label.length).toBeGreaterThan(0);
    }
  });
});
