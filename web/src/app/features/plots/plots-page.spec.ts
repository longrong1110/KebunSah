import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/firebase/auth.service';
import { FIRESTORE_FACADE } from '../../core/firebase/firestore-reader';
import { I18nService, LANG_STORAGE_KEY } from '../../core/i18n/i18n.service';
import { stubHistory } from '../../../testing/back';
import { FakeFacade, settle } from '../../../testing/fake-facade';
import { DraftService } from '../new-plot/draft.service';
import { PlotsPage } from './plots-page';

const where = (personId: string) => [{ field: 'operatorPersonId', value: personId }] as const;
const OWNER = { role: 'smallholder', personId: 'p1', language: 'ms' };
const OFFICER = { role: 'field_officer', personId: null, language: 'ms' };

const plot = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  data: {
    operatorPersonId: 'p1',
    landTitleId: `t-${id}`,
    status: 'green',
    areaHaComputed: 4.23,
    lastAssessedAt: new Date('2026-10-05T04:00:00Z'),
    district: 'Kampar',
    ...over,
  },
});

async function setup(options: { signOut?: () => Promise<void>; url?: string } = {}) {
  const facade = new FakeFacade();
  const auth = {
    user: () => ({ uid: 'u1', phoneNumber: '+60100000001' }),
    ready: () => true,
    signOut: vi.fn(options.signOut ?? (() => Promise.resolve())),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
      { provide: FIRESTORE_FACADE, useValue: facade },
    ],
  });
  const router = TestBed.inject(Router);
  if (options.url) await router.navigateByUrl(options.url);
  const fixture = TestBed.createComponent(PlotsPage);
  const el = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  const api = {
    fixture,
    facade,
    auth,
    router,
    el,
    draft: TestBed.inject(DraftService),
    i18n: TestBed.inject(I18nService),
    text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    profile: async (data: Record<string, unknown> | null, fromCache = false) => {
      facade.emitDoc('users/u1', data, fromCache);
      await settle(fixture);
    },
    plots: async (docs: ReturnType<typeof plot>[], personId = 'p1', fromCache = false) => {
      facade.emitCollection('plots', docs, { where: where(personId), fromCache });
      await settle(fixture);
    },
    person: async (id: string, fullName: string) => {
      facade.emitDoc(`persons/${id}`, { fullName });
      await settle(fixture);
    },
    cardTitles: () =>
      [...el.querySelectorAll('.plot-card__title')].map((e) => e.textContent?.trim()),
  };
  return api;
}

describe('PlotsPage · 角色与档案', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('档案读到之前显示加载态；缓存里的「不存在」不能下结论', async () => {
    const t = await setup();
    expect(t.q('#profile-loading')).not.toBeNull();
    await t.profile(null, true);
    expect(t.q('#profile-loading')).not.toBeNull();
    expect(t.q('#no-profile')).toBeNull();
  });

  it('服务器确认 users/{uid} 不存在：「Profil anda belum dibuat.」＋退出登录，没有空列表、没有「Tambah tanah」', async () => {
    const t = await setup();
    await t.profile(null);
    expect(t.q('#no-profile')?.textContent).toContain('Profil anda belum dibuat.');
    expect(t.q('#logout')).not.toBeNull();
    expect(t.q('#add')).toBeNull();
    expect(t.facade.activeCollections('plots').length).toBe(0);
  });

  it('角色未知，或园主没有 personId：同样显示档案说明', async () => {
    const a = await setup();
    await a.profile({ role: 'alien', personId: 'p1' });
    expect(a.q('#no-profile')).not.toBeNull();
    TestBed.resetTestingModule();

    const b = await setup();
    await b.profile({ role: 'smallholder', personId: null });
    expect(b.q('#no-profile')).not.toBeNull();
    expect(b.facade.activeCollections('plots').length).toBe(0);
  });

  it('档案读不到：10 秒后转离线，点「Cuba lagi」重新订阅', async () => {
    vi.useFakeTimers();
    const t = await setup();
    vi.advanceTimersByTime(10_000);
    await settle(t.fixture);
    expect(t.q('#profile-error')?.textContent).toContain('Tiada sambungan');
    t.q('#profile-error + button')!.click();
    await settle(t.fixture);
    expect(t.facade.docs.filter((w) => w.path === 'users/u1').length).toBe(2);
    expect(t.facade.activeDocs('users/u1').length).toBe(1);
  });

  it('users.language 只在本机没选过时当默认；本机选过的不被覆盖', async () => {
    const a = await setup();
    await a.profile({ ...OWNER, language: 'en' });
    expect(a.i18n.lang()).toBe('en');
    TestBed.resetTestingModule();

    localStorage.setItem(LANG_STORAGE_KEY, 'ms');
    const b = await setup();
    await b.profile({ ...OWNER, language: 'en' });
    expect(b.i18n.lang()).toBe('ms');
  });
});

