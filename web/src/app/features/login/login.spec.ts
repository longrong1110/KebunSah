import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/firebase/auth.service';
import { NotConfiguredError } from '../../core/firebase/firebase';
import { en } from '../../core/i18n/dict.en';
import { ms } from '../../core/i18n/dict.ms';
import { I18nService } from '../../core/i18n/i18n.service';
import { Login } from './login';

function setup(
  overrides: Partial<Record<'sendCode' | 'confirmCode', ReturnType<typeof vi.fn>>> = {},
  /** 在登录页创建之前先动一下语言服务（模拟上一个账号登出前的状态） */
  prepare?: (i18n: I18nService) => void,
) {
  const auth = {
    sendCode: overrides.sendCode ?? vi.fn().mockResolvedValue(undefined),
    confirmCode: overrides.confirmCode ?? vi.fn().mockResolvedValue(undefined),
    resetFlow: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  });
  prepare?.(TestBed.inject(I18nService));
  const fixture: ComponentFixture<Login> = TestBed.createComponent(Login);
  fixture.detectChanges();
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    c: fixture.componentInstance,
    auth,
    navigate,
    i18n: TestBed.inject(I18nService),
    text: () => el.textContent ?? '',
    errorText: () => el.querySelector('#error')?.textContent?.replace('⚠', '').trim() ?? '',
  };
}

describe('Login', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('号码为空：不发请求，显示马来语提示，输入保留', async () => {
    const { c, auth, fixture, errorText } = setup();
    await c.send();
    fixture.detectChanges();
    expect(auth.sendCode).not.toHaveBeenCalled();
    expect(c.error()).toBe('phoneEmpty');
    expect(errorText()).toBe(ms.login.errors.phoneEmpty);
    expect(c.step()).toBe('phone');
  });

  it('号码格式错：不发请求，输入保留', async () => {
    const { c, auth } = setup();
    c.phone.set('abc');
    await c.send();
    expect(auth.sendCode).not.toHaveBeenCalled();
    expect(c.error()).toBe('phoneFormat');
    expect(c.phone()).toBe('abc');
  });

  it('本地写法规范成 +60… 再发送，成功后进入步骤 2 并显示发往的号码', async () => {
    const { c, auth, fixture, text } = setup();
    c.phone.set('010-000 0001');
    await c.send();
    expect(auth.sendCode).toHaveBeenCalledWith('+60100000001', expect.any(HTMLElement));
    expect(c.step()).toBe('code');
    expect(c.cooldown()).toBe(30);
    fixture.detectChanges();
    expect(text()).toContain('+60100000001');
  });

  it('发送中不可重复触发', async () => {
    let release!: () => void;
    const sendCode = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { c } = setup({ sendCode });
    c.phone.set('+60100000001');
    const first = c.send();
    expect(c.busy()).toBe(true);
    await c.send();
    expect(sendCode).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(c.busy()).toBe(false);
  });

  it('验证码不足 6 位：不发请求', async () => {
    const { c, auth } = setup();
    c.step.set('code');
    c.code.set('123');
    await c.confirm();
    expect(auth.confirmCode).not.toHaveBeenCalled();
    expect(c.error()).toBe('codeFormat');
  });

  it('验证码正确：登录后回到 /', async () => {
    const { c, auth, navigate } = setup();
    c.step.set('code');
    c.code.set('123456');
    await c.confirm();
    expect(auth.confirmCode).toHaveBeenCalledWith('123456');
    expect(navigate).toHaveBeenCalledWith('/', { replaceUrl: true });
  });

  it('验证码错：提示后停在步骤 2，号码保留，可重输', async () => {
    const confirmCode = vi.fn().mockRejectedValue({ code: 'auth/invalid-verification-code' });
    const { c, navigate } = setup({ confirmCode });
    c.phone.set('+60100000001');
    c.step.set('code');
    c.code.set('000000');
    await c.confirm();
    expect(c.error()).toBe('codeWrong');
    expect(c.step()).toBe('code');
    expect(c.phone()).toBe('+60100000001');
    expect(navigate).not.toHaveBeenCalled();
    expect(c.busy()).toBe(false);
  });

  it('网络错误：显示提示，按钮恢复可点', async () => {
    const sendCode = vi.fn().mockRejectedValue({ code: 'auth/network-request-failed' });
    const { c } = setup({ sendCode });
    c.phone.set('+60100000001');
    await c.send();
    expect(c.error()).toBe('network');
    expect(c.busy()).toBe(false);
  });

  it('生产配置为空：显示"服务尚未配置"', async () => {
    const sendCode = vi.fn().mockRejectedValue(new NotConfiguredError());
    const { c } = setup({ sendCode });
    c.phone.set('+60100000001');
    await c.send();
    expect(c.error()).toBe('notConfigured');
  });

  it('其他错误码：显示通用提示，不暴露原始错误', async () => {
    const sendCode = vi.fn().mockRejectedValue({ code: 'auth/internal-error', message: 'boom' });
    const { c, fixture, text } = setup({ sendCode });
    c.phone.set('+60100000001');
    await c.send();
    fixture.detectChanges();
    expect(c.error()).toBe('generic');
    expect(text()).not.toContain('auth/internal-error');
  });

  it('重发有 30 秒倒计时，没走完不能重发，走完可以', async () => {
    vi.useFakeTimers();
    const { c, auth } = setup();
    c.phone.set('+60100000001');
    await c.send();
    await c.resend();
    expect(auth.sendCode).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29_000);
    expect(c.cooldown()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(c.cooldown()).toBe(0);
    await c.resend();
    expect(auth.sendCode).toHaveBeenCalledTimes(2);
  });

  it('换号码：回到步骤 1，不残留旧码、旧错误、倒计时', async () => {
    const { c, auth } = setup();
    c.phone.set('+60100000001');
    await c.send();
    c.code.set('123');
    c.error.set('generic');
    c.changeNumber();
    expect(c.step()).toBe('phone');
    expect(c.code()).toBe('');
    expect(c.error()).toBeNull();
    expect(c.cooldown()).toBe(0);
    expect(auth.resetFlow).toHaveBeenCalled();
  });
});

