import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle } from '../../../testing/fake-facade';
import { ApiError, ApiService } from '../../core/api/api.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { DraftService } from '../new-plot/draft.service';
import type { LngLat, PlotGeometry } from '../new-plot/geometry';
import { SubmitService } from '../new-plot/submit.service';
import { ConnectionBanner } from './connection-banner';
import { OfflineQueue } from './offline-queue';
import { PendingList } from './pending-list';
import { isRetryable, type PendingPlot, type PendingSnapshot } from './pending-plot';
import { IdbPendingStore, MemoryPendingStore, PENDING_STORE } from './pending-store';

@Component({ template: '' })
class Blank {}

const RING: LngLat[] = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];
const POLYGON: PlotGeometry = { kind: 'polygon', method: 'map', ring: RING, areaHa: 4.08 };
const photo = () => new Blob(['jpeg'], { type: 'image/jpeg' });

const snapshot = (over: Partial<PendingSnapshot> = {}): PendingSnapshot => ({
  memberId: null,
  geometry: POLYGON,
  pages: [{ type: 'land_title', pageNo: 1, source: 'camera', blob: photo() }],
  plotId: null,
  uploaded: [],
  ...over,
});

const entry = (id: string, over: Partial<PendingPlot> = {}): PendingPlot => ({
  ...snapshot(),
  id,
  createdAt: Number(id.replace(/\D/g, '')) || 1,
  state: 'waiting',
  errorCode: null,
  ...over,
});

describe('isRetryable', () => {
  it('断网、没登录、服务端暂时不可用、被限流值得以后再试；数据本身有问题的不值得', () => {
    for (const [status, code] of [
      [0, 'network'],
      [401, 'unauthenticated'],
      [0, 'not_configured'],
      [401, 'invalid_token'],
      [503, 'http_error'],
      [429, 'http_error'],
    ] as const)
      expect(isRetryable(new ApiError(status, code)), code).toBe(true);
    for (const [status, code] of [
      [422, 'geometry_invalid'],
      [403, 'forbidden'],
      [404, 'plot_not_found'],
      [400, 'invalid_value'],
    ] as const)
      expect(isRetryable(new ApiError(status, code)), code).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
  });
});

describe('存储', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('内存实现：按存的先后排序，put 同一个 id 是覆盖，remove 不存在的不报错', async () => {
    const store = new MemoryPendingStore();
    await store.put(entry('b2'));
    await store.put(entry('a1'));
    await store.put({ ...entry('b2'), state: 'failed' });
    expect((await store.list()).map((e) => [e.id, e.state])).toEqual([
      ['a1', 'waiting'],
      ['b2', 'failed'],
    ]);
    await store.remove('nope');
    await store.remove('a1');
    expect((await store.list()).map((e) => e.id)).toEqual(['b2']);
  });

  it('IndexedDB 实现：存、读（最早的在前）、覆盖、删除；刷新页面（新实例）后还在', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const noPages = (id: string, over: Partial<PendingPlot> = {}) => entry(id, { pages: [], ...over });
    const store = new IdbPendingStore();
    await store.put(noPages('b2'));
    await store.put(noPages('a1'));
    await store.put(noPages('b2', { plotId: 'plot-9', uploaded: ['land_title#1'] }));
    const again = new IdbPendingStore(); // 相当于重新打开页面
    const rows = await again.list();
    expect(rows.map((e) => e.id)).toEqual(['a1', 'b2']);
    expect(rows[1]).toMatchObject({ plotId: 'plot-9', uploaded: ['land_title#1'] });
    await again.remove('a1');
    expect((await again.list()).map((e) => e.id)).toEqual(['b2']);
  });

  it('浏览器不让用 IndexedDB：退回内存，照样能存能读', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: { onerror?: () => void; error?: unknown } = {};
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    });
    const store = new IdbPendingStore();
    await store.put(entry('a1'));
    expect((await store.list()).map((e) => e.id)).toEqual(['a1']);
    await store.remove('a1');
    expect(await store.list()).toEqual([]);
  });

  it('默认用哪个：没有 indexedDB（测试、旧环境）就用内存', () => {
    expect(TestBed.inject(PENDING_STORE)).toBeInstanceOf(MemoryPendingStore);
  });
});

