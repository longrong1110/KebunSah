import { en } from './i18n/dict.en';
import { ms } from './i18n/dict.ms';
import { PLOT_STATUSES, STATUS_VIEW, countByStatus, statusOf } from './plot-status';

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
});

describe('statusOf', () => {
  it('每个合同状态都有图标、色调，以及两种语言的文字（颜色＋图标＋文字三件套）', () => {
    for (const s of PLOT_STATUSES) {
      const v = statusOf(s);
      expect(v.key).toBe(s);
      expect(v.icon.length).toBeGreaterThan(0);
      expect(STATUS_VIEW[s].tone).toBe(v.tone);
      expect(ms.status[s].length).toBeGreaterThan(0);
      expect(en.status[s].length).toBeGreaterThan(0);
    }
  });

  it('未知值、空值、非字符串：归为 unknown，中性色调，不会被当成绿色', () => {
    for (const bad of ['purple', '', undefined, null, 42, {}]) {
      const v = statusOf(bad);
      expect(v.key, String(bad)).toBe('unknown');
      expect(v.tone).toBe('idle');
      expect(v.icon.length).toBeGreaterThan(0);
    }
    expect(ms.status.unknown.length).toBeGreaterThan(0);
  });

  it('红、黄、绿用不同的图标与色调（不只靠颜色区分）', () => {
    const icons = new Set(['green', 'yellow', 'red'].map((s) => statusOf(s).icon));
    expect(icons.size).toBe(3);
  });
});
