import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { stubHistory } from '../../../testing/back';
import { settle } from '../../../testing/fake-facade';
import { FakeMaps, fakeGeolocation } from '../../../testing/fake-maps';
import { I18nService } from '../../core/i18n/i18n.service';
import { DraftService } from './draft.service';
import { GeoError, GeolocationService } from './geolocation.service';
import type { LngLat } from './geometry';
import { MapPage } from './map-page';
import { MapsService } from './maps.service';

@Component({ template: '' })
class Blank {}

// 点按出的矩形（≈4.08 ha，见 geometry.spec.ts）与「蝴蝶结」（自交）
const RECT: LngLat[] = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];
const BOWTIE: LngLat[] = [
  [101.0, 4.0],
  [101.002, 4.002],
  [101.002, 4.0],
  [101.0, 4.002],
];

async function setup(
  opts: { url?: string; maps?: FakeMaps; preload?: (draft: DraftService) => void } = {},
) {
  const maps = opts.maps ?? new FakeMaps();
  const geo = fakeGeolocation();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'plots/new', component: Blank },
        { path: 'plots/new/review', component: Blank },
        { path: 'plots/new/map', component: MapPage },
      ]),
      { provide: MapsService, useValue: maps },
      { provide: GeolocationService, useValue: geo },
    ],
  });
  const draft = TestBed.inject(DraftService);
  opts.preload?.(draft);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(opts.url ?? '/plots/new/map?member=p9', MapPage);
  await settle(harness.fixture);
  const el = harness.fixture.nativeElement as HTMLElement;
  return {
    maps,
    geo,
    draft,
    el,
    fixture: harness.fixture,
    router: TestBed.inject(Router),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    text: (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    async click(sel: string) {
      el.querySelector<HTMLElement>(sel)!.click();
      await settle(harness.fixture);
    },
    async tap(p: LngLat) {
      maps.surface.handlers.onTap(p);
      await settle(harness.fixture);
    },
    async type(sel: string, value: string) {
      const input = el.querySelector<HTMLInputElement>(sel)!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle(harness.fixture);
    },
    async settle() {
      await settle(harness.fixture);
    },
  };
}

type Page = Awaited<ReturnType<typeof setup>>;

async function drawRect(p: Page) {
  for (const v of RECT) await p.tap(v);
}