describe('PlotsPage · 园主', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('只按 operatorPersonId == personId 查地块（别人的地块根本不会被请求）', async () => {
    const t = await setup();
    await t.profile(OWNER);
    const watchers = t.facade.activeCollections('plots');
    expect(watchers.length).toBe(1);
    expect(watchers[0].filters).toEqual(where('p1'));
    expect(t.facade.activeCollections('persons').length).toBe(0); // 园主不订阅整个成员列表
  });

  it('头部「{姓名} · {n} bidang tanah」：姓名词首大写；块数只在服务器确认后才显示', async () => {
    const t = await setup();
    await t.profile(OWNER);
    await t.person('p1', 'AHMAD ZAKI BIN ROSLI');
    expect(t.q('#subheading')?.textContent?.trim()).toBe('Ahmad Zaki bin Rosli');
    await t.plots([plot('a')], 'p1', true); // 来自缓存：块数可能是旧的
    expect(t.q('#subheading')?.textContent?.trim()).toBe('Ahmad Zaki bin Rosli');
    await t.plots([plot('a'), plot('b')], 'p1', false);
    expect(t.q('#subheading')?.textContent?.trim()).toBe('Ahmad Zaki bin Rosli · 2 bidang tanah');
  });

  it('每块地一张卡片，按评估时间新→旧排，没有时间的排最后', async () => {
    const t = await setup();
    await t.profile(OWNER);
    await t.plots([
      plot('old', { lastAssessedAt: new Date('2026-10-01T04:00:00Z') }),
      plot('none', { lastAssessedAt: null }),
      plot('new', { lastAssessedAt: new Date('2026-10-08T04:00:00Z') }),
    ]);
    for (const id of ['old', 'none', 'new'])
      t.facade.emitDoc(`titles/t-${id}`, { lotNo: id.toUpperCase(), district: 'K' });
    await settle(t.fixture);
    expect(t.cardTitles()).toEqual(['Lot NEW, K', 'Lot OLD, K', 'Lot NONE, K']);
  });

  it('服务器没确认的空结果不显示成「0」：先加载，10 秒后转离线，并可重试', async () => {
    vi.useFakeTimers();
    const t = await setup();
    await t.profile(OWNER);
    await t.plots([], 'p1', true);
    expect(t.q('#plots-loading')).not.toBeNull();
    expect(t.q('#plots-empty')).toBeNull();
    expect(t.text()).not.toMatch(/\b0 bidang/);
    vi.advanceTimersByTime(10_000);
    await settle(t.fixture);
    expect(t.q('#plots-error')?.textContent).toContain('Tiada sambungan');
    t.q('#plots-error + button')!.click();
    await settle(t.fixture);
    expect(t.facade.collections.filter((w) => w.path === 'plots').length).toBe(2);
    expect(t.facade.activeCollections('plots').length).toBe(1);
  });

  it('服务器确认为空：友好的空态，并指向「Tambah tanah」', async () => {
    const t = await setup();
    await t.profile(OWNER);
    await t.plots([], 'p1', false);
    expect(t.q('#plots-empty')?.textContent).toContain('Tambah tanah');
    expect(t.q('#add')).not.toBeNull();
  });

  it('缓存里有数据：照常显示，并带「Disimpan di telefon」提示', async () => {
    const t = await setup();
    await t.profile(OWNER);
    await t.plots([plot('a')], 'p1', true);
    expect(t.el.querySelectorAll('.plot-card').length).toBe(1);
    expect(t.q('#plots-cached')?.textContent).toContain('Disimpan di telefon');
  });

  it('已转成离线后服务器的快照到了：恢复显示数据', async () => {
    vi.useFakeTimers();
    const t = await setup();
    await t.profile(OWNER);
    await t.plots([], 'p1', true);
    vi.advanceTimersByTime(10_000);
    await settle(t.fixture);
    expect(t.q('#plots-error')).not.toBeNull();
    await t.plots([plot('a')], 'p1', false);
    expect(t.q('#plots-error')).toBeNull();
    expect(t.el.querySelectorAll('.plot-card').length).toBe(1);
  });

  it('监听出错（如权限被拒）：显示错误与重试，不显示数字', async () => {
    const t = await setup();
    await t.profile(OWNER);
    t.facade.failCollection('plots');
    await settle(t.fixture);
    expect(t.q('#plots-error')?.textContent).toContain('Tidak dapat memuat');
    expect(t.q('#plots-error + button')).not.toBeNull();
  });

  it('「Tambah tanah」固定在底栏；点击得到全新草稿并进入 /plots/new', async () => {
    const t = await setup();
    t.draft.skip('land_title'); // 上一次没做完的草稿
    await t.profile(OWNER);
    await t.plots([plot('a')]);
    const nav = vi.spyOn(t.router, 'navigate').mockResolvedValue(true);
    expect(t.q('footer.bar #add')).not.toBeNull();
    t.q('#add')!.click();
    expect(t.draft.doc('land_title').status).toBe('pending');
    expect(t.draft.memberId()).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/plots/new'], {});
  });

  it('回到屏 2 时，上一次没做完的草稿被清空', async () => {
    const facade = new FakeFacade();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { user: () => ({ uid: 'u1' }), ready: () => true, signOut: vi.fn() },
        },
        { provide: FIRESTORE_FACADE, useValue: facade },
      ],
    });
    const draft = TestBed.inject(DraftService);
    draft.begin('p9');
    draft.skip('mspo_cert');
    TestBed.createComponent(PlotsPage);
    expect(draft.doc('mspo_cert').status).toBe('pending');
    expect(draft.memberId()).toBeNull();
  });

  it('没有地契的地块显示 Lot baharu；有地契的显示 Lot {lotNo}', async () => {
    const t = await setup();
    await t.profile(OWNER);
    await t.plots([
      plot('n', {
        landTitleId: null,
        status: 'pending',
        areaHaComputed: null,
        lastAssessedAt: null,
      }),
    ]);
    expect(t.cardTitles()).toEqual(['Lot baharu']);
    expect(t.el.querySelector('.plot-card__meta')?.textContent?.trim()).toBe('Belum diisi');
  });

  it('切到英语：标题、按钮、头部都变，月份缩写也变', async () => {
    const t = await setup();
    await t.profile(OWNER);
    await t.person('p1', 'AHMAD ZAKI BIN ROSLI');
    await t.plots([plot('a')]);
    t.facade.emitDoc('titles/t-a', { lotNo: '1', district: 'K' });
    await settle(t.fixture);
    t.i18n.toggle();
    await settle(t.fixture);
    expect(t.q('h1')?.textContent).toContain('My land');
    expect(t.q('#add')?.textContent).toContain('Add land');
    expect(t.q('#logout')?.textContent).toContain('Log out');
    expect(t.q('#subheading')?.textContent?.trim()).toBe('Ahmad Zaki bin Rosli · 1 plot');
    expect(t.q('.plot-card__meta')?.textContent).toContain('5 Oct');
  });

  it('离开页面后不残留任何监听', async () => {
    const t = await setup();
    await t.profile(OWNER);
    await t.person('p1', 'AHMAD');
    await t.plots([plot('a'), plot('b')]);
    expect(t.facade.activeCount).toBeGreaterThan(3);
    t.fixture.destroy();
    expect(t.facade.activeCount).toBe(0);
  });
});