describe('Login：语言', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const button = (fixture: ComponentFixture<Login>) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.lang-btn')!;

  it('右上角有语言按钮：默认显示 BM，标题等文案是马来语', () => {
    const { fixture, text } = setup();
    expect(button(fixture).textContent).toContain('BM');
    expect(button(fixture).getAttribute('aria-label')).toBe(ms.lang.switchLabel);
    expect(text()).toContain(ms.login.title);
    expect(text()).toContain(ms.login.send);
  });

  it('点按钮切到英语：全部文案、占位、按钮显示 EN，<html lang> 同步', () => {
    const { fixture, text } = setup();
    button(fixture).click();
    fixture.detectChanges();
    expect(button(fixture).textContent).toContain('EN');
    expect(button(fixture).getAttribute('aria-label')).toBe(en.lang.switchLabel);
    expect(text()).toContain(en.login.title);
    expect(text()).toContain(en.login.lead);
    expect(text()).toContain(en.login.send);
    expect(text()).not.toContain(ms.login.title);
    expect(document.documentElement.lang).toBe('en');
  });

  it('上一个账号的 users.language=en 默认值不残留：登出回到登录页仍是马来语、BM', () => {
    const { fixture, text, i18n } = setup({}, (service) => service.applyProfileDefault('en'));
    expect(i18n.lang()).toBe('ms');
    expect(button(fixture).textContent).toContain('BM');
    expect(text()).toContain(ms.login.title);
    expect(document.documentElement.lang).toBe('ms');
  });

  it('本机选过英语的，进登录页仍是英语（不被清掉）', () => {
    const { fixture, text } = setup({}, (service) => service.set('en'));
    expect(button(fixture).textContent).toContain('EN');
    expect(text()).toContain(en.login.title);
  });

  it('已经显示的错误提示跟着语言变', async () => {
    const { c, fixture, errorText, i18n } = setup();
    await c.send(); // 号码为空
    fixture.detectChanges();
    expect(errorText()).toBe(ms.login.errors.phoneEmpty);
    i18n.toggle();
    fixture.detectChanges();
    expect(errorText()).toBe(en.login.errors.phoneEmpty);
  });

  it('步骤 2 的说明与倒计时按钮也随语言变化', async () => {
    const { c, fixture, text, i18n } = setup();
    c.phone.set('+60100000001');
    await c.send();
    fixture.detectChanges();
    expect(text()).toContain(ms.login.codeLead('+60100000001'));
    expect(text()).toContain(ms.login.resendIn(30));
    i18n.toggle();
    fixture.detectChanges();
    expect(text()).toContain(en.login.codeLead('+60100000001'));
    expect(text()).toContain(en.login.resendIn(30));
  });
});
