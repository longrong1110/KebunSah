import type { LngLat, Ring } from './geometry';
import type { MapSurface, MapSurfaceHandlers } from './map-surface';
import { Px, TapTracker, nearAnyHandle } from './tap';

// MapSurface 的 Google Maps 实现：自持顶点数组 + google.maps.Polygon + 可拖动 Marker，点按自己判断。
// 做法与原因都在 specs/screen-5-map/spec.md「决定」与 specs/_facts.md F-043…F-046：
// - 不用 Google 的 Drawing Library（已下线）；也不用 Terra Draw（没有撤销、收尾手势难发现、依赖 Google 内部 DOM）
// - 不用 map 的 click 事件（会吞快速的第二下，F-045）：在地图元素上看 pointerdown／pointerup
// - 把手是 44×44 的 SVG 图标 Marker；google.maps.Marker 已被 Google 标为弃用但仍可用，没有下线日期（F-043 实测可用）
// 这个文件只能在真实浏览器里验证（jsdom 没有 Google Maps），见 plan.md T10。

/** 半岛马来西亚全景：没有任何点、也没有定位时的初始视野 */
const MALAYSIA_CENTER = { lat: 4.2, lng: 102.0 };
const MALAYSIA_ZOOM = 7;

const STROKE = '#c2610c'; // 与线框里多边形边线的橙色一致
const FILL = '#f2b84b';

