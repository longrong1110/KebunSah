import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { PlotCard } from './plot-card';
import type { PlotItem } from './plot-types';

@Component({
  imports: [PlotCard],
  template: `<app-plot-card [plot]="plot()" />`,
})
class Host {
  readonly plot = signal<PlotItem>({ id: 'p1', data: {} });
}

function setup(plot: PlotItem) {
  localStorage.clear();
  const facade = new FakeFacade();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: FIRESTORE_FACADE, useValue: facade }],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.plot.set(plot);
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    facade,
    i18n: TestBed.inject(I18nService),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    title: () => el.querySelector('.plot-card__title')?.textContent?.trim() ?? null,
    meta: () => el.querySelector('.plot-card__meta')?.textContent?.trim() ?? null,
    chip: () => el.querySelector('.chip')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    skeleton: () => el.querySelector('.skeleton--title') !== null,
    card: () => el.querySelector('.plot-card') as HTMLElement,
    link: () => el.querySelector('a.plot-card') as HTMLAnchorElement | null,
  };
}

const base = {
  landTitleId: 't1',
  status: 'green',
  areaHaComputed: 4.23,
  lastAssessedAt: new Date('2026-10-05T04:00:00Z'), // 马来西亚时间 5 Okt 中午
  district: 'Kampar',
  titleNo: 'GRN 51234',
  nickname: 'Kebun Utama',
};

