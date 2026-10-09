import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/firebase/auth.service';
import { NotConfiguredError } from '../../core/firebase/firebase';
import { normalizePhone } from '../../core/phone';

type Step = 'phone' | 'code';

const RESEND_SECONDS = 30;

// 文案取自企划书 v3 的屏 1 线框与「状态与文案规范」：说人话，给下一步，不责怪用户。
const TEXT = {
  phoneEmpty: 'Sila masukkan nombor telefon anda.',
  phoneFormat: 'Nombor telefon ini tidak betul. Cuba contoh: 012-345 6789.',
  codeFormat: 'Sila masukkan kod 6 digit daripada SMS.',
  codeWrong: 'Kod tidak betul. Semak SMS anda dan cuba lagi.',
  codeExpired: 'Kod sudah tamat tempoh. Tekan Hantar semula kod.',
  tooMany: 'Terlalu banyak percubaan. Cuba lagi sebentar lagi.',
  network: 'Tiada sambungan. Semak internet anda dan cuba lagi.',
  notConfigured: 'Perkhidmatan belum disediakan.',
  generic: 'Ada masalah. Cuba lagi sebentar lagi.',
} as const;

function messageFor(err: unknown): string {
  if (err instanceof NotConfiguredError) return TEXT.notConfigured;
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/network-request-failed':
      return TEXT.network;
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return TEXT.phoneFormat;
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return TEXT.tooMany;
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return TEXT.codeWrong;
    case 'auth/code-expired':
    case 'auth/session-expired':
      return TEXT.codeExpired;
    default:
      return TEXT.generic;
  }
}

// 最小可用的登录页（脚手架）：两步，手机号 → 验证码。
// 屏 1 的正式界面由 fe/screens-1-3 按 screen-01.png 做，到时替换本页；服务层与错误处理沿用。
@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly recaptcha = viewChild.required<ElementRef<HTMLElement>>('recaptcha');

  readonly step = signal<Step>('phone');
  readonly phone = signal('');
  readonly code = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly cooldown = signal(0);
  /** 验证码已发往的号码（E.164），步骤 2 显示给用户看 */
  readonly sentTo = signal('');

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopCooldown();
      this.auth.resetFlow();
    });
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
      this.error.set(parsed.reason === 'empty' ? TEXT.phoneEmpty : TEXT.phoneFormat);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.sendCode(parsed.e164, this.recaptcha().nativeElement);
      this.sentTo.set(parsed.e164);
      this.code.set('');
      this.step.set('code');
      this.startCooldown();
    } catch (err) {
      this.error.set(messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }

  async confirm(): Promise<void> {
    if (this.busy()) return;
    if (!/^\d{6}$/.test(this.code())) {
      this.error.set(TEXT.codeFormat);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.confirmCode(this.code());
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err) {
      this.error.set(messageFor(err));
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
    this.error.set('');
    this.cooldown.set(0);
    this.step.set('phone');
  }

  submit(): Promise<void> {
    return this.step() === 'phone' ? this.send() : this.confirm();
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
