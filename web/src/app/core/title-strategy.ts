import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import type { Dict } from './i18n/dict.ms';
import { I18nService } from './i18n/i18n.service';

// 每个页面的浏览器标签标题：「<这一屏的名字> — KebunSah」，随界面语言切换。
// 路由用 data: { titleKey } 声明（键在词典的 titles 里）。不用 Angular 自带的 route.title：它是静态字符串，换语言不会更新。
// 没有 titleKey 的路由（档案页）不动标题——那一页自己写带地块号的标题，离开时恢复。

export type TitleKey = keyof Dict['titles'];

const SUFFIX = 'KebunSah';

/** 从根往下找到最深的那条 titleKey（子路由没写就沿用父路由的） */
function titleKeyOf(snapshot: RouterStateSnapshot): TitleKey | null {
  let key: TitleKey | null = null;
  let route: ActivatedRouteSnapshot | null = snapshot.root;
  while (route) {
    const k = route.data?.['titleKey'];
    if (typeof k === 'string') key = k as TitleKey;
    route = route.firstChild;
  }
  return key;
}

@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(I18nService);
  private readonly key = signal<TitleKey | null>(null);

  constructor() {
    super();
    // 路由变了或语言变了，都重写一次标题
    effect(() => {
      const key = this.key();
      if (key) this.title.setTitle(`${this.i18n.t().titles[key]} — ${SUFFIX}`);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key.set(titleKeyOf(snapshot));
  }
}
