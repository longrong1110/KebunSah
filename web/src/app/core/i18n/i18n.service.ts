import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { en } from './dict.en';
import { ms, type Dict } from './dict.ms';

export type Lang = 'ms' | 'en';

export const LANG_STORAGE_KEY = 'kebunsah.lang';

const isLang = (v: unknown): v is Lang => v === 'ms' || v === 'en';

/**
 * 把 override 里缺的叶子用 base 补上（类型对不上也回退 base）。
 * 类型系统已经保证 en 与 ms 键一致；这一层是运行时的保险，缺了就显示马来语，而不是空白或 key 名。
 */
export function withFallback<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base)) {
    return (Array.isArray(override) && override.length === base.length ? override : base) as T;
  }
  if (typeof base === 'object' && base !== null) {
    if (typeof override !== 'object') return base;
    const b = base as Record<string, unknown>;
    const o = override as Record<string, unknown>;
    return Object.fromEntries(Object.keys(b).map((k) => [k, withFallback(b[k], o[k])])) as T;
  }
  return (typeof override === typeof base ? override : base) as T;
}

/**
 * 界面语言（BM / EN）。只依赖 DOCUMENT 与 localStorage，不碰 Firebase：
 * 它在根注入，登录页和守卫都会用到，不能把 Firestore 的 SDK 拖进初始包。
 *
 * 优先级：本机选择 ＞ users.language（ms / en，由屏 2 在订阅到 profile 后调用 applyProfileDefault）＞ 马来语。
 * 前端对 Firestore 只读，不能把语言写回 users，所以本机是唯一的持久处。
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly doc = inject(DOCUMENT);
  private chosen: boolean;

  readonly lang = signal<Lang>('ms');
  readonly t = computed<Dict>(() => (this.lang() === 'ms' ? ms : withFallback(ms, en)));

  constructor() {
    const stored = this.read();
    this.chosen = stored !== null;
    this.apply(stored ?? 'ms');
  }

  /** 点语言按钮：只有两种语言，切到另一种，并记在本机 */
  toggle(): void {
    this.set(this.lang() === 'ms' ? 'en' : 'ms');
  }

  set(lang: Lang): void {
    this.chosen = true;
    this.write(lang);
    this.apply(lang);
  }

  /** 登录后用 users.language 当默认；本机选过就不覆盖，zh 或缺失按马来语处理（不改变当前语言） */
  applyProfileDefault(value: unknown): void {
    if (this.chosen) return;
    this.apply(isLang(value) ? value : 'ms');
  }

  /**
   * 回到登录页（此时没有登录）：撤销 users.language 带来的默认值，回到马来语。
   * I18nService 是根单例，登出只是路由跳转，不撤销的话 en 档案的账号登出后登录页还是英语。本机选过的不动。
   */
  clearProfileDefault(): void {
    if (!this.chosen) this.apply('ms');
  }

  private apply(lang: Lang): void {
    this.lang.set(lang);
    this.doc.documentElement.lang = lang;
  }

  // 访问 localStorage 本身在 Safari 隐私模式、被禁用 cookie 时就可能抛错，读写都要包起来
  private storage(): Storage | null {
    try {
      return this.doc.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private read(): Lang | null {
    try {
      const v = this.storage()?.getItem(LANG_STORAGE_KEY);
      return isLang(v) ? v : null;
    } catch {
      return null;
    }
  }

  private write(lang: Lang): void {
    try {
      this.storage()?.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // 存不下就算了：本会话内仍然生效
    }
  }
}
