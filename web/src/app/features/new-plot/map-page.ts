import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { BackNavigator } from '../../core/back-navigator';
import { formatArea } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { DraftService } from './draft.service';
import { GeoError, GeolocationService, type GeoErrorKey, type GeoFix } from './geolocation.service';
import { GPS_WARN_M, checkRing, parseDeclaredHa, type LngLat, type MapTab } from './geometry';
import type { MapSurface } from './map-surface';
import { MapsError, MapsService, type MapsErrorKey } from './maps.service';

// 屏 5「圈地块」（线框 docs/ui/screen-05.png）：在 Google 卫星图上点出每个角、拖动调整，实时看到公顷数；
// 备选「Jalan sudut」（走到角点用 GPS 记）与「Satu titik」（只记一个点，手填面积，4 公顷以下）。
// 结果存在本机内存里（DraftService），不调任何接口：新建地块与上传还要等合同。设计与决定见 web/README.md「已知限制」里屏 5 的几条。
// 顶点数组（DraftService）是唯一事实来源；地图（MapSurface）只负责显示并把点按、拖动报告回来。

type View = 'loading' | 'ready' | 'failed';
type FailKey = MapsErrorKey | 'auth';
type Notice = { tone: 'error' | 'hint'; text: string };

@Component({
  selector: 'app-map-page',
  imports: [LangButton],
  templateUrl: './map-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPage {
  private readonly draft = inject(DraftService);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  private readonly maps = inject(MapsService);
  private readonly geo = inject(GeolocationService);
  private readonly mapEl = viewChild.required<ElementRef<HTMLElement>>('mapEl');
  protected readonly t = inject(I18nService).t;

  protected readonly tabs: readonly MapTab[] = ['map', 'walk', 'point'];
  protected readonly current = computed(() => this.draft.geometryDraft().tab);
  protected readonly canUndo = this.draft.canUndo;
  protected readonly canFinish = computed(() => this.draft.geometry() !== null);

  // 地图状态
  protected readonly view = signal<View>('loading');
  protected readonly failKey = signal<FailKey>('script');
  private readonly surface = signal<MapSurface | null>(null);
  private destroyed = false;

  // 定位状态
  protected readonly locating = signal(false);
  protected readonly geoError = signal<GeoErrorKey | null>(null);
  protected readonly accuracyM = signal<number | null>(null);
  private geoToken = 0;
  private lastGeoAction: (() => void) | null = null;

  // 返回／进入相邻页面时保留当前的查询参数（外勤替成员新建时带着 ?member）
  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  /** 当前页签的顶点（C 页签没有顶点） */
  private readonly ring = computed(() => {
    const g = this.draft.geometryDraft();
    return g.tab === 'map' ? g.mapRing : g.tab === 'walk' ? g.walkRing : [];
  });
  protected readonly count = computed(() => this.ring().length);
  protected readonly point = computed(() => this.draft.geometryDraft().point);
  protected readonly declared = computed(() => this.draft.geometryDraft().declared);

  /** 徽标「≈ 2.1 ha」：A、B 页签有有效面积才显示；写法沿用 formatArea（最多 2 位小数） */
  protected readonly badge = computed(() => {
    if (this.current() === 'point') return null;
    const ha = formatArea(this.draft.evaluation().areaHa, null);
    return ha === null ? null : this.t().newPlot.map.areaApprox(ha);
  });

  /** 地图下面的提示：自交、太小、点不够（A、B）；手填面积写错、≥4 公顷（C） */
  protected readonly notice = computed<Notice | null>(() => {
    const m = this.t().newPlot.map;
    const problem = this.draft.evaluation().problem;
    if (this.current() === 'point') {
      const d = parseDeclaredHa(this.declared());
      if (d.kind === 'invalid') return { tone: 'error', text: m.badNumber };
      if (d.kind === 'big') return { tone: 'error', text: m.bigPoint };
      // 点放了、面积还空着：「Selesai」为什么灰着要说一声（不红字：还没填不算错）
      if (d.kind === 'empty' && this.point()) return { tone: 'hint', text: m.needArea };
      return null;
    }
    if (problem === 'self') return { tone: 'error', text: m.selfIntersect };
    if (problem === 'tiny') return { tone: 'error', text: m.tooSmall };
    // 点数按「不同的点」算：连续重复的点（站着不动按了两次）不算多一个
    if (problem === 'few' && this.count() > 0) {
      return { tone: 'hint', text: m.needThree(checkRing(this.ring()).count) };
    }
    return null;
  });

  /** C 页签：手填面积 ≥4 公顷时要给「去画边界」的按钮 */
  protected readonly bigDeclared = computed(
    () => this.current() === 'point' && parseDeclaredHa(this.declared()).kind === 'big',
  );

  /** 这次 GPS 精度大于 10 米：提示改用卫星图（B 页签） */
  protected readonly weakGps = computed(() => {
    const m = this.accuracyM();
    if (m === null) return null;
    // 用四舍五入后的数判断：文案写的就是这个数，不会出现「±10 m」却弹「信号弱」
    const rounded = Math.round(m);
    return rounded > GPS_WARN_M ? rounded : null;
  });
  protected readonly accuracyText = computed(() => {
    const m = this.accuracyM();
    return m === null ? null : this.t().newPlot.map.accuracy(Math.round(m));
  });

  /** 读屏用的播报：面积、点数、提示（aria-live） */
  protected readonly live = computed(() => {
    const m = this.t().newPlot.map;
    const parts: string[] = [];
    // 点数按「不同的点」报，与地图下面的提示一致
    if (this.current() !== 'point') parts.push(m.points(checkRing(this.ring()).count));
    const badge = this.badge();
    if (badge) parts.push(badge);
    const notice = this.notice();
    if (notice) parts.push(notice.text);
    return parts.join('. ');
  });

  constructor() {
    afterNextRender(() => this.start());
    // 顶点数组 → 地图：每次草稿变化都重画（地图实现只在位置真的变了才动把手）
    effect(() => {
      const surface = this.surface();
      if (!surface) return;
      const g = this.draft.geometryDraft();
      surface.setVertices(this.ring(), { draggable: g.tab === 'map' });
      surface.setPoint(g.tab === 'point' ? g.point : null);
    });
    // Google 在 key 被拒时只调 gm_authFailure（脚本本身仍加载成功）：地图盖上说明，不让人对着灰底点
    effect(() => {
      if (this.maps.authFailed()) this.failAuth();
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.surface()?.destroy();
    });
  }

  /** 加载地图脚本并创建地图；失败显示原因（带重试）。晚到的结果在页面销毁后丢弃 */
  protected start(): void {
    if (this.maps.authFailed()) return this.failAuth();
    this.view.set('loading');
    this.maps
      .load()
      .then(() => {
        if (this.destroyed) return;
        if (this.maps.authFailed()) return this.failAuth();
        const surface = this.maps.createSurface(this.mapEl().nativeElement, {
          onTap: (p) => this.onTap(p),
          onVertexMove: (i, p) => this.draft.moveVertex(i, p),
        });
        this.surface.set(surface);
        this.view.set('ready');
        const g = this.draft.geometryDraft();
        const mine = g.tab === 'point' ? (g.point ? [g.point] : []) : this.ring();
        surface.fit(
          mine.length > 0 ? mine : [...g.mapRing, ...g.walkRing, ...(g.point ? [g.point] : [])],
        );
      })
      .catch((err: unknown) => {
        if (this.destroyed) return;
        this.failKey.set(err instanceof MapsError ? err.key : 'script');
        this.view.set('failed');
      });
  }

  /** 重试只对「可能自己好转」的失败有用：离线、超时、脚本加载失败；key 的问题重试没用 */
  protected readonly canRetryMap = computed(() => {
    const k = this.failKey();
    return k !== 'auth' && k !== 'no-key';
  });

  private failAuth(): void {
    this.failKey.set('auth');
    this.view.set('failed');
  }

  /** 点按地图：A 页签加一个顶点，C 页签放（或移动）那个点，B 页签不放点 */
  private onTap(p: LngLat): void {
    const tab = this.current();
    if (tab === 'map') this.draft.addVertex('map', p);
    else if (tab === 'point') this.draft.setPoint(p);
  }

  protected select(tab: MapTab): void {
    if (tab === this.current()) return;
    this.draft.setTab(tab);
    this.geoToken++; // 别的页签发起的定位读取晚到时丢弃
    this.locating.set(false);
    this.geoError.set(null);
    this.accuracyM.set(null);
  }

  protected onTab(event: KeyboardEvent, tab: MapTab): void {
    const i = this.tabs.indexOf(tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = this.tabs[(i + step + this.tabs.length) % this.tabs.length];
    const group = (event.currentTarget as HTMLElement).parentElement;
    this.select(next);
    queueMicrotask(() => group?.querySelector<HTMLElement>(`#tab-${next}`)?.focus());
  }

  protected undo(): void {
    this.draft.removeLast();
  }

  protected onDeclared(event: Event): void {
    this.draft.setDeclared((event.target as HTMLInputElement).value);
  }

  protected done(): void {
    if (this.draft.geometry()) void this.router.navigate(['/plots/new/review'], this.keep);
  }

  /** 有历史就后退，没有就回屏 3（保留 ?member）；各页签的输入都留在草稿里 */
  protected back(): void {
    this.backNav.back(['/plots/new'], this.keep);
  }

  // ---- 定位（只在点按钮时才请求权限；一次一个读取，页面销毁或重复点击后丢弃晚到的结果） ----

  /** A 页签「Lokasi saya」：地图移到当前位置 */
  protected locateMe(): void {
    this.readFix((fix) => this.surface()?.panTo(fix.point, 17));
  }

  /** C 页签「Guna lokasi saya」：当前位置就是那个点 */
  protected useMyLocation(): void {
    this.readFix((fix) => {
      this.draft.setPoint(fix.point);
      this.surface()?.panTo(fix.point, 17);
    });
  }

  /** B 页签「Tandakan sudut di sini」：当前位置加为一个角点 */
  protected markHere(): void {
    this.readFix((fix) => {
      this.draft.addVertex('walk', fix.point);
      this.accuracyM.set(fix.accuracyM);
      this.surface()?.panTo(fix.point, 17);
    });
  }

  protected retryGeo(): void {
    this.lastGeoAction?.();
  }

  private readFix(apply: (fix: GeoFix) => void): void {
    if (this.locating()) return;
    this.lastGeoAction = () => this.readFix(apply);
    const token = ++this.geoToken;
    this.locating.set(true);
    this.geoError.set(null);
    this.geo.locate().then(
      (fix) => {
        if (this.destroyed || token !== this.geoToken) return;
        this.locating.set(false);
        apply(fix);
      },
      (err: unknown) => {
        if (this.destroyed || token !== this.geoToken) return;
        this.locating.set(false);
        this.geoError.set(err instanceof GeoError ? err.key : 'unavailable');
      },
    );
  }
}
