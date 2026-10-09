import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { en } from './dict.en';
import { ms } from './dict.ms';
import { I18nService, LANG_STORAGE_KEY, withFallback } from './i18n.service';

// 词典里所有叶子的路径（函数与字符串都算叶子），用来比对两种语言的键是否一致
function leafPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.map((_, i) => `${prefix}[${i}]`);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function make() {
  TestBed.resetTestingModule();
  return TestBed.inject(I18nService);
}

describe('词典', () => {
  it('en 与 ms 的键完全一致', () => {
    expect(leafPaths(en).sort()).toEqual(leafPaths(ms).sort());
  });

  it('每个文案都非空（带参数的函数也要返回非空字符串）', () => {
    const check = (v: unknown, path: string) => {
      if (typeof v === 'string') expect(v.trim().length, path).toBeGreaterThan(0);
      else if (typeof v === 'function') {
        expect(
          String((v as (...a: unknown[]) => string)('x', 2)).trim().length,
          path,
        ).toBeGreaterThan(0);
      } else if (Array.isArray(v)) v.forEach((x, i) => check(x, `${path}[${i}]`));
      else if (v && typeof v === 'object')
        Object.entries(v).forEach(([k, x]) => check(x, `${path}.${k}`));
    };
    check(ms, 'ms');
    check(en, 'en');
  });

  it('两种语言的状态标签都覆盖合同的五个状态值', () => {
    for (const d of [ms, en]) {
      for (const s of ['green', 'yellow', 'red', 'needs_review', 'pending']) {
        expect(d.status[s as keyof typeof d.status]).toBeTruthy();
      }
    }
  });
});

describe('withFallback', () => {
  it('缺的叶子用马来语补上，不显示空白或 key 名', () => {
    const partial = { login: { title: 'Log in' }, months: ['x'] };
    const merged = withFallback(ms, partial);
    expect(merged.login.title).toBe('Log in');
    expect(merged.login.send).toBe(ms.login.send);
    expect(merged.months).toEqual(ms.months); // 数组长度不对就整体回退
    expect(merged.plots.ownerHeader('A', 2)).toBe(ms.plots.ownerHeader('A', 2));
  });

  it('类型对不上时回退', () => {
    expect(withFallback(ms, { login: { title: 42, send: null } }).login.title).toBe(ms.login.title);
  });
});

describe('I18nService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('默认马来语，按钮显示 BM，<html lang> 为 ms', () => {
    const i18n = make();
    expect(i18n.lang()).toBe('ms');
    expect(i18n.t().lang.code).toBe('BM');
    expect(document.documentElement.lang).toBe('ms');
  });

  it('点按钮切到英语：按钮显示 EN，文案与 <html lang> 同步', () => {
    const i18n = make();
    i18n.toggle();
    expect(i18n.lang()).toBe('en');
    expect(i18n.t().lang.code).toBe('EN');
    expect(i18n.t().login.title).toBe(en.login.title);
    expect(document.documentElement.lang).toBe('en');
    i18n.toggle();
    expect(i18n.lang()).toBe('ms');
  });

  it('选择记在本机：重新创建服务（相当于刷新）后仍是所选语言', () => {
    make().toggle();
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
    const reloaded = make();
    expect(reloaded.lang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('本机存了非法值（zh、乱码）：不报错，退回马来语', () => {
    for (const bad of ['zh', 'xx', '', '{"a":1}']) {
      localStorage.setItem(LANG_STORAGE_KEY, bad);
      expect(make().lang(), bad).toBe('ms');
    }
  });

  it('localStorage 读写都抛错：不报错，本会话内仍可切换', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const i18n = make();
    expect(i18n.lang()).toBe('ms');
    expect(() => i18n.toggle()).not.toThrow();
    expect(i18n.lang()).toBe('en');
  });

  it('users.language 只在本机没选过时当默认', () => {
    const i18n = make();
    i18n.applyProfileDefault('en');
    expect(i18n.lang()).toBe('en');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBeNull(); // 默认值不写入本机
  });

  it('users.language 是 zh、缺失或乱码：按马来语处理', () => {
    for (const v of ['zh', undefined, null, 'fr', 3]) {
      expect(make().lang()).toBe('ms');
      const i18n = make();
      i18n.applyProfileDefault(v);
      expect(i18n.lang(), String(v)).toBe('ms');
    }
  });

  it('clearProfileDefault：users.language 带来的英语在回登录页时撤销，回到马来语', () => {
    const i18n = make();
    i18n.applyProfileDefault('en');
    expect(i18n.lang()).toBe('en');
    i18n.clearProfileDefault();
    expect(i18n.lang()).toBe('ms');
    expect(i18n.t().lang.code).toBe('BM');
    expect(document.documentElement.lang).toBe('ms');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBeNull();
  });

  it('clearProfileDefault：本机选过的不动（本会话内点过按钮，或之前存过）', () => {
    const clicked = make();
    clicked.toggle(); // en，已选
    clicked.clearProfileDefault();
    expect(clicked.lang()).toBe('en');

    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const stored = make();
    stored.clearProfileDefault();
    expect(stored.lang()).toBe('en');
  });

  it('本机选过的不会被 users.language 覆盖（包括本会话内刚点过按钮）', () => {
    const i18n = make();
    i18n.toggle(); // en
    i18n.applyProfileDefault('ms');
    expect(i18n.lang()).toBe('en');

    localStorage.setItem(LANG_STORAGE_KEY, 'ms');
    const stored = make();
    stored.applyProfileDefault('en');
    expect(stored.lang()).toBe('ms');
  });
});