function queueSetup(runPending = vi.fn(async (_e: PendingPlot, _s: unknown) => 'plot-1'), online = true) {
  const store = new MemoryPendingStore();
  TestBed.configureTestingModule({
    providers: [
      { provide: PENDING_STORE, useValue: store },
      { provide: SubmitService, useValue: { runPending } },
    ],
  });
  const queue = TestBed.inject(OfflineQueue);
  queue.online.set(online);
  return { queue, store, runPending };
}

describe('OfflineQueue', () => {
  it('有网：存好就送，送完从手机里删掉，记下刚送出的地块', async () => {
    const { queue, store, runPending } = queueSetup();
    await queue.enqueue(snapshot({ memberId: 'm9' }));
    await vi.waitFor(() => expect(queue.sent()).toBe('plot-1'));
    expect(runPending).toHaveBeenCalledTimes(1);
    expect(runPending.mock.calls[0][0]).toMatchObject({ memberId: 'm9', state: 'waiting' });
    expect(await store.list()).toEqual([]);
    expect(queue.items()).toEqual([]);
    queue.dismissSent();
    expect(queue.sent()).toBeNull();
  });

  it('没网：只存着，不去送；有网了再送', async () => {
    const { queue, runPending } = queueSetup(undefined, false);
    await queue.enqueue(snapshot());
    expect(runPending).not.toHaveBeenCalled();
    expect(queue.items().map((e) => e.state)).toEqual(['waiting']);
    queue.online.set(true);
    await queue.flush();
    expect(runPending).toHaveBeenCalledTimes(1);
    expect(queue.items()).toEqual([]);
  });

  it('送的时候又断网：这一份留着，后面的不试了，下次接着送', async () => {
    const runPending = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'network'))
      .mockResolvedValue('plot-1');
    const { queue } = queueSetup(runPending, false);
    await queue.enqueue(snapshot());
    await queue.enqueue(snapshot());
    queue.online.set(true);
    await queue.flush();
    expect(runPending).toHaveBeenCalledTimes(1);
    expect(queue.items().map((e) => e.state)).toEqual(['waiting', 'waiting']);
    await queue.flush();
    expect(queue.items()).toEqual([]);
    expect(runPending).toHaveBeenCalledTimes(3);
  });

  it('后端明确拒绝：标「失败」记下原因，以后不再试，不挡住后面的', async () => {
    const runPending = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'geometry_invalid'))
      .mockResolvedValue('plot-2');
    const { queue } = queueSetup(runPending, false);
    await queue.enqueue(snapshot());
    await queue.enqueue(snapshot());
    queue.online.set(true);
    await queue.flush();
    expect(runPending).toHaveBeenCalledTimes(2);
    expect(queue.items().map((e) => [e.state, e.errorCode])).toEqual([['failed', 'geometry_invalid']]);
    expect(queue.sent()).toBe('plot-2');
    await queue.flush();
    expect(runPending).toHaveBeenCalledTimes(2); // 失败的不再试
  });

  it('送的过程中记下进度：下次从断的地方接着送（地块 id、已传好的页）', async () => {
    const runPending = vi
      .fn()
      .mockImplementationOnce(async (_e: PendingPlot, save: (p: Partial<PendingPlot>) => Promise<void>) => {
        await save({ plotId: 'plot-half' });
        await save({ uploaded: ['land_title#1'] });
        throw new ApiError(0, 'network');
      })
      .mockResolvedValue('plot-half');
    const { queue, runPending: _ } = queueSetup(runPending, false);
    await queue.enqueue(snapshot());
    queue.online.set(true);
    await queue.flush();
    expect(queue.items()[0]).toMatchObject({ plotId: 'plot-half', uploaded: ['land_title#1'] });
    await queue.flush();
    expect(runPending.mock.calls[1][0]).toMatchObject({ plotId: 'plot-half', uploaded: ['land_title#1'] });
  });

  it('同时调两次 flush：只送一次', async () => {
    let release!: (id: string) => void;
    const runPending = vi.fn(() => new Promise<string>((r) => (release = r)));
    const { queue } = queueSetup(runPending, false);
    await queue.enqueue(snapshot());
    queue.online.set(true);
    const first = queue.flush();
    await vi.waitFor(() => expect(runPending).toHaveBeenCalled());
    expect(queue.syncing()).toBe(true);
    await queue.flush();
    expect(runPending).toHaveBeenCalledTimes(1);
    release('plot-1');
    await first;
    expect(queue.syncing()).toBe(false);
  });

  it('remove：用户不想要了，删掉', async () => {
    const { queue } = queueSetup(undefined, false);
    await queue.enqueue(snapshot());
    await queue.remove(queue.items()[0].id);
    expect(queue.items()).toEqual([]);
  });

  describe('start：页面启动、断网、复网', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('启动时读出手机里存着的并送出去；断网事件改状态；复网事件再送；每分钟再试一次', async () => {
      const runPending = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(0, 'network'))
        .mockResolvedValue('plot-3');
      const store = new MemoryPendingStore();
      await store.put(entry('a1'));
      TestBed.configureTestingModule({
        providers: [
          { provide: PENDING_STORE, useValue: store },
          { provide: SubmitService, useValue: { runPending } },
        ],
      });
      const queue = TestBed.inject(OfflineQueue);
      queue.start();
      queue.start(); // 重复调用不会重复挂监听
      await vi.advanceTimersByTimeAsync(0);
      expect(runPending).toHaveBeenCalledTimes(1); // 启动时送了一次，断网失败，留着
      expect(queue.items().length).toBe(1);

      window.dispatchEvent(new Event('offline'));
      expect(queue.online()).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runPending).toHaveBeenCalledTimes(1); // 没网：每分钟的重试也不去送

      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(queue.online()).toBe(true);
      expect(runPending).toHaveBeenCalledTimes(2);
      expect(queue.items()).toEqual([]);
      expect(queue.sent()).toBe('plot-3');
    });
  });
});

