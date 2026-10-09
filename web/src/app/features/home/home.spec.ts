import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/firebase/auth.service';
import type { FirestoreFacade } from '../../core/firebase/firestore-facade';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { Home } from './home';

type PlotsEmit = Parameters<FirestoreFacade['watchCollection']>[1];
type UserEmit = Parameters<FirestoreFacade['watchDoc']>[1];

const plot = (id: string, status: string) => ({ id, data: { status } });

function setup(signOut: () => Promise<void> = () => Promise.resolve()) {
  let emitPlots: PlotsEmit = () => {};
  let failPlots: (e: unknown) => void = () => {};
  let emitUser: UserEmit = () => {};
  const facade: FirestoreFacade = {
    watchCollection: (_path, next, error) => {
      emitPlots = next;
      failPlots = error;
      return () => {};
    },
    watchDoc: (_path, next) => {
      emitUser = next;
      return () => {};
    },
  };
  const auth = {
    user: () => ({ uid: 'u1', phoneNumber: '+60100000001' }),
    ready: () => true,
    signOut: vi.fn(signOut),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
      { provide: FIRESTORE_FACADE, useValue: facade },
    ],
  });
  const fixture: ComponentFixture<Home> = TestBed.createComponent(Home);
  fixture.detectChanges();
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    c: fixture.componentInstance,
    auth,
    navigate,
    plots: (...a: Parameters<PlotsEmit>) => {
      emitPlots(...a);
      fixture.detectChanges();
    },
    failPlots: (e: unknown) => {
      failPlots(e);
      fixture.detectChanges();
    },
    user: (...a: Parameters<UserEmit>) => {
      emitUser(...a);
      fixture.detectChanges();
    },
    tick: (ms: number) => {
      vi.advanceTimersByTime(ms);
      fixture.detectChanges();
    },
    text: () => el.textContent ?? '',
    total: () => el.querySelector('#total')?.textContent?.trim() ?? null,
    count: (s: string) => el.querySelector(`[data-status="${s}"]`)?.textContent?.trim() ?? null,
  };
}

describe('Home：plots 计数（未确认的空快照不能显示成 0）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('首个快照前显示加载态，不显示数字', () => {
    const { text, total } = setup();
    expect(text()).toContain('Memuatkan data');
    expect(total()).toBeNull();
  });

  it('缓存里的空快照不能当成"确认为 0"：先加载，10 秒后转离线，始终不显示 0', () => {
    const { plots, text, total, tick } = setup();
    plots({ docs: [], fromCache: true });
    expect(text()).toContain('Memuatkan data');
    expect(total()).toBeNull();
    tick(9_999);
    expect(total()).toBeNull();
    expect(text()).toContain('Memuatkan data');
    tick(1);
    expect(text()).toContain('Tiada sambungan');
    expect(total()).toBeNull();
  });

  it('服务器确认的空集合：显示 0（这才是事实）', () => {
    const { plots, total } = setup();
    plots({ docs: [], fromCache: false });
    expect(total()).toBe('0');
  });

  it('服务器快照：五个状态各自计数，合计等于总数，不认识的状态单独列出', () => {
    const { plots, total, count } = setup();
    plots({
      docs: [
        plot('1', 'green'),
        plot('2', 'green'),
        plot('3', 'yellow'),
        plot('4', 'red'),
        plot('5', 'needs_review'),
        plot('6', 'weird'),
      ],
      fromCache: false,
    });
    expect(total()).toBe('6');
    expect(count('green')).toBe('2');
    expect(count('yellow')).toBe('1');
    expect(count('red')).toBe('1');
    expect(count('needs_review')).toBe('1');
    expect(count('pending')).toBe('0');
    expect(count('unknown')).toBe('1');
  });

  it('缓存里有数据：照常显示，并提示数据来自本机缓存', () => {
    const { plots, total, text } = setup();
    plots({ docs: [plot('1', 'green')], fromCache: true });
    expect(total()).toBe('1');
    expect(text()).toContain('simpanan peranti');
  });

  it('已转成离线后，服务器的快照到了：恢复显示数据', () => {
    const { plots, total, text, tick } = setup();
    plots({ docs: [], fromCache: true });
    tick(10_000);
    expect(text()).toContain('Tiada sambungan');
    plots({ docs: [plot('1', 'red')], fromCache: false });
    expect(total()).toBe('1');
    expect(text()).not.toContain('Tiada sambungan');
  });

  it('监听出错：显示错误，不显示数字', () => {
    const { failPlots, text, total } = setup();
    failPlots(new Error('permission-denied'));
    expect(text()).toContain('Tidak dapat memuat data');
    expect(total()).toBeNull();
  });
});

describe('Home：角色与档案', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('users/{uid} 存在：显示角色的马来语名称', () => {
    const { user, text } = setup();
    user({ exists: true, doc: { id: 'u1', data: { role: 'field_officer' } }, fromCache: false });
    expect(text()).toContain('Pegawai lapangan');
  });

  it('服务器确认文档不存在：显示"档案尚未建立"，不报错', () => {
    const { user, text } = setup();
    user({ exists: false, doc: { id: 'u1', data: undefined }, fromCache: false });
    expect(text()).toContain('Profil anda belum dibuat.');
  });

  it('只有缓存里的"不存在"不能下结论：先加载，超时后转读不到，不一直转圈', () => {
    const { user, text, tick } = setup();
    user({ exists: false, doc: { id: 'u1', data: undefined }, fromCache: true });
    expect(text()).toContain('Memuatkan profil');
    tick(10_000);
    expect(text()).toContain('Tidak dapat memuat profil');
  });
});

describe('Home：登出', () => {
  it('登出成功：回到 /login', async () => {
    const { c, navigate } = setup();
    await c.logout();
    expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true });
  });

  it('登出失败：不能留下空白页，要恢复内容并提示，且不导航', async () => {
    const { c, fixture, text, navigate } = setup(() => Promise.reject(new Error('indexeddb')));
    await c.logout();
    fixture.detectChanges();
    expect(c.loggingOut()).toBe(false);
    expect(text()).toContain('Tidak dapat log keluar');
    expect(text()).toContain('Tanah saya');
    expect(navigate).not.toHaveBeenCalled();
  });
});