describe('MapPage（屏 5 圈地块）', () => {
  // 语言记在 localStorage：D8 切到英语后不能影响别的用例
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe('A 画多边形（Lukis di peta）', () => {
    it('A1 进入：默认「Lukis di peta」，步骤条、提示、没有徽标，「Padam titik」「Selesai」都禁用，进屏不弹定位', async () => {
      const p = await setup();
      expect(p.text('.step-label')).toBe('Langkah 2 / 3 · Tanah anda');
      expect(p.q('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
      expect(p.el.querySelectorAll('.progress__seg--on')).toHaveLength(2);
      expect(p.q('#tab-map')?.getAttribute('aria-selected')).toBe('true');
      expect(p.q('#tab-walk')?.getAttribute('aria-selected')).toBe('false');
      expect(p.text('#map-hint')).toBe(
        'Ketik di peta untuk letak titik pada setiap penjuru tanah.',
      );
      expect(p.q('#area-badge')).toBeNull();
      expect((p.q('#undo') as HTMLButtonElement).disabled).toBe(true);
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
      expect(p.geo.locate).not.toHaveBeenCalled();
    });

    it('A2/A3 点 1～2 个点没有徽标；第 3 个点出面积徽标；4 个点 ≈ 4.08 ha 且可以完成', async () => {
      const p = await setup();
      await p.tap(RECT[0]);
      await p.tap(RECT[1]);
      expect(p.q('#area-badge')).toBeNull();
      expect(p.maps.surface.vertices).toHaveLength(2);
      expect(p.text('#notice')).toBe('Perlu sekurang-kurangnya 3 titik (sudah 2).');
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
      await p.tap(RECT[2]);
      expect(p.q('#area-badge')).not.toBeNull();
      await p.tap(RECT[3]);
      expect(p.text('#area-badge')).toBe('≈ 4.08 ha');
      expect(p.q('#notice')).toBeNull();
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(false);
      expect(p.maps.surface.vertices).toEqual(RECT);
      expect(p.maps.surface.draggable).toBe(true);
    });

    it('A5 拖动把手：顶点与徽标实时更新', async () => {
      const p = await setup();
      await drawRect(p);
      const before = p.text('#area-badge');
      p.maps.surface.handlers.onVertexMove(1, [101.163592, 4.327204]);
      await p.settle();
      expect(p.text('#area-badge')).not.toBe(before);
      expect(p.maps.surface.vertices[1]).toEqual([101.163592, 4.327204]);
    });

    it('A7 「Padam titik」删最后一个点；少于 3 个点徽标消失、「Selesai」禁用；没有点时「Padam titik」禁用', async () => {
      const p = await setup();
      await drawRect(p);
      await p.click('#undo');
      expect(p.maps.surface.vertices).toEqual(RECT.slice(0, 3));
      await p.click('#undo');
      expect(p.q('#area-badge')).toBeNull();
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
      await p.click('#undo');
      await p.click('#undo');
      expect(p.maps.surface.vertices).toHaveLength(0);
      expect((p.q('#undo') as HTMLButtonElement).disabled).toBe(true);
    });

    it('A8 自交：文字提示且不能完成；拖开后恢复', async () => {
      const p = await setup();
      for (const v of BOWTIE) await p.tap(v);
      expect(p.text('#notice')).toContain('Garisan bersilang');
      // 提示已经在 aria-live 的 #live 里播报，#notice 本身不再带 role=alert（不然读屏念两遍）
      expect(p.q('#notice')?.getAttribute('role')).toBeNull();
      expect(p.text('#live')).toContain('Garisan bersilang');
      expect(p.q('#area-badge')).toBeNull();
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
      p.maps.surface.handlers.onVertexMove(1, [101.002, 4.0]);
      p.maps.surface.handlers.onVertexMove(2, [101.002, 4.002]);
      await p.settle();
      expect(p.q('#notice')).toBeNull();
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(false);
    });

    it('A9 面积四舍五入成 0：不写「≈ 0 ha」，给提示，不能完成', async () => {
      const p = await setup();
      for (const v of [
        [101, 4],
        [101.00001, 4],
        [101.00001, 4.00001],
      ] as LngLat[])
        await p.tap(v);
      expect(p.q('#area-badge')).toBeNull();
      expect(p.text('#notice')).toContain('terlalu kecil');
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
    });

    it('点当前已选的页签：什么都不变（弱信号提示、精度、读取中的结果都不丢）', async () => {
      const p = await setup();
      await p.click('#tab-walk');
      p.geo.locate.mockResolvedValueOnce({ point: RECT[0], accuracyM: 23 });
      await p.click('#mark-here');
      expect(p.q('#weak-gps')).not.toBeNull();
      await p.click('#tab-walk');
      expect(p.q('#weak-gps')).not.toBeNull();
      expect(p.text('#accuracy')).toBe('Ketepatan GPS ±23 m');
    });

    it('A11 「Lokasi saya」：点了才请求定位，地图移过去（缩放至少 17），点位不受影响', async () => {
      const p = await setup();
      p.geo.locate.mockResolvedValue({ point: [101.2, 4.3], accuracyM: 8 });
      await drawRect(p);
      await p.click('#locate-me');
      expect(p.geo.locate).toHaveBeenCalledTimes(1);
      expect(p.maps.surface.panned).toEqual([{ p: [101.2, 4.3], minZoom: 17 }]);
      expect(p.maps.surface.vertices).toEqual(RECT);
    });

    it('A11 「Lokasi saya」在地图下面的面板里，不盖在地图上（右上角留给把手）', async () => {
      const p = await setup();
      const btn = p.q('#locate-me')!;
      expect(btn.closest('.map-frame')).toBeNull();
      expect(btn.closest('.map-panel')).not.toBeNull();
    });

    it('A11/G1 定位失败：固定的人话，不暴露原始错误；点了「Cuba lagi」再读一次', async () => {
      const p = await setup();
      p.geo.locate.mockRejectedValueOnce(new GeoError('denied'));
      await p.click('#locate-me');
      expect(p.text('#geo-error')).toContain('Kebenaran lokasi ditolak');
      p.geo.locate.mockResolvedValueOnce({ point: [101.2, 4.3], accuracyM: 5 });
      await p.click('#geo-retry');
      expect(p.q('#geo-error')).toBeNull();
      expect(p.maps.surface.panned).toHaveLength(1);
    });
  });

  describe('B 走角点（Jalan sudut）', () => {
    async function toWalk(p: Page) {
      await p.click('#tab-walk');
    }

    it('B1 切到 B：不弹权限；点地图不放点；把手不可拖', async () => {
      const p = await setup();
      await toWalk(p);
      expect(p.text('#map-hint')).toContain('Berjalan ke setiap penjuru tanah');
      expect(p.geo.locate).not.toHaveBeenCalled();
      await p.tap([101.1, 4.3]);
      expect(p.maps.surface.vertices).toHaveLength(0);
      expect(p.maps.surface.draggable).toBe(false);
      expect(p.q('#locate-me')).toBeNull();
    });

    it('B2 「Tandakan sudut di sini」：加角点、显示精度；满 3 个出面积徽标', async () => {
      const p = await setup();
      await toWalk(p);
      const fixes: LngLat[] = [RECT[0], RECT[1], RECT[2]];
      for (const f of fixes) {
        p.geo.locate.mockResolvedValueOnce({ point: f, accuracyM: 4.4 });
        await p.click('#mark-here');
      }
      expect(p.draft.geometryDraft().walkRing).toEqual(fixes);
      expect(p.text('#accuracy')).toBe('Ketepatan GPS ±4 m');
      expect(p.q('#area-badge')).not.toBeNull();
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(false);
      expect(p.draft.geometryDraft().mapRing).toHaveLength(0);
    });

    it('B2 读取期间按钮禁用，不会重复触发', async () => {
      const p = await setup();
      await toWalk(p);
      let finish!: (v: unknown) => void;
      p.geo.locate.mockReturnValueOnce(new Promise((r) => (finish = r)));
      await p.click('#mark-here');
      expect((p.q('#mark-here') as HTMLButtonElement).disabled).toBe(true);
      expect(p.text('#mark-here')).toBe('Mencari lokasi…');
      p.q('#mark-here')!.click();
      expect(p.geo.locate).toHaveBeenCalledTimes(1);
      finish({ point: RECT[0], accuracyM: 3 });
      await p.settle();
      expect((p.q('#mark-here') as HTMLButtonElement).disabled).toBe(false);
    });

    it('B3 精度 >10 m：提示改用卫星图并带切换按钮；≤10 m 时提示消失；提示不阻止记点', async () => {
      const p = await setup();
      await toWalk(p);
      p.geo.locate.mockResolvedValueOnce({ point: RECT[0], accuracyM: 23.6 });
      await p.click('#mark-here');
      expect(p.text('#weak-gps')).toContain('Isyarat GPS lemah (±24 m)');
      expect(p.draft.geometryDraft().walkRing).toHaveLength(1);
      p.geo.locate.mockResolvedValueOnce({ point: RECT[1], accuracyM: 10 });
      await p.click('#mark-here');
      expect(p.q('#weak-gps')).toBeNull();
      p.geo.locate.mockResolvedValueOnce({ point: RECT[2], accuracyM: 12 });
      await p.click('#mark-here');
      await p.click('#switch-map');
      expect(p.q('#tab-map')?.getAttribute('aria-selected')).toBe('true');
    });

    it('B4 四类错误各有说明；已记的点不丢；「Cuba lagi」重试', async () => {
      const p = await setup();
      await toWalk(p);
      p.geo.locate.mockResolvedValueOnce({ point: RECT[0], accuracyM: 3 });
      await p.click('#mark-here');
      const cases = [
        ['denied', 'Kebenaran lokasi ditolak'],
        ['timeout', 'Lokasi mengambil masa terlalu lama'],
        ['unavailable', 'Lokasi tidak tersedia'],
        ['unsupported', 'tidak menyokong lokasi'],
      ] as const;
      for (const [key, snippet] of cases) {
        p.geo.locate.mockRejectedValueOnce(new GeoError(key));
        await p.click('#mark-here');
        expect(p.text('#geo-error'), key).toContain(snippet);
        expect(p.draft.geometryDraft().walkRing).toHaveLength(1);
      }
      expect(p.q('#geo-retry')).toBeNull(); // 设备不支持，重试没用
      p.geo.locate.mockRejectedValueOnce(new GeoError('timeout'));
      await p.click('#mark-here');
      p.geo.locate.mockResolvedValueOnce({ point: RECT[1], accuracyM: 3 });
      await p.click('#geo-retry');
      expect(p.draft.geometryDraft().walkRing).toHaveLength(2);
      expect(p.q('#geo-error')).toBeNull();
    });

    it('B3 精度 10.4 m 四舍五入成 10：不弹弱信号；10.6 m（±11）才弹', async () => {
      const p = await setup();
      await toWalk(p);
      p.geo.locate.mockResolvedValueOnce({ point: RECT[0], accuracyM: 10.4 });
      await p.click('#mark-here');
      expect(p.q('#weak-gps')).toBeNull();
      p.geo.locate.mockResolvedValueOnce({ point: RECT[1], accuracyM: 10.6 });
      await p.click('#mark-here');
      expect(p.text('#weak-gps')).toContain('±11 m');
    });

    it('站着不动连按两次读到同一个点：不报「线交叉」，点数按不同的点算', async () => {
      const p = await setup();
      await toWalk(p);
      for (const f of [RECT[0], RECT[0], RECT[1]]) {
        p.geo.locate.mockResolvedValueOnce({ point: f, accuracyM: 3 });
        await p.click('#mark-here');
      }
      expect(p.draft.geometryDraft().walkRing).toHaveLength(3);
      expect(p.text('#notice')).toBe('Perlu sekurang-kurangnya 3 titik (sudah 2).');
      expect(p.text('#live')).toBe('2 titik. Perlu sekurang-kurangnya 3 titik (sudah 2).');
      p.geo.locate.mockResolvedValueOnce({ point: RECT[2], accuracyM: 3 });
      await p.click('#mark-here');
      expect(p.q('#notice')).toBeNull();
      expect(p.q('#area-badge')).not.toBeNull();
    });

    it('B5 离开页面后晚到的定位结果被丢弃，不改草稿', async () => {
      const p = await setup();
      await toWalk(p);
      let finish!: (v: unknown) => void;
      p.geo.locate.mockReturnValueOnce(new Promise((r) => (finish = r)));
      await p.click('#mark-here');
      p.fixture.destroy();
      finish({ point: RECT[0], accuracyM: 3 });
      await Promise.resolve();
      expect(p.draft.geometryDraft().walkRing).toHaveLength(0);
    });

    it('在读取途中切页签：晚到的结果丢弃', async () => {
      const p = await setup();
      await toWalk(p);
      let finish!: (v: unknown) => void;
      p.geo.locate.mockReturnValueOnce(new Promise((r) => (finish = r)));
      await p.click('#mark-here');
      await p.click('#tab-point');
      finish({ point: RECT[0], accuracyM: 3 });
      await p.settle();
      expect(p.draft.geometryDraft().walkRing).toHaveLength(0);
    });
  });

  describe('C 只记一点（Satu titik）', () => {
    async function toPoint(p: Page) {
      await p.click('#tab-point');
    }

    it('C1/C5 切到 C：有输入框与按钮；没放点时「Selesai」禁用', async () => {
      const p = await setup();
      await toPoint(p);
      expect(p.text('label[for="declared"]')).toBe('Keluasan (ha)');
      expect(p.q('#use-location')).not.toBeNull();
      expect(p.q('#area-badge')).toBeNull();
      await p.type('#declared', '2.5');
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
    });

    it('C2 点地图放点（再点则移动），面积 <4：可以完成；「2,5」按 2.5', async () => {
      const p = await setup();
      await toPoint(p);
      await p.tap([101.1, 4.3]);
      await p.tap([101.2, 4.4]);
      expect(p.draft.geometryDraft().point).toEqual([101.2, 4.4]);
      expect(p.maps.surface.point).toEqual([101.2, 4.4]);
      await p.type('#declared', '2,5');
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(false);
      expect(p.draft.geometry()).toEqual({ kind: 'point', point: [101.2, 4.4], declaredHa: 2.5 });
    });

    it('C3 面积 ≥4（恰好 4 也算）：提示改画边界，带「Lukis di peta」按钮，不能完成', async () => {
      const p = await setup();
      await toPoint(p);
      await p.tap([101.1, 4.3]);
      await p.type('#declared', '4');
      expect(p.text('#notice')).toContain('Tanah 4 ha ke atas mesti dilukis sempadannya di peta.');
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
      await p.click('#draw-instead');
      expect(p.q('#tab-map')?.getAttribute('aria-selected')).toBe('true');
    });

    it('C4 空、0、负数、非数字、多个小数点：行内错误，不能完成', async () => {
      const p = await setup();
      await toPoint(p);
      await p.tap([101.1, 4.3]);
      for (const bad of ['0', '-1', 'abc', '1.2.3']) {
        await p.type('#declared', bad);
        expect(p.text('#notice'), bad).toContain('Masukkan keluasan dalam hektar');
        expect(p.q('#declared')?.getAttribute('aria-invalid')).toBe('true');
        expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
      }
      await p.type('#declared', '');
      // 点放了、面积还空着：不红字（还没填不算错），但要说一声「Selesai」为什么灰着
      expect(p.text('#notice')).toBe('Masukkan keluasan (ha) untuk teruskan.');
      expect(p.q('#notice')?.classList.contains('error')).toBe(false);
      expect(p.q('#declared')?.getAttribute('aria-invalid')).toBeNull();
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(true);
    });

    it('C5 「Padam titik」清掉那个点，手填面积保留', async () => {
      const p = await setup();
      await toPoint(p);
      await p.tap([101.1, 4.3]);
      await p.type('#declared', '2');
      await p.click('#undo');
      expect(p.draft.geometryDraft().point).toBeNull();
      expect(p.maps.surface.point).toBeNull();
      expect((p.q('#declared') as HTMLInputElement).value).toBe('2');
      expect((p.q('#undo') as HTMLButtonElement).disabled).toBe(true);
    });

    it('「Guna lokasi saya」把当前位置当作那个点；地图加载失败时也能用', async () => {
      const maps = new FakeMaps();
      maps.failWith = 'offline';
      const p = await setup({ maps });
      await toPoint(p);
      p.geo.locate.mockResolvedValueOnce({ point: [101.3, 4.5], accuracyM: 6 });
      await p.click('#use-location');
      await p.type('#declared', '1.5');
      expect(p.draft.geometry()).toEqual({ kind: 'point', point: [101.3, 4.5], declaredHa: 1.5 });
      expect((p.q('#done') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('D 通用', () => {
    it('页签切换不丢各自的输入，「Selesai」只存当前页签（决定 5）', async () => {
      const p = await setup();
      await drawRect(p);
      await p.click('#tab-point');
      await p.tap([101.1, 4.3]);
      await p.type('#declared', '1.2');
      await p.click('#done');
      expect(p.router.url).toBe('/plots/new/review?member=p9');
      expect(p.draft.geometry()).toEqual({ kind: 'point', point: [101.1, 4.3], declaredHa: 1.2 });
      expect(p.draft.geometryDraft().mapRing).toEqual(RECT);
    });

    it('D3 「Selesai」不可用时点不动；可用时进占位页并保留 ?member', async () => {
      const p = await setup();
      p.q('#done')!.click();
      await p.settle();
      expect(p.router.url).toBe('/plots/new/map?member=p9');
      await drawRect(p);
      await p.click('#done');
      expect(p.router.url).toBe('/plots/new/review?member=p9');
    });

    it('D2 返回：没有历史回屏 3 保留 ?member；有历史后退不再导航；草稿都留着', async () => {
      const p = await setup();
      await drawRect(p);
      await p.click('#back');
      expect(p.router.url).toBe('/plots/new?member=p9');
      expect(p.draft.geometryDraft().mapRing).toEqual(RECT);
    });

    it('D2 有历史：后退，不再导航', async () => {
      const p = await setup();
      const back = stubHistory(true);
      await p.click('#back');
      expect(back).toHaveBeenCalledTimes(1);
      expect(p.router.url).toBe('/plots/new/map?member=p9');
    });

    it('D4 回到屏 5：页签、点、手填数都在，地图适配到这些点，徽标一致', async () => {
      const p = await setup({
        preload: (d) => {
          for (const v of RECT) d.addVertex('map', v);
          d.setDeclared('1.5');
        },
      });
      expect(p.q('#tab-map')?.getAttribute('aria-selected')).toBe('true');
      expect(p.text('#area-badge')).toBe('≈ 4.08 ha');
      expect(p.maps.surface.vertices).toEqual(RECT);
      expect(p.maps.surface.fitted).toEqual([RECT]);
      await p.click('#tab-point');
      expect((p.q('#declared') as HTMLInputElement).value).toBe('1.5');
    });

    it('D5 地图加载中显示占位，加载好后消失', async () => {
      const maps = new FakeMaps();
      maps.mode = 'hold';
      const p = await setup({ maps });
      expect(p.text('#map-loading')).toBe('Memuatkan peta…');
      maps.resolve();
      await p.settle();
      expect(p.q('#map-loading')).toBeNull();
      expect(p.q('#map-failed')).toBeNull();
    });

    it('D6 加载失败（离线）：说明＋「Cuba lagi」；B、C 仍可用；重试成功后已有点恢复显示', async () => {
      const maps = new FakeMaps();
      maps.failWith = 'offline';
      const p = await setup({
        maps,
        preload: (d) => {
          for (const v of RECT) d.addVertex('map', v);
        },
      });
      expect(p.text('#map-failed')).toContain('Tiada sambungan internet.');
      expect(p.text('#map-failed')).toContain(
        'Anda masih boleh guna “Jalan sudut” atau “Satu titik”.',
      );
      expect(p.q('#map-retry')).not.toBeNull();
      expect(p.q('#locate-me')).toBeNull();
      await p.click('#tab-walk');
      expect((p.q('#mark-here') as HTMLButtonElement).disabled).toBe(false);
      await p.click('#tab-map');
      maps.failWith = null;
      await p.click('#map-retry');
      expect(p.q('#map-failed')).toBeNull();
      expect(p.maps.surface.vertices).toEqual(RECT);
    });

    it('D6 没配置 key 或 key 被拒：说明，没有重试按钮', async () => {
      const noKey = new FakeMaps();
      noKey.failWith = 'no-key';
      const a = await setup({ maps: noKey });
      expect(a.text('#map-failed')).toContain('Peta belum dikonfigurasi.');
      expect(a.q('#map-retry')).toBeNull();
    });

    it('D6 Google 报告 key 被拒（gm_authFailure）：盖上说明，没有重试按钮', async () => {
      const p = await setup();
      expect(p.q('#map-failed')).toBeNull();
      p.maps.authFailed.set(true);
      await p.settle();
      expect(p.text('#map-failed')).toContain('Kunci peta ditolak oleh Google.');
      expect(p.q('#map-retry')).toBeNull();
    });

    it('D6 再次进屏时 key 已经被拒过：直接显示说明，不停在「加载中」', async () => {
      const maps = new FakeMaps();
      maps.authFailed.set(true);
      const p = await setup({ maps });
      expect(p.text('#map-failed')).toContain('Kunci peta ditolak');
      expect(p.q('#map-loading')).toBeNull();
      expect(maps.load).not.toHaveBeenCalled();
    });

    it('D8 BM／EN 切换：文案即时更新', async () => {
      const p = await setup();
      TestBed.inject(I18nService).set('en');
      await p.settle();
      expect(p.text('#tab-map')).toBe('Draw on map');
      expect(p.text('.step-label')).toBe('Step 2 / 3 · Your land');
      expect(p.text('#done')).toBe('Done');
      await drawRect(p);
      expect(p.text('#area-badge')).toBe('≈ 4.08 ha');
    });

    it('D10 面积与提示在 aria-live 区域里', async () => {
      const p = await setup();
      await drawRect(p);
      expect(p.q('#live')?.getAttribute('aria-live')).toBe('polite');
      expect(p.text('#live')).toBe('4 titik. ≈ 4.08 ha');
    });

    it('D11 离开页面：释放地图一次，晚到的加载结果丢弃', async () => {
      const maps = new FakeMaps();
      const p = await setup({ maps });
      const surface = maps.surface;
      p.fixture.destroy();
      expect(surface.destroyed).toBe(1);

      const held = new FakeMaps();
      held.mode = 'hold';
      TestBed.resetTestingModule();
      const q = await setup({ maps: held });
      q.fixture.destroy();
      held.resolve();
      await Promise.resolve();
      expect(held.surfaces).toHaveLength(0);
    });

    it('页签的键盘操作：左右方向键切换', async () => {
      const p = await setup();
      p.q('#tab-map')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      await p.settle();
      expect(p.q('#tab-walk')?.getAttribute('aria-selected')).toBe('true');
      p.q('#tab-walk')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      await p.settle();
      expect(p.q('#tab-map')?.getAttribute('aria-selected')).toBe('true');
      p.q('#tab-map')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      await p.settle();
      expect(p.q('#tab-point')?.getAttribute('aria-selected')).toBe('true');
    });
  });
});
