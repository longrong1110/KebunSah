import { TestBed } from '@angular/core/testing';
import {
  Router,
  UrlTree,
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { AuthService } from '../firebase/auth.service';
import { redirectIfAuthed, requireAuth } from './auth.guard';

function run(guard: typeof requireAuth, user: unknown, ready = true) {
  let resolveReady!: () => void;
  const whenReady = ready ? Promise.resolve() : new Promise<void>((r) => (resolveReady = r));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { whenReady: () => whenReady, user: () => user } },
    ],
  });
  const result = TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
  return { result: Promise.resolve(result), resolveReady, router: TestBed.inject(Router) };
}

describe('auth guards', () => {
  it('requireAuth：已登录 → 放行', async () => {
    expect(await run(requireAuth, { uid: 'u1' }).result).toBe(true);
  });

  it('requireAuth：未登录 → 去 /login', async () => {
    const { result, router } = run(requireAuth, null);
    const out = await result;
    expect(out).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(out as UrlTree)).toBe('/login');
  });

  it('requireAuth：登录状态还没确定时先等，不抢先放行或拦截（已登录刷新不闪现登录页）', async () => {
    const { result, resolveReady } = run(requireAuth, { uid: 'u1' }, false);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveReady();
    expect(await result).toBe(true);
  });

  it('redirectIfAuthed：已登录 → 去 /；未登录 → 放行登录页', async () => {
    const authed = run(redirectIfAuthed, { uid: 'u1' });
    expect(authed.router.serializeUrl((await authed.result) as UrlTree)).toBe('/');
    TestBed.resetTestingModule();
    expect(await run(redirectIfAuthed, null).result).toBe(true);
  });
});