describe('PlotCard', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('有地契：标题 Lot {lotNo}, {district}（来自 titles/{id}），第二行「面积 · 日期」，状态三件套', async () => {
    const { fixture, facade, title, meta, chip } = setup({ id: 'p1', data: base });
    await settle(fixture);
    facade.emitDoc('titles/t1', { lotNo: '1052', district: 'Kampar' });
    await settle(fixture);
    expect(title()).toBe('Lot 1052, Kampar');
    expect(meta()).toBe('4.23 ha · 5 Okt');
    expect(chip()).toBe('✓Lengkap');
  });

  it('没有 landTitleId：Lot baharu · Belum diisi · Belum mula，且不去读 titles', async () => {
    const { fixture, facade, title, meta, chip } = setup({
      id: 'p2',
      data: { landTitleId: null, status: 'pending' },
    });
    await settle(fixture);
    expect(title()).toBe('Lot baharu');
    expect(meta()).toBe('Belum diisi');
    expect(chip()).toBe('○Belum mula');
    expect(facade.docs.length).toBe(0);
  });

  it('面积：computed 为空（point 地块）取 declared；都空显示 Belum diisi；日期为空整段省略', async () => {
    const a = setup({ id: 'p1', data: { ...base, areaHaComputed: null, areaHaDeclared: 2.5 } });
    await settle(a.fixture);
    a.facade.emitDoc('titles/t1', { lotNo: '1', district: 'K' });
    await settle(a.fixture);
    expect(a.meta()).toBe('2.5 ha · 5 Okt');
    TestBed.resetTestingModule();

    const b = setup({
      id: 'p1',
      data: { ...base, areaHaComputed: null, areaHaDeclared: null, lastAssessedAt: null },
    });
    await settle(b.fixture);
    b.facade.emitDoc('titles/t1', { lotNo: '1', district: 'K' });
    await settle(b.fixture);
    expect(b.meta()).toBe('Belum diisi');
  });

  it('title 还在读：显示骨架，不冒充 Lot baharu；10 秒仍读不到就退回 titleNo + district', async () => {
    vi.useFakeTimers();
    const { fixture, skeleton, title } = setup({ id: 'p1', data: base });
    await settle(fixture);
    expect(skeleton()).toBe(true);
    expect(title()).toBeNull();
    vi.advanceTimersByTime(10_000);
    await settle(fixture);
    expect(skeleton()).toBe(false);
    expect(title()).toBe('GRN 51234, Kampar');
  });

  it('缓存里的 title「不存在」不能下结论（仍是骨架）；服务器确认不存在才退回', async () => {
    const { fixture, facade, skeleton, title } = setup({ id: 'p1', data: base });
    await settle(fixture);
    facade.emitDoc('titles/t1', null, true);
    await settle(fixture);
    expect(skeleton()).toBe(true);
    facade.emitDoc('titles/t1', null, false);
    await settle(fixture);
    expect(title()).toBe('GRN 51234, Kampar');
  });

  it('退回时没有 titleNo 就用 nickname；什么都没有显示 Belum diisi', async () => {
    const { fixture, facade, title } = setup({
      id: 'p1',
      data: { ...base, titleNo: null, district: null },
    });
    await settle(fixture);
    facade.emitDoc('titles/t1', null, false);
    await settle(fixture);
    expect(title()).toBe('Kebun Utama');
    TestBed.resetTestingModule();

    const b = setup({
      id: 'p1',
      data: { landTitleId: 't1', titleNo: null, nickname: null, district: null },
    });
    await settle(b.fixture);
    b.facade.emitDoc('titles/t1', null, false);
    await settle(b.fixture);
    expect(b.title()).toBe('Belum diisi');
  });

  it('title 读取出错：退回，不崩', async () => {
    const { fixture, facade, title } = setup({ id: 'p1', data: base });
    await settle(fixture);
    facade.failDoc('titles/t1');
    await settle(fixture);
    expect(title()).toBe('GRN 51234, Kampar');
  });

  it('title 里没有 district 时用 plots 上复制的；两边都没有就只显示 Lot {lotNo}（没有多余的逗号）', async () => {
    const a = setup({ id: 'p1', data: base });
    await settle(a.fixture);
    a.facade.emitDoc('titles/t1', { lotNo: '1052' });
    await settle(a.fixture);
    expect(a.title()).toBe('Lot 1052, Kampar');
    TestBed.resetTestingModule();

    const b = setup({ id: 'p1', data: { ...base, district: null } });
    await settle(b.fixture);
    b.facade.emitDoc('titles/t1', { lotNo: '1052' });
    await settle(b.fixture);
    expect(b.title()).toBe('Lot 1052');
  });

  it('状态：黄色卡片着底色（plot-card--warn）；未知状态显示中性芯片，不是绿色', async () => {
    const y = setup({ id: 'p1', data: { ...base, status: 'yellow' } });
    await settle(y.fixture);
    expect(y.card().classList.contains('plot-card--warn')).toBe(true);
    expect(y.chip()).toBe('⚠Perlu semakan');
    TestBed.resetTestingModule();

    const u = setup({ id: 'p1', data: { ...base, status: 'purple' } });
    await settle(u.fixture);
    expect(u.card().classList.contains('plot-card--warn')).toBe(false);
    expect(u.chip()).toBe('?Tidak diketahui');
    expect(u.card().querySelector('.tone-ok')).toBeNull();
  });

  it('另外三个状态的图标与文字：红、需人工复核、待开始', async () => {
    for (const [status, label] of [
      ['red', '✕Perlu tindakan'],
      ['needs_review', '?Menunggu pegawai'],
      ['pending', '○Belum mula'],
    ] as const) {
      const c = setup({ id: 'p1', data: { ...base, status } });
      await settle(c.fixture);
      expect(c.chip(), status).toBe(label);
      TestBed.resetTestingModule();
    }
  });

  it('切到英语：月份缩写、芯片文字、标题都跟着变', async () => {
    const { fixture, facade, i18n, title, meta, chip } = setup({ id: 'p1', data: base });
    await settle(fixture);
    facade.emitDoc('titles/t1', { lotNo: '1052', district: 'Kampar' });
    await settle(fixture);
    i18n.toggle();
    await settle(fixture);
    expect(meta()).toBe('4.23 ha · 5 Oct');
    expect(chip()).toBe('✓Complete');
    expect(title()).toBe('Lot 1052, Kampar');
  });

  it('销毁后取消 titles 监听', async () => {
    const { fixture, facade } = setup({ id: 'p1', data: base });
    await settle(fixture);
    expect(facade.activeDocs('titles/t1').length).toBe(1);
    fixture.destroy();
    expect(facade.activeCount).toBe(0);
  });

  it('换了一块地（输入变化）：旧 title 监听取消，订阅新的', async () => {
    const { fixture, facade } = setup({ id: 'p1', data: base });
    await settle(fixture);
    fixture.componentInstance.plot.set({ id: 'p9', data: { ...base, landTitleId: 't9' } });
    await settle(fixture);
    expect(facade.activeDocs('titles/t1').length).toBe(0);
    expect(facade.activeDocs('titles/t9').length).toBe(1);
  });

  it('整张卡片是链接，指向 /plots/{id}（点进屏 9）；可聚焦，名称里有标题和状态文字', async () => {
    const t = setup({ id: 'abc-1', data: { ...base, status: 'yellow' } });
    t.fixture.detectChanges();
    t.facade.emitDoc('titles/t1', { lotNo: '1052', district: 'Kampar' });
    await settle(t.fixture);
    const link = t.link()!;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/plots/abc-1');
    expect(link.tabIndex).toBeGreaterThanOrEqual(0);
    const name = (link.textContent ?? '').replace(/\s+/g, ' ');
    expect(name).toContain('Lot 1052, Kampar');
    expect(name).toContain('Perlu semakan');
  });

  it('外勤在 ?member 视图里：链接保留 ?member，点进屏 9 再返回仍停在该成员', async () => {
    const t = setup({ id: 'abc-1', data: { ...base } });
    await TestBed.inject(Router).navigateByUrl('/?member=m9');
    t.fixture.detectChanges();
    await settle(t.fixture);
    expect(t.link()!.getAttribute('href')).toBe('/plots/abc-1?member=m9');
  });

  it('地块还没有评估（pending）的卡片也能点进去', () => {
    const t = setup({ id: 'p9', data: { status: 'pending' } });
    t.fixture.detectChanges();
    expect(t.link()!.getAttribute('href')).toBe('/plots/p9');
  });
});
