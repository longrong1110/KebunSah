import { DOCUMENT, Location } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationExtras,
  Router,
} from '@angular/router';
import { filter, take } from 'rxjs';

/** Navigation API（Chromium 系已有）里我们用到的那一点 */
type WindowWithNavigation = Window & { navigation?: { canGoBack?: boolean } };

/** 一次后退最多「占用」这么久：路由器没来得及给出导航结果（或根本没导航）时，到点也解除 */
const PENDING_MS = 800;

/**
 * 页面左上角「返回」的统一做法：浏览器历史里有上一条就后退（不新增历史记录），否则导航到兜底路径。
 * 各页原来自己 navigate(['/'])，会产生 [/plots/new, /, /plots/new] 这样的历史回环，也会让管理员
 * 从看板进屏 9 再返回时丢掉筛选和选中的地块。
 */
@Injectable({ providedIn: 'root' })
export class BackNavigator {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);

  /**
   * 一次后退还没生效时为 true，期间的重复点击忽略：history.back() 连点两次会各退一步，
   * 慢机上双击屏 4 的「Guna gambar」会从屏 4 一路退过屏 3 到屏 2，屏 2 又会把已拍的草稿清掉。
   */
  private pending = false;

  /**
   * 当前页之前还有一条同源的历史记录。优先用 Navigation API 的 canGoBack：它只数当前位置之前、同源的条目，
   * 不会被「前进」条目误导（history.length 是整个标签页的总条数），也不会退回别的网站；
   * 不支持的浏览器退回 history.length > 1（测试环境里恒为 1）。
   */
  canGoBack(): boolean {
    const win = this.document.defaultView as WindowWithNavigation | null;
    const flag = win?.navigation?.canGoBack;
    if (typeof flag === 'boolean') return flag;
    const history = win?.history;
    return !!history && history.length > 1;
  }

  /** 有历史就后退；没有就替换成兜底路径（replaceUrl：不在历史里多留一条）。extras 只在兜底时用，如 queryParamsHandling */
  back(fallback: readonly unknown[], extras: NavigationExtras = {}): void {
    if (this.pending) return;
    if (!this.canGoBack()) {
      void this.router.navigate([...fallback], { ...extras, replaceUrl: true });
      return;
    }
    this.pending = true;
    const release = () => {
      this.pending = false;
      clearTimeout(timer);
      done.unsubscribe();
    };
    const timer = setTimeout(release, PENDING_MS);
    const done = this.router.events
      .pipe(
        filter(
          (e) =>
            e instanceof NavigationEnd ||
            e instanceof NavigationCancel ||
            e instanceof NavigationError,
        ),
        take(1),
      )
      .subscribe(release);
    this.location.back();
  }
}
