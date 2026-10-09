import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/firebase/auth.service';
import { NotConfiguredError } from '../../core/firebase/firebase';
import { Login } from './login';

function setup(
  overrides: Partial<Record<'sendCode' | 'confirmCode', ReturnType<typeof vi.fn>>> = {},
) {
  const auth = {
    sendCode: overrides.sendCode ?? vi.fn().mockResolvedValue(undefined),
    confirmCode: overrides.confirmCode ?? vi.fn().mockResolvedValue(undefined),
    resetFlow: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  });
  const fixture: ComponentFixture<Login> = TestBed.createComponent(Login);
  fixture.detectChanges();
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return {
    fixture,
    c: fixture.componentInstance,
    auth,
    navigate,
    text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
  };
}

describe('Login', () => {
  afterEach(() => vi.useRealTimers());

  it('号码为空：不发请求，显示马来语提示，输入保留', async () => {
    const { c, auth } = setup();
    await c.send();
    expect(auth.sendCode).not.toHaveBeenCalled();
    expect(c.error()).toBe('Sila masukkan nombor telefon anda.');
    expect(c.step()).toBe('phone');
  });

  it('号码格式错：不发请求，输入保留', async () => {
    const { c, auth } = setup();
    c.phone.set('abc');
    await c.send();
    expect(auth.sendCode).not.toHaveBeenCalled();
    expect(c.error()).toContain('Nombor telefon ini tidak betul');
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
    expect(c.error()).toBe('Sila masukkan kod 6 digit daripada SMS.');
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
    expect(c.error()).toBe('Kod tidak betul. Semak SMS anda dan cuba lagi.');
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
    expect(c.error()).toBe('Tiada sambungan. Semak internet anda dan cuba lagi.');
    expect(c.busy()).toBe(false);
  });

  it('生产配置为空：显示"服务尚未配置"', async () => {
    const sendCode = vi.fn().mockRejectedValue(new NotConfiguredError());
    const { c } = setup({ sendCode });
    c.phone.set('+60100000001');
    await c.send();
    expect(c.error()).toBe('Perkhidmatan belum disediakan.');
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
    c.error.set('x');
    c.changeNumber();
    expect(c.step()).toBe('phone');
    expect(c.code()).toBe('');
    expect(c.error()).toBe('');
    expect(c.cooldown()).toBe(0);
    expect(auth.resetFlow).toHaveBeenCalled();
  });
});