describe('SubmitService.runPending', () => {
  function fakeApi(over: Record<string, unknown> = {}) {
    let n = 0;
    return {
      createPlot: vi.fn(async () => 'plot-new'),
      saveGeometry: vi.fn(async () => ({})),
      registerDocument: vi.fn(async () => ({ documentId: `d${++n}`, upload: { method: 'PUT', url: `u${n}`, headers: {}, expiresAt: '' } })),
      uploadPhoto: vi.fn(async () => undefined),
      assess: vi.fn(async () => 'a1'),
      ...over,
    };
  }
  const run = (api: ReturnType<typeof fakeApi>, e: PendingPlot) => {
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    const saved: Partial<PendingPlot>[] = [];
    return TestBed.inject(SubmitService)
      .runPending(e, async (p) => void saved.push(p))
      .then((plotId) => ({ plotId, saved }));
  }

  it('建地块、存位置、传每一页（第 2 页带 pageNo）、触发评估；每一步记下进度', async () => {
    const api = fakeApi();
    const e = entry('a1', {
      memberId: 'm9',
      pages: [
        { type: 'land_title', pageNo: 1, source: 'camera', blob: photo() },
        { type: 'land_title', pageNo: 2, source: 'gallery', blob: photo() },
      ],
    });
    const { plotId, saved } = await run(api, e);
    expect(plotId).toBe('plot-new');
    expect(api.createPlot).toHaveBeenCalledWith('m9');
    expect(api.saveGeometry).toHaveBeenCalledWith('plot-new', expect.objectContaining({ geometryType: 'polygon' }));
    expect(api.registerDocument).toHaveBeenNthCalledWith(1, 'plot-new', { docType: 'land_title', contentType: 'image/jpeg', source: 'camera' });
    expect(api.registerDocument).toHaveBeenNthCalledWith(2, 'plot-new', { docType: 'land_title', contentType: 'image/jpeg', source: 'gallery', pageNo: 2 });
    expect(api.assess).toHaveBeenCalledWith('plot-new');
    expect(saved).toEqual([{ plotId: 'plot-new' }, { uploaded: ['land_title#1'] }, { uploaded: ['land_title#1', 'land_title#2'] }]);
  });

  it('接着送：地块已建好不重建，传过的页不重传', async () => {
    const api = fakeApi();
    const e = entry('a1', {
      plotId: 'plot-half',
      uploaded: ['land_title#1'],
      pages: [
        { type: 'land_title', pageNo: 1, source: 'camera', blob: photo() },
        { type: 'mpob_licence', pageNo: 1, source: 'camera', blob: photo() },
      ],
    });
    const { plotId } = await run(api, e);
    expect(plotId).toBe('plot-half');
    expect(api.createPlot).not.toHaveBeenCalled();
    expect(api.registerDocument).toHaveBeenCalledTimes(1);
    expect(api.registerDocument).toHaveBeenCalledWith('plot-half', expect.objectContaining({ docType: 'mpob_licence' }));
  });

  it('已经有评估在跑（409）当作成功；别的错误原样抛出', async () => {
    const running = fakeApi({ assess: vi.fn(async () => { throw new ApiError(409, 'assessment_in_progress'); }) });
    await expect(run(running, entry('a1'))).resolves.toMatchObject({ plotId: 'plot-new' });
    TestBed.resetTestingModule();
    const broken = fakeApi({ uploadPhoto: vi.fn(async () => { throw new ApiError(0, 'network'); }) });
    await expect(run(broken, entry('a1'))).rejects.toMatchObject({ code: 'network' });
  });
});

