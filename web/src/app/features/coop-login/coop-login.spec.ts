import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle } from '../../../testing/fake-facade';
import { AuthService } from '../../core/firebase/auth.service';
import { NotConfiguredError } from '../../core/firebase/firebase';
import { I18nService } from '../../core/i18n/i18n.service';
import { CoopLogin, DEMO_COOP, coopLoginErrorKey } from './coop-login';

@Component({ template: '' })
class Blank {}

async function setup(signInWithEmail = vi.fn(async (_e: string, _p: string) => undefined)) {
  const auth = { signInWithEmail };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'coop/login', component: CoopLogin },
        { path: 'coop', component: Blank },
        { path: 'login', component: Blank },
      ]),
      { provide: AuthService, useValue: auth },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/coop/login', CoopLogin);
  const fixture = harness.fixture;
  const el = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  return {
    auth,
    fixture,
    router: TestBed.inject(Router),
    i18n: TestBed.inject(I18nService),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    type: async (sel: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle(fixture);
    },
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(fixture);
    },
    submit: async () => {
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(fixture);
    },
  };
}

describe('CoopLogin：合作社看板的电脑登录（邮箱＋密码）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('左边说明看板能做什么，右边是邮箱和密码；有回手机登录的入口', async () => {
    const t = await setup();
    expect(t.q('h1')?.textContent).toBe('Log masuk koperasi');
    expect(t.text()).toContain('Papan pemuka koperasi');
    expect(t.q('#email')?.getAttribute('autocomplete')).toBe('username');
    expect(t.q('#password')?.getAttribute('type')).toBe('password');
    expect(t.q('#phone-app')?.getAttribute('href')).toBe('/login');
    expect(t.q('#phone-app')?.textContent).toContain('aplikasi telefon');
  });

  it('邮箱或密码为空：不发请求，说清缺什么', async () => {
    const t = await setup();
    await t.submit();
    expect(t.q('#error')?.textContent).toContain('masukkan emel');
    await t.type('#email', 'a@b.my');
    await t.submit();
    expect(t.q('#error')?.textContent).toContain('masukkan kata laluan');
    expect(t.auth.signInWithEmail).not.toHaveBeenCalled();
  });

  it('登录成功：邮箱去掉首尾空格，进看板 /coop（替换历史，返回键不会回登录页）', async () => {
    const t = await setup();
    await t.type('#email', '  koperasi@kebunsah.demo ');
    await t.type('#password', 'secret');
    await t.submit();
    expect(t.auth.signInWithEmail).toHaveBeenCalledWith('koperasi@kebunsah.demo', 'secret');
    expect(t.router.url).toBe('/coop');
  });

  it('登录进行中：按钮禁用，不会重复提交', async () => {
    let finish!: () => void;
    const t = await setup(vi.fn(() => new Promise<undefined>((r) => (finish = () => r(undefined)))));
    await t.type('#email', 'a@b.my');
    await t.type('#password', 'x');
    await t.submit();
    expect((t.q('#submit') as HTMLButtonElement).disabled).toBe(true);
    expect(t.q('#submit')?.textContent?.trim()).toBe('Sedang log masuk…');
    await t.submit();
    expect(t.auth.signInWithEmail).toHaveBeenCalledTimes(1);
    finish();
    await settle(t.fixture);
  });

  it.each([
    ['auth/invalid-credential', 'tidak betul'],
    ['auth/wrong-password', 'tidak betul'],
    ['auth/user-not-found', 'tidak betul'],
    ['auth/too-many-requests', 'Terlalu banyak percubaan'],
    ['auth/network-request-failed', 'Tiada sambungan'],
    ['auth/internal-error', 'Sesuatu tidak kena'],
  ])('登录失败（%s）：人话说明，留在这页，输入保留', async (code, expected) => {
    const t = await setup(
      vi.fn(async () => {
        throw Object.assign(new Error(code), { code });
      }),
    );
    await t.type('#email', 'a@b.my');
    await t.type('#password', 'x');
    await t.submit();
    expect(t.q('#error')?.textContent).toContain(expected);
    expect(t.router.url).toBe('/coop/login');
    expect((t.q('#email') as HTMLInputElement).value).toBe('a@b.my');
    expect((t.q('#submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('密码可以显示和隐藏', async () => {
    const t = await setup();
    await t.click('#toggle-password');
    expect(t.q('#password')?.getAttribute('type')).toBe('text');
    expect(t.q('#toggle-password')?.textContent?.trim()).toBe('Sembunyikan');
    await t.click('#toggle-password');
    expect(t.q('#password')?.getAttribute('type')).toBe('password');
  });

  it('评审试用：写明演示邮箱和密码，点「Isikan untuk saya」填进输入框', async () => {
    const t = await setup();
    expect(t.q('#demo-email')?.textContent).toBe(DEMO_COOP.email);
    expect(t.q('#demo-password')?.textContent).toBe(DEMO_COOP.password);
    await t.click('#fill-demo');
    expect((t.q('#email') as HTMLInputElement).value).toBe(DEMO_COOP.email);
    expect((t.q('#password') as HTMLInputElement).value).toBe(DEMO_COOP.password);
  });

  it('切到英语：标题、按钮、错误都跟着换', async () => {
    const t = await setup();
    t.i18n.set('en');
    await settle(t.fixture);
    expect(t.q('h1')?.textContent).toBe('Cooperative sign-in');
    expect(t.q('#submit')?.textContent?.trim()).toBe('Sign in');
    await t.submit();
    expect(t.q('#error')?.textContent).toContain('enter your email');
  });
});

describe('coopLoginErrorKey', () => {
  it('把 Firebase 的错误码归成界面文案的几类', () => {
    expect(coopLoginErrorKey(new NotConfiguredError())).toBe('notConfigured');
    expect(coopLoginErrorKey({ code: 'auth/invalid-email' })).toBe('wrong');
    expect(coopLoginErrorKey({ code: 'auth/too-many-requests' })).toBe('tooMany');
    expect(coopLoginErrorKey({ code: 'auth/network-request-failed' })).toBe('network');
    expect(coopLoginErrorKey(null)).toBe('generic');
  });
});