describe('PlotsPage · 外勤／管理员', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const people = [
    { id: 'p4', data: { fullName: 'MUTHU A/L RAMAN' } },
    { id: 'p1', data: { fullName: 'AHMAD ZAKI BIN ROSLI' } },
  ];

  it('先出「Pilih ahli」成员列表，此时没有「Tambah tanah」，也不去查地块', async () => {
    const t = await setup();
    await t.profile(OFFICER);
    t.facade.emitCollection('persons', people);
    await settle(t.fixture);
    expect(t.q('h1')?.textContent).toContain('Pilih ahli');
    expect(t.el.querySelectorAll('.member-row').length).toBe(2);
    expect(t.q('#add')).toBeNull();
    expect(t.facade.activeCollections('plots').length).toBe(0);
  });

  it('合作社管理员暂时与外勤同一视图', async () => {
    const t = await setup();
    await t.profile({ role: 'coop_admin', personId: null, language: 'en' });
    expect(t.facade.activeCollections('persons').length).toBe(1);
  });

  it('合作社管理员头部有「Papan pemuka」入口，点它进 /coop；外勤没有，见下面几条', async () => {
    const admin = await setup();
    await admin.profile({ role: 'coop_admin', personId: null, language: 'ms' });
    expect(admin.q('#coop-link')?.textContent?.trim()).toBe('Papan pemuka');
    const nav = vi.spyOn(admin.router, 'navigate').mockResolvedValue(true);
    admin.q('#coop-link')!.click();
    expect(nav).toHaveBeenCalledWith(['/coop']);
  });

  it('园主没有进看板的入口；没有档案的账号也没有', async () => {
    const owner = await setup();
    await owner.profile(OWNER);
    expect(owner.q('#coop-link')).toBeNull();
  });

  it('没有档案的账号没有进看板的入口', async () => {
    const t = await setup();
    await t.profile(null);
    expect(t.q('#coop-link')).toBeNull();
  });

  it('外勤没有进看板的入口', async () => {
    const t = await setup();
    await t.profile(OFFICER);
    expect(t.q('#coop-link')).toBeNull();
  });

  it('外勤即使有 personId 也走成员列表（看 role，不看 personId）', async () => {
    const t = await setup();
    await t.profile({ role: 'field_officer', personId: 'p1' });
    expect(t.facade.activeCollections('persons').length).toBe(1);
    expect(t.facade.activeCollections('plots').length).toBe(0);
  });

  it('点成员：URL 带 ?member，显示「Tanah {姓名}」和他的地块；成员列表的监听取消', async () => {
    const t = await setup();
    await t.profile(OFFICER);
    t.facade.emitCollection('persons', people);
    await settle(t.fixture);
    [...t.el.querySelectorAll<HTMLButtonElement>('.member-row')]
      .find((b) => b.textContent?.includes('Muthu'))!
      .click();
    await settle(t.fixture);
    expect(t.router.url).toContain('member=p4');
    expect(t.facade.activeCollections('persons').length).toBe(0); // 不再订阅整个成员列表
    expect(t.facade.activeCollections('plots')[0].filters).toEqual(where('p4'));
    await t.person('p4', 'MUTHU A/L RAMAN');
    expect(t.q('h1')?.textContent).toContain('Tanah Muthu a/l Raman');
    expect(t.q('#add')).not.toBeNull();
    expect(t.q('#back-to-members')).not.toBeNull();
  });

  it('刷新后仍停在该成员（选中的成员写在 URL 里）', async () => {
    const t = await setup({ url: '/?member=p4' });
    await t.profile(OFFICER);
    expect(t.facade.activeCollections('plots')[0].filters).toEqual(where('p4'));
    expect(t.facade.activeCollections('persons').length).toBe(0);
  });

  it('返回成员：有历史就后退，不再导航（URL 由浏览器历史决定）', async () => {
    const t = await setup({ url: '/?member=p4' });
    await t.profile(OFFICER);
    t.facade.emitCollection('persons', people);
    await settle(t.fixture);
    const back = stubHistory(true);
    t.q('#back-to-members')!.click();
    await settle(t.fixture);
    expect(back).toHaveBeenCalledTimes(1);
    expect(t.router.url).toContain('member=p4');
  });

  it('返回箭头回到成员列表，搜索词保留；成员的地块监听取消', async () => {
    const t = await setup();
    await t.profile(OFFICER);
    t.facade.emitCollection('persons', people);
    await settle(t.fixture);
    const input = t.q('#member-search') as HTMLInputElement;
    input.value = 'muthu';
    input.dispatchEvent(new Event('input'));
    await settle(t.fixture);
    t.q('.member-row')!.click();
    await settle(t.fixture);
    expect(t.facade.activeCollections('plots').length).toBe(1);

    t.q('#back-to-members')!.click();
    await settle(t.fixture);
    expect(t.router.url).not.toContain('member=');
    expect(t.facade.activeCollections('plots').length).toBe(0);
    t.facade.emitCollection('persons', people);
    await settle(t.fixture);
    expect((t.q('#member-search') as HTMLInputElement).value).toBe('muthu');
    expect(t.el.querySelectorAll('.member-row').length).toBe(1);
  });

  it('换成员：旧成员的地块与姓名监听取消，只剩新成员的', async () => {
    const t = await setup({ url: '/?member=p4' });
    await t.profile(OFFICER);
    expect(t.facade.activeDocs('persons/p4').length).toBe(1);
    await t.router.navigateByUrl('/?member=p1');
    await settle(t.fixture);
    expect(t.facade.activeDocs('persons/p4').length).toBe(0);
    expect(t.facade.activeDocs('persons/p1').length).toBe(1);
    expect(t.facade.activeCollections('plots').length).toBe(1);
    expect(t.facade.activeCollections('plots')[0].filters).toEqual(where('p1'));
  });

  it('?member 指向服务器确认不存在的人：退回成员列表，不显示「Tambah tanah」', async () => {
    const t = await setup({ url: '/?member=ghost' });
    await t.profile(OFFICER);
    t.facade.emitDoc('persons/ghost', null);
    await settle(t.fixture);
    expect(t.router.url).toBe('/');
    expect(t.q('h1')?.textContent).toContain('Pilih ahli');
    expect(t.q('#add')).toBeNull();
    expect(t.facade.activeDocs('persons/ghost').length).toBe(0);
  });

  it('缓存里读到「不存在」不能下结论：留在原页，等服务器确认', async () => {
    const t = await setup({ url: '/?member=p4' });
    await t.profile(OFFICER);
    t.facade.emitDoc('persons/p4', null, true);
    await settle(t.fixture);
    expect(t.router.url).toBe('/?member=p4');
    // 服务器随后给出了这个人：照常显示
    await t.person('p4', 'MUTHU A/L RAMAN');
    expect(t.q('h1')?.textContent).toContain('Tanah Muthu a/l Raman');
  });

  it('选了成员后点「Tambah tanah」：草稿记下成员，/plots/new 带上 ?member', async () => {
    const t = await setup({ url: '/?member=p4' });
    await t.profile(OFFICER);
    const nav = vi.spyOn(t.router, 'navigate').mockResolvedValue(true);
    t.q('#add')!.click();
    expect(t.draft.memberId()).toBe('p4');
    expect(nav).toHaveBeenCalledWith(['/plots/new'], { queryParams: { member: 'p4' } });
  });
});

