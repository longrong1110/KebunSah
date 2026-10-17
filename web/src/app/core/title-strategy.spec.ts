import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Route, Router, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from '../app.config';
import { routes } from '../app.routes';
import { en } from './i18n/dict.en';
import { ms } from './i18n/dict.ms';
import { I18nService } from './i18n/i18n.service';
import { AppTitleStrategy } from './title-strategy';

@Component({ template: '' })
class Blank {}

async function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'login', component: Blank, data: { titleKey: 'login' } },
        { path: 'coop', component: Blank, data: { titleKey: 'coop' } },
        { path: 'plots/:id/dossier', component: Blank }, // 没有 titleKey：这一页自己写标题
      ]),
      { provide: TitleStrategy, useExisting: AppTitleStrategy },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const title = TestBed.inject(Title);
  const i18n = TestBed.inject(I18nService);
  const go = async (url: string) => {
    await harness.navigateByUrl(url);
    TestBed.tick();
  };
  return { title, i18n, go, router: TestBed.inject(Router) };
}

describe('AppTitleStrategy（页面标题）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('进入页面：标题是「这一屏的名字 — KebunSah」（默认马来语）', async () => {
    const t = await setup();
    await t.go('/login');
    expect(t.title.getTitle()).toBe(`${ms.titles.login} — KebunSah`);
    await t.go('/coop');
    expect(t.title.getTitle()).toBe(`${ms.titles.coop} — KebunSah`);
  });

  it('切换语言：标题即时变成英文，再切回来变回马来语', async () => {
    const t = await setup();
    await t.go('/coop');
    t.i18n.set('en');
    TestBed.tick();
    expect(t.title.getTitle()).toBe(`${en.titles.coop} — KebunSah`);
    t.i18n.set('ms');
    TestBed.tick();
    expect(t.title.getTitle()).toBe(`${ms.titles.coop} — KebunSah`);
  });

  it('没有 titleKey 的路由（档案页）：不动标题，由页面自己写', async () => {
    const t = await setup();
    await t.go('/coop');
    t.title.setTitle('KebunSah dossier — Lot 2217, Kampar');
    await t.go('/plots/p1/dossier');
    expect(t.title.getTitle()).toBe('KebunSah dossier — Lot 2217, Kampar');
    // 在这一页切语言，也不会把页面自己写的标题盖掉
    t.i18n.set('en');
    TestBed.tick();
    expect(t.title.getTitle()).toBe('KebunSah dossier — Lot 2217, Kampar');
  });

  it('真实的 appConfig 把 TitleStrategy 接到 AppTitleStrategy（漏了的话所有页面标题会静默退回「KebunSah」）', () => {
    const wired = (appConfig.providers as unknown[]).some(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        (p as { provide?: unknown }).provide === TitleStrategy &&
        (p as { useExisting?: unknown }).useExisting === AppTitleStrategy,
    );
    expect(wired).toBe(true);
  });

  it('真实路由表：每条要显示页面的路由都声明了标题（档案页除外），键在词典里都有', () => {
    const missing: string[] = [];
    const walk = (list: Route[]) => {
      for (const r of list) {
        if (r.loadComponent || r.component) {
          const key = r.data?.['titleKey'] as string | undefined;
          if (r.path === 'plots/:id/dossier') {
            if (key) missing.push(`${r.path}: 档案页不该声明 titleKey`);
          } else if (!key) {
            missing.push(`${r.path ?? '(空)'}: 缺 titleKey`);
          } else if (!(key in ms.titles) || !(key in en.titles)) {
            missing.push(`${r.path}: 词典里没有 ${key}`);
          }
        }
        if (r.children) walk(r.children);
      }
    };
    walk(routes);
    expect(missing).toEqual([]);
  });
});
