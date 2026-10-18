import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/firebase/auth.service';
import { NotConfiguredError } from '../../core/firebase/firebase';
import type { Dict } from '../../core/i18n/dict.ms';
import { I18nService } from '../../core/i18n/i18n.service';
import { normalizePhone } from '../../core/phone';
import { BrandMark } from '../../shared/brand-mark';
import { LangButton } from '../../shared/lang-button';

type Step = 'phone' | 'code';

/** 错误只存词典的键，不存翻译后的文字：切换语言时已经显示的错误会跟着变 */
export type LoginErrorKey = keyof Dict['login']['errors'];

const RESEND_SECONDS = 30;

/** 评审试用：Firebase 控制台里登记的测试号（不发真短信，验证码固定 123456）。点一下填进输入框 */
export const DEMO_NUMBERS = [
  { role: 'smallholder', phone: '+60 10-000 0011' },
  { role: 'smallholderYellow', phone: '+60 10-000 0012' },
  { role: 'smallholderRed', phone: '+60 10-000 0013' },
  { role: 'officer', phone: '+60 10-000 0001' },
  { role: 'admin', phone: '+60 10-000 0002' },
] as const;

function errorKeyFor(err: unknown): LoginErrorKey {
  if (err instanceof NotConfiguredError) return 'notConfigured';
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'phoneFormat';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'tooMany';
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return 'codeWrong';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'codeExpired';
    default:
      return 'generic';
  }
}

// 屏 1 登录（线框 docs/ui/screen-01.png）：两步，手机号 → 验证码；右上角常驻语言按钮。
@Component({
  selector: 'app-login',
  imports: [BrandMark, LangButton],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly recaptcha = viewChild.required<ElementRef<HTMLElement>>('recaptcha');
  private readonly phoneInput = viewChild<ElementRef<HTMLInputElement>>('phoneInput');
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private readonly injector = inject(Injector);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly demoNumbers = DEMO_NUMBERS;

  readonly step = signal<Step>('phone');
  readonly phone = signal('');
  readonly code = signal('');
  readonly busy = signal(false);
  readonly error = signal<LoginErrorKey | null>(null);
  readonly cooldown = signal(0);
  /** 验证码已发往的号码（E.164），步骤 2 显示给用户看 */
  readonly sentTo = signal('');

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 登录页只在没登录时可达：上一个账号的 users.language 默认值不能留到这里（本机选过的不动）
    this.i18n.clearProfileDefault();
    inject(DestroyRef).onDestroy(() => {
      this.stopCooldown();
      this.auth.resetFlow();
    });
  }

  /** 点一个试用号：填进输入框（验证码是 123456，页面上写着） */
  useDemo(phone: string): void {
    this.phone.set(phone);
    this.error.set(null);
    this.focusField();
  }

  onPhone(event: Event): void {
    this.phone.set((event.target as HTMLInputElement).value);
  }

  onCode(event: Event): void {
    // 只留数字，最多 6 位。清洗后要写回输入框：清洗结果和旧值相同时 [value] 绑定不会重写 DOM，用户会看到残留的字母
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = cleaned;
    this.code.set(cleaned);
  }

  async send(): Promise<void> {
    if (this.busy()) return;
    const parsed = normalizePhone(this.phone());
    if (!parsed.ok) {
      this.error.set(parsed.reason === 'empty' ? 'phoneEmpty' : 'phoneFormat');
      this.focusField();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.sendCode(parsed.e164, this.recaptcha().nativeElement);
      this.sentTo.set(parsed.e164);
      this.code.set('');
      this.step.set('code');
      this.startCooldown();
    } catch (err) {
      this.error.set(errorKeyFor(err));
    } finally {
      this.busy.set(false);
      this.focusField();
    }
  }

  async confirm(): Promise<void> {
    if (this.busy()) return;
    if (!/^\d{6}$/.test(this.code())) {
      this.error.set('codeFormat');
      this.focusField();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.confirmCode(this.code());
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err) {
      this.error.set(errorKeyFor(err));
      this.focusField();
    } finally {
      this.busy.set(false);
    }
  }

  /** 重发：以新码为准；倒计时没走完不能点 */
  async resend(): Promise<void> {
    if (this.busy() || this.cooldown() > 0) return;
    await this.send();
  }

  changeNumber(): void {
    this.stopCooldown();
    this.auth.resetFlow();
    this.code.set('');
    this.error.set(null);
    this.cooldown.set(0);
    this.step.set('phone');
    this.focusField();
  }

  submit(): Promise<void> {
    return this.step() === 'phone' ? this.send() : this.confirm();
  }

  /**
   * 把焦点交给当前步骤的输入框。提交时按钮会被禁用（失去焦点，回到 body），步骤切换后原来的按钮也不再是用户要去的地方；
   * 键盘和读屏用户要落在新出现的输入框（或出错的那一格）上。等下一次渲染之后再聚焦，输入框才在页面里。
   */
  private focusField(): void {
    afterNextRender(
      () => {
        const ref = this.step() === 'phone' ? this.phoneInput() : this.codeInput();
        ref?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  private startCooldown(): void {
    this.stopCooldown();
    this.cooldown.set(RESEND_SECONDS);
    this.timer = setInterval(() => {
      const next = this.cooldown() - 1;
      this.cooldown.set(Math.max(next, 0));
      if (next <= 0) this.stopCooldown();
    }, 1000);
  }

  private stopCooldown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