describe('PlotsPage · 登出与会话', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('登出成功：回到 /login', async () => {
    const t = await setup();
    await t.profile(OWNER);
    const nav = vi.spyOn(t.router, 'navigateByUrl').mockResolvedValue(true);
    t.q('#logout')!.click();
    await settle(t.fixture);
    expect(t.auth.signOut).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith('/login', { replaceUrl: true });
    expect(t.q('#logging-out')).not.toBeNull(); // 登出中内容先藏起来
  });

  it('登出失败：不能留下空白页，要恢复内容并提示，且不导航', async () => {
    const t = await setup({ signOut: () => Promise.reject(new Error('indexeddb')) });
    await t.profile(OWNER);
    const nav = vi.spyOn(t.router, 'navigateByUrl').mockResolvedValue(true);
    t.q('#logout')!.click();
    await settle(t.fixture);
    expect(t.q('#logout-error')?.textContent).toContain('Tidak dapat log keluar');
    expect(t.q('h1')?.textContent).toContain('Tanah saya');
    expect(nav).not.toHaveBeenCalled();
  });

  it('会话在别处失效（没有用户了）：回登录页', async () => {
    const facade = new FakeFacade();
    const auth = { user: () => null, ready: () => true, signOut: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: FIRESTORE_FACADE, useValue: facade },
      ],
    });
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(PlotsPage);
    await settle(fixture);
    expect(nav).toHaveBeenCalledWith('/login', { replaceUrl: true });
  });
});
