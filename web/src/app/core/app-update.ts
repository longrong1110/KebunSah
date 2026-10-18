import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter, fromEvent, interval } from 'rxjs';

/** 新建地块的这几页，草稿只在内存里：这时重新加载页面会丢照片，要等离开了再加载 */
const DRAFT_PAGES = '/plots/new';
const CHECK_EVERY_MS = 5 * 60 * 1000;

// PWA 的 Service Worker 会把旧版本缓存下来：发布新版本之后，用户要重新打开两次才会换上。
// 这里让它自己换：新版本下载好就重新加载页面（正在填新建地块时，等离开那几页再加载）；
// 隔几分钟、以及回到这个标签页时，主动查一次有没有新版本。没有启用 Service Worker（开发环境、测试）什么都不做。
@Injectable({ providedIn: 'root' })
export class AppUpdate {
  private readonly sw = inject(SwUpdate);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private pending = false;

  start(reload: () => void = () => this.doc.defaultView?.location.reload()): void {
    if (!this.sw.isEnabled) return;
    const reloadIfSafe = () => {
      if (this.pending && !this.router.url.startsWith(DRAFT_PAGES)) {
        this.pending = false;
        reload();
      }
    };
    this.sw.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.pending = true;
        reloadIfSafe();
      });
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(reloadIfSafe);

    const check = () => void this.sw.checkForUpdate().catch(() => undefined);
    interval(CHECK_EVERY_MS).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(check);
    fromEvent(this.doc, 'visibilitychange')
      .pipe(
        filter(() => this.doc.visibilityState === 'visible'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(check);
  }
}
