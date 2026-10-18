import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/firebase/auth.service';
import { NotConfiguredError } from '../../core/firebase/firebase';
import type { Dict } from '../../core/i18n/dict.ms';
import { I18nService } from '../../core/i18n/i18n.service';
import { BrandMark } from '../../shared/brand-mark';
import { LangButton } from '../../shared/lang-button';

/** 错误只存词典的键，不存翻译后的文字：切换语言时已经显示的错误会跟着变 */
export type CoopLoginErrorKey = keyof Dict['coopLogin']['errors'];

/** 评审试用：专门给看板建的演示账号（数据全是模拟的）。点「Isi untuk saya」填进输入框 */
export const DEMO_COOP = { email: 'koperasi@kebunsah.demo', password: 'Koperasi-Demo-2026' } as const;

export function coopLoginErrorKey(err: unknown): CoopLoginErrorKey {
  if (err instanceof NotConfiguredError) return 'notConfigured';
  switch ((err as { code?: string } | null)?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'wrong';
    case 'auth/too-many-requests':
      return 'tooMany';
    case 'auth/network-request-failed':
      return 'network';
    default:
      return 'generic';
  }
}

// 合作社看板的登录（电脑）：邮箱 + 密码，宽屏两栏。手机上的园主和外勤走手机号 + 验证码（/login），两边分开。
@Component({
  selector: 'app-coop-login',
  imports: [BrandMark, LangButton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="coop-login">
      <aside class="coop-login__side">
        <span class="lockup brand"><app-brand-mark /><span>KebunSah</span></span>
        <div class="coop-login__pitch">
          <h2>{{ t().coopLogin.sideTitle }}</h2>
          <p>{{ t().coopLogin.sideLead }}</p>
          <ul>
            @for (note of t().coopLogin.sideNotes; track note) {
              <li><span class="ic ic-check" aria-hidden="true"></span> {{ note }}</li>
            }
          </ul>
        </div>
      </aside>

      <section class="coop-login__main">
        <div class="coop-login__bar"><app-lang-button /></div>
        <form class="coop-login__form" (submit)="submit($event)" novalidate>
          <h1>{{ t().coopLogin.title }}</h1>
          <p class="lead">{{ t().coopLogin.lead }}</p>

          <label for="email">{{ t().coopLogin.emailLabel }}</label>
          <input
            id="email"
            class="field field--text"
            type="email"
            inputmode="email"
            autocomplete="username"
            [value]="email()"
            [attr.aria-invalid]="error() ? 'true' : null"
            aria-describedby="error"
            (input)="email.set($any($event.target).value)"
          />

          <label for="password">{{ t().coopLogin.passwordLabel }}</label>
          <div class="pw">
            <input
              id="password"
              class="field field--text"
              [type]="showPassword() ? 'text' : 'password'"
              autocomplete="current-password"
              [value]="password()"
              [attr.aria-invalid]="error() ? 'true' : null"
              aria-describedby="error"
              (input)="password.set($any($event.target).value)"
            />
            <button type="button" class="btn-link pw__toggle" id="toggle-password" (click)="showPassword.set(!showPassword())">
              {{ showPassword() ? t().coopLogin.hidePassword : t().coopLogin.showPassword }}
            </button>
          </div>

          <div role="alert">
            @if (error(); as key) {
              <p id="error" class="error">
                <span class="ic ic-alert" aria-hidden="true"></span> {{ t().coopLogin.errors[key] }}
              </p>
            }
          </div>

          <button type="submit" class="btn" id="submit" [disabled]="busy()" [attr.aria-busy]="busy()">
            {{ busy() ? t().coopLogin.submitting : t().coopLogin.submit }}
          </button>

          <details class="demo">
            <summary>{{ t().coopLogin.demo.title }}</summary>
            <p class="hint">{{ t().coopLogin.demo.intro }}</p>
            <dl class="demo__creds">
              <dt>{{ t().coopLogin.demo.email }}</dt>
              <dd id="demo-email">{{ demo.email }}</dd>
              <dt>{{ t().coopLogin.demo.password }}</dt>
              <dd id="demo-password">{{ demo.password }}</dd>
            </dl>
            <button type="button" class="btn btn-quiet" id="fill-demo" (click)="fillDemo()">
              {{ t().coopLogin.demo.fill }}
            </button>
          </details>

          <a class="btn-link coop-login__phone" id="phone-app" routerLink="/login">
            <span class="ic ic-chevron" aria-hidden="true"></span> {{ t().coopLogin.phoneApp }}
          </a>
        </form>
      </section>
    </main>
  `,
})
export class CoopLogin {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  protected readonly demo = DEMO_COOP;

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<CoopLoginErrorKey | null>(null);

  constructor() {
    // 登录页只在没登录时可达：上一个账号的 users.language 默认值不能留到这里
    this.i18n.clearProfileDefault();
  }

  protected fillDemo(): void {
    this.email.set(DEMO_COOP.email);
    this.password.set(DEMO_COOP.password);
    this.error.set(null);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    const email = this.email().trim();
    if (!email) return void this.error.set('emailEmpty');
    if (!this.password()) return void this.error.set('passwordEmpty');
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.signInWithEmail(email, this.password());
      await this.router.navigateByUrl('/coop', { replaceUrl: true });
    } catch (err) {
      this.error.set(coopLoginErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }
}
