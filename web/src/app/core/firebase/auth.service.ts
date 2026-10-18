import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut as fbSignOut,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { NotConfiguredError, firebaseConfigured, getFirebaseAuth } from './firebase';

// 登录状态的唯一来源。组件和守卫只看 user / ready，不直接碰 firebase/auth。
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** 当前登录的用户；null = 未登录。ready 之前的值不可信。 */
  readonly user = signal<User | null>(null);
  /** 首次读到登录状态（含"没配置所以按未登录"）之后为 true。 */
  readonly ready = signal(false);
  readonly configured = firebaseConfigured();

  private confirmation: ConfirmationResult | null = null;
  private verifier: RecaptchaVerifier | null = null;
  // 声明顺序有讲究：readyResolve 必须在 readyPromise 之前。target 是 ES2022，类字段按声明顺序初始化，
  // 调换后 `readyResolve!` 会在 Promise 构造之后被重置成 undefined，markReady 抛错，路由守卫就会永远等下去。
  private readyResolve!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => (this.readyResolve = resolve));

  constructor() {
    if (!this.configured) {
      this.markReady();
      return;
    }
    const unsubscribe = onAuthStateChanged(
      getFirebaseAuth(),
      (u) => {
        this.user.set(u);
        this.markReady();
      },
      // 读不到登录状态也要放行：按未登录处理，不能让路由守卫一直等
      () => {
        this.user.set(null);
        this.markReady();
      },
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /** 调后端 API 要带的 Firebase ID token；没登录返回 null。SDK 会在快过期时自动刷新。 */
  async idToken(): Promise<string | null> {
    if (!this.configured) return null;
    const user = getFirebaseAuth().currentUser;
    return user ? user.getIdToken() : null;
  }

  /** 路由守卫用：等到首次登录状态确定，避免已登录刷新时闪现登录页。 */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * 给这个手机号发验证码。container 是页面里一个空元素，给不可见的 reCAPTCHA 用。
   * 开发环境（模拟器）下 SDK 会跳过真正的 reCAPTCHA，验证码从模拟器取，见 web/README.md。
   */
  async sendCode(phoneE164: string, container: HTMLElement): Promise<void> {
    if (!this.configured) throw new NotConfiguredError();
    this.clearVerifier();
    const auth = getFirebaseAuth();
    this.verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
    try {
      this.confirmation = await signInWithPhoneNumber(auth, phoneE164, this.verifier);
    } catch (err) {
      // 出错后验证器不能复用，否则下次报 reCAPTCHA has already been rendered
      this.clearVerifier();
      throw err;
    }
  }

  async confirmCode(code: string): Promise<void> {
    if (!this.confirmation) throw new Error('belum-hantar-kod');
    await this.confirmation.confirm(code);
  }

  /** 回到"重新输入号码"：丢掉上一次的会话，免得旧码还能用 */
  resetFlow(): void {
    this.confirmation = null;
    this.clearVerifier();
  }

  async signOut(): Promise<void> {
    this.resetFlow();
    if (this.configured) await fbSignOut(getFirebaseAuth());
  }

  private clearVerifier(): void {
    this.verifier?.clear();
    this.verifier = null;
  }

  private markReady(): void {
    this.ready.set(true);
    this.readyResolve();
  }
}