describe('DraftService.snapshot', () => {
  it('没有可完成的地块：null', () => {
    expect(TestBed.inject(DraftService).snapshot()).toBeNull();
  });

  it('带上地块、每一页（按顺序编号）、成员、已建好的地块和已传好的页', () => {
    const draft = TestBed.inject(DraftService);
    draft.begin('m9');
    for (const v of RING) draft.addVertex('map', v);
    draft.capture('land_title', photo(), 'camera');
    draft.addPage('land_title', photo(), 'gallery');
    draft.capture('mpob_licence', photo(), 'camera');
    draft.skip('mspo_cert');
    draft.plotId.set('plot-half');
    draft.uploaded.set('land_title#1', draft.pagesOf('land_title')[0].blob);
    draft.uploaded.set('land_title#2', photo()); // 换过照片：旧的上传记录不算
    const s = draft.snapshot()!;
    expect(s.memberId).toBe('m9');
    expect(s.geometry.kind).toBe('polygon');
    expect(s.pages.map((p) => `${p.type}#${p.pageNo}:${p.source}`)).toEqual([
      'land_title#1:camera',
      'land_title#2:gallery',
      'mpob_licence#1:camera',
    ]);
    expect(s.plotId).toBe('plot-half');
    expect(s.uploaded).toEqual(['land_title#1']);
  });
});

