import type { DocState } from '../../core/firebase/firestore-reader';
import { en } from '../../core/i18n/dict.en';
import { ms } from '../../core/i18n/dict.ms';
import type { Load } from '../../core/load-state';
import { plotHeading, plotSubtitle } from './plot-title';
import type { TitleData } from './plot-types';

const data = (value: TitleData | null, fromCache = false): Load<DocState<TitleData>> => ({
  kind: 'data',
  value: { id: 't1', data: value, fromCache },
  fromCache,
});

describe('plotHeading', () => {
  it('没有地契：Lot baharu，不去等 title', () => {
    expect(plotHeading(ms, {}, null)).toEqual({ heading: 'Lot baharu', loading: false });
    expect(plotHeading(ms, { landTitleId: null }, null).heading).toBe('Lot baharu');
    expect(plotHeading(en, {}, null).heading).toBe('New lot');
  });

  it('title 读到了：Lot {lotNo}, {district}；district 优先取 title 的，缺则取 plots 上的', () => {
    const p = { landTitleId: 't1', district: 'Perak Tengah' };
    expect(plotHeading(ms, p, data({ lotNo: '1052', district: 'Kampar' }))).toEqual({
      heading: 'Lot 1052, Kampar',
      loading: false,
    });
    expect(plotHeading(ms, p, data({ lotNo: '1052' })).heading).toBe('Lot 1052, Perak Tengah');
    expect(plotHeading(ms, { landTitleId: 't1' }, data({ lotNo: '1052' })).heading).toBe(
      'Lot 1052',
    );
  });

  it('title 还在读：heading 为 null、loading 为 true（显示骨架）', () => {
    expect(plotHeading(ms, { landTitleId: 't1' }, null)).toEqual({ heading: null, loading: true });
    expect(plotHeading(ms, { landTitleId: 't1' }, { kind: 'loading' })).toEqual({
      heading: null,
      loading: true,
    });
  });

  it('title 确认不存在、没有 lotNo、离线或出错：退回 titleNo／nickname + district，不冒充 Lot baharu', () => {
    const p = {
      landTitleId: 't1',
      titleNo: 'GRN 51234',
      nickname: 'Kebun Utama',
      district: 'Kampar',
    };
    expect(plotHeading(ms, p, data(null)).heading).toBe('GRN 51234, Kampar');
    expect(plotHeading(ms, p, data({})).heading).toBe('GRN 51234, Kampar');
    expect(plotHeading(ms, p, { kind: 'offline' }).heading).toBe('GRN 51234, Kampar');
    expect(plotHeading(ms, p, { kind: 'error' }).heading).toBe('GRN 51234, Kampar');
    // 没有 titleNo 用 nickname；什么都没有写「Belum diisi」
    expect(plotHeading(ms, { ...p, titleNo: null }, data(null)).heading).toBe(
      'Kebun Utama, Kampar',
    );
    expect(plotHeading(ms, { landTitleId: 't1' }, data(null)).heading).toBe('Belum diisi');
  });
});

describe('plotSubtitle', () => {
  const day = new Date('2026-10-02T01:14:00.000Z');

  it('面积 · 日期；面积取 areaHaComputed，缺则 areaHaDeclared', () => {
    expect(plotSubtitle(ms, { areaHaComputed: 4.23, lastAssessedAt: day }, 'ms')).toBe(
      '4.23 ha · 2 Okt',
    );
    expect(plotSubtitle(ms, { areaHaDeclared: 1.5, lastAssessedAt: day }, 'ms')).toBe(
      '1.5 ha · 2 Okt',
    );
  });

  it('没有面积写「Belum diisi」，没有日期就省略；英语月份缩写', () => {
    expect(plotSubtitle(ms, {}, 'ms')).toBe('Belum diisi');
    expect(plotSubtitle(ms, { areaHaComputed: 2.1 }, 'ms')).toBe('2.1 ha');
    expect(plotSubtitle(en, { areaHaComputed: 2.1, lastAssessedAt: day }, 'en')).toBe(
      '2.1 ha · 2 Oct',
    );
  });
});