const handleIcon = (filled: boolean): google.maps.Icon => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">` +
    `<circle cx="22" cy="22" r="11" fill="${filled ? STROKE : '#fff'}" stroke="${filled ? '#fff' : STROKE}" stroke-width="4"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(44, 44),
    anchor: new google.maps.Point(22, 22),
  };
};

const toLiteral = ([lng, lat]: LngLat): google.maps.LatLngLiteral => ({ lat, lng });
const fromLatLng = (ll: google.maps.LatLng): LngLat => [ll.lng(), ll.lat()];
const samePosition = (ll: google.maps.LatLng | null | undefined, [lng, lat]: LngLat): boolean =>
  !!ll && Math.abs(ll.lng() - lng) < 1e-9 && Math.abs(ll.lat() - lat) < 1e-9;

export class GoogleSurface implements MapSurface {
  private readonly map: google.maps.Map;
  private readonly overlay: google.maps.OverlayView;
  private readonly polygon: google.maps.Polygon;
  private readonly markers: google.maps.Marker[] = [];
  private pointMarker: google.maps.Marker | null = null;
  private readonly cleanups: (() => void)[] = [];
  private readonly taps = new TapTracker();

  constructor(
    private readonly el: HTMLElement,
    private readonly handlers: MapSurfaceHandlers,
  ) {
    this.map = new google.maps.Map(el, {
      center: MALAYSIA_CENTER,
      zoom: MALAYSIA_ZOOM,
      mapTypeId: 'satellite',
      tilt: 0,
      gestureHandling: 'greedy',
      // 只留 +/− 缩放：手机上默认不显示，但不会双指缩放的人要靠它；其余控件都关（镜头、旋转／倾斜、街景、全屏、地图类型、比例尺）
      zoomControl: true,
      cameraControl: false,
      rotateControl: false,
      scaleControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      clickableIcons: false,
      disableDoubleClickZoom: true,
      keyboardShortcuts: false,
    });
    this.polygon = new google.maps.Polygon({
      map: this.map,
      paths: [],
      strokeColor: STROKE,
      strokeWeight: 3,
      fillColor: FILL,
      fillOpacity: 0.3,
      clickable: false,
    });
    // 坐标与像素互转要用它的投影
    this.overlay = new google.maps.OverlayView();
    this.overlay.onAdd = () => {};
    this.overlay.draw = () => {};
    this.overlay.onRemove = () => {};
    this.overlay.setMap(this.map);
    this.listenForTaps();
  }

  setVertices(ring: Ring, options: { draggable: boolean }): void {
    this.polygon.setPath(ring.map(toLiteral));
    this.polygon.setOptions({ fillOpacity: ring.length >= 3 ? 0.3 : 0 });
    // 对齐把手：位置没变的不动（拖动中的那个把手正是页面刚收到的位置，重设会打断拖动）
    ring.forEach((p, i) => {
      const existing = this.markers[i];
      if (existing) {
        if (!samePosition(existing.getPosition(), p)) existing.setPosition(toLiteral(p));
        if (existing.getDraggable() !== options.draggable) existing.setDraggable(options.draggable);
      } else {
        this.markers.push(this.createHandle(p, options.draggable));
      }
    });
    while (this.markers.length > ring.length) this.markers.pop()?.setMap(null);
  }

  setPoint(p: LngLat | null): void {
    if (!p) {
      this.pointMarker?.setMap(null);
      this.pointMarker = null;
      return;
    }
    if (this.pointMarker) {
      if (!samePosition(this.pointMarker.getPosition(), p))
        this.pointMarker.setPosition(toLiteral(p));
      return;
    }
    this.pointMarker = new google.maps.Marker({
      map: this.map,
      position: toLiteral(p),
      icon: handleIcon(true),
      clickable: false,
      optimized: false,
      zIndex: 10,
    });
  }

  fit(points: readonly LngLat[]): void {
    if (points.length === 0) return;
    if (points.length === 1) {
      this.panTo(points[0], 17);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(toLiteral(p)));
    this.map.fitBounds(bounds, 48);
  }

  panTo(p: LngLat, minZoom?: number): void {
    // 要放大时一步到位（moveCamera 同时设中心和缩放）；先 panTo 再 setZoom 可能以旧中心为缩放中心，落点对不准
    if (minZoom !== undefined && (this.map.getZoom() ?? 0) < minZoom) {
      this.map.moveCamera({ center: toLiteral(p), zoom: minZoom });
    } else {
      this.map.panTo(toLiteral(p));
    }
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups.length = 0;
    this.markers.forEach((m) => m.setMap(null));
    this.markers.length = 0;
    this.pointMarker?.setMap(null);
    this.pointMarker = null;
    this.polygon.setMap(null);
    this.overlay.setMap(null);
    google.maps.event.clearInstanceListeners(this.map);
  }

  private createHandle(p: LngLat, draggable: boolean): google.maps.Marker {
    const marker = new google.maps.Marker({
      map: this.map,
      position: toLiteral(p),
      draggable,
      icon: handleIcon(false),
      optimized: false,
      zIndex: 10,
    });
    const report = (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const index = this.markers.indexOf(marker);
      if (index >= 0) this.handlers.onVertexMove(index, fromLatLng(e.latLng));
    };
    marker.addListener('drag', report);
    marker.addListener('dragend', report);
    return marker;
  }

  /** 屏幕上的像素位置（相对地图元素左上角）→ 坐标；投影还没就绪返回 null */
  private toLngLat(px: Px): LngLat | null {
    const ll = this.overlay
      .getProjection()
      ?.fromContainerPixelToLatLng(new google.maps.Point(px.x, px.y));
    return ll ? fromLatLng(ll) : null;
  }

  private handlePixels(): Px[] {
    const projection = this.overlay.getProjection();
    if (!projection) return [];
    return this.markers.flatMap((m) => {
      const pos = m.getPosition();
      const px = pos && projection.fromLatLngToContainerPixel(pos);
      return px ? [{ x: px.x, y: px.y }] : [];
    });
  }

  /** 点按 = 单指按下与抬起离得近、时间短（TapTracker）；多指（缩放）、拖动、鼠标右键都不算（F-045） */
  private listenForTaps(): void {
    const el = this.el;
    const input = (e: PointerEvent) => ({
      pointerId: e.pointerId,
      isPrimary: e.isPrimary,
      button: e.button,
      pointerType: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
    });
    const onDown = (e: PointerEvent) => this.taps.pointerDown(input(e));
    const onCancel = (e: PointerEvent) => this.taps.pointerCancel(e);
    const onUp = (e: PointerEvent) => {
      if (!this.taps.pointerUp(input(e))) return;
      // 点在 Google 自己的控件（缩放按钮）上不放点
      if ((e.target as Element | null)?.closest?.('button, a, [role="button"]')) return;
      const rect = el.getBoundingClientRect();
      const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // 点在已有把手上是选它，不放新点（几何判断，不依赖 Google 的 DOM，F-046）
      if (nearAnyHandle(px, this.handlePixels())) return;
      const p = this.toLngLat(px);
      if (p) this.handlers.onTap(p);
    };
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onCancel, true);
    this.cleanups.push(() => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onCancel, true);
    });
  }
}