describe('ConnectionBanner', () => {
  async function bannerSetup() {
    const queue = {
      online: signal(true),
      sent: signal<string | null>(null),
      dismissSent: vi.fn(() => queue.sent.set(null)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: OfflineQueue, useValue: queue },
        provideRouter([{ path: 'plots/:id/checking', component: Blank }, { path: '', component: Blank }]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    const fixture = TestBed.createComponent(ConnectionBanner);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    return {
      queue,
      fixture,
      router: TestBed.inject(Router),
      harness,
      q: (sel: string) => el.querySelector<HTMLElement>(sel),
      text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      click: async (sel: string) => {
        el.querySelector<HTMLElement>(sel)!.click();
        await settle(fixture);
      },
    };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('没事的时候什么都不显示', async () => {
    const t = await bannerSetup();
    expect(t.text()).toBe('');
  });

  it('没网：说还能拍照和画，有网了再送；有网后消失', async () => {
    const t = await bannerSetup();
    t.queue.online.set(false);
    await settle(t.fixture);
    expect(t.q('#offline-banner')?.getAttribute('role')).toBe('status');
    expect(t.text()).toContain('Tiada talian');
    expect(t.text()).toContain('masih boleh mengambil gambar');
    t.queue.online.set(true);
    await settle(t.fixture);
    expect(t.q('#offline-banner')).toBeNull();
  });

  it('存着的送出去了：说已送出，「Lihat」去那块地的检查页，同时收起提示', async () => {
    const t = await bannerSetup();
    t.queue.sent.set('plot-5');
    await settle(t.fixture);
    expect(t.text()).toContain('telah dihantar');
    await t.click('#sent-view');
    expect(t.router.url).toBe('/plots/plot-5/checking');
    expect(t.q('#sent-banner')).toBeNull();
  });

  it('可以直接关掉；英语界面文案跟着换', async () => {
    const t = await bannerSetup();
    t.queue.sent.set('plot-5');
    await settle(t.fixture);
    TestBed.inject(I18nService).set('en');
    await settle(t.fixture);
    expect(t.text()).toContain('has been sent');
    await t.click('#sent-dismiss');
    expect(t.queue.dismissSent).toHaveBeenCalled();
    expect(t.q('#sent-banner')).toBeNull();
  });
});

describe('PendingList', () => {
  function listSetup(items: PendingPlot[], online = true, memberId: string | null = null) {
    const queue = {
      online: signal(online),
      syncing: signal(false),
      items: signal<readonly PendingPlot[]>(items),
      flush: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: OfflineQueue, useValue: queue }] });
    const fixture = TestBed.createComponent(PendingList);
    fixture.componentRef.setInput('memberId', memberId);
    const el = fixture.nativeElement as HTMLElement;
    return {
      queue,
      fixture,
      q: (sel: string) => el.querySelector<HTMLElement>(sel),
      text: () => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      click: async (sel: string) => {
        el.querySelector<HTMLElement>(sel)!.click();
        await settle(fixture);
      },
    };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('没有存着的：什么都不显示', async () => {
    const t = listSetup([]);
    await settle(t.fixture);
    expect(t.text()).toBe('');
  });

  it('等着送的：说清在等什么、几张照片、多少公顷；有网时能「现在送」，也能「Buang」', async () => {
    const t = listSetup([entry('a1', { pages: [snapshot().pages[0], snapshot().pages[0]] })]);
    await settle(t.fixture);
    expect(t.text()).toContain('Menunggu dihantar');
    expect(t.text()).toContain('Tanah baharu · 2 gambar · 4.08 ha');
    expect(t.text()).toContain('Menunggu talian');
    expect(t.text()).toContain('dihantar secara automatik');
    await t.click('#send-a1');
    expect(t.queue.flush).toHaveBeenCalled();
    await t.click('#remove-a1');
    expect(t.queue.remove).toHaveBeenCalledWith('a1');
  });

  it('没网：没有「现在送」，只能等或「Buang」', async () => {
    const t = listSetup([entry('a1')], false);
    await settle(t.fixture);
    expect(t.q('#send-a1')).toBeNull();
    expect(t.q('#remove-a1')).not.toBeNull();
  });

  it('送的时候：「现在送」禁用并写「Menghantar…」', async () => {
    const t = listSetup([entry('a1')]);
    t.queue.syncing.set(true);
    await settle(t.fixture);
    const btn = t.q('#send-a1') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent?.trim()).toBe('Menghantar…');
  });

  it('后端拒绝的：标「Gagal dihantar」，说怎么办，没有「现在送」', async () => {
    const t = listSetup([entry('a1', { state: 'failed', errorCode: 'geometry_invalid' })]);
    await settle(t.fixture);
    expect(t.text()).toContain('Gagal dihantar');
    expect(t.text()).toContain('Buang dan tambah semula');
    expect(t.q('#send-a1')).toBeNull();
  });

  it('只显示属于当前这个人的：园主看自己的，外勤看这位成员的', async () => {
    const mine = entry('a1');
    const members = entry('a2', { memberId: 'm9' });
    const owner = listSetup([mine, members]);
    await settle(owner.fixture);
    expect(owner.q('#remove-a1')).not.toBeNull();
    expect(owner.q('#remove-a2')).toBeNull();
    TestBed.resetTestingModule();
    const officer = listSetup([mine, members], true, 'm9');
    await settle(officer.fixture);
    expect(officer.q('#remove-a1')).toBeNull();
    expect(officer.q('#remove-a2')).not.toBeNull();
  });

  it('一个点的地块：写手填的面积', async () => {
    const t = listSetup([entry('a1', { geometry: { kind: 'point', point: [101.1, 4.3], declaredHa: 2.5 } })]);
    await settle(t.fixture);
    expect(t.text()).toContain('2.5 ha');
  });
});
