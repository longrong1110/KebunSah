import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppUpdate } from './core/app-update';
import { ConnectionBanner } from './features/offline/connection-banner';
import { OfflineQueue } from './features/offline/offline-queue';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConnectionBanner],
  template: '<app-connection-banner /><router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  constructor() {
    inject(AppUpdate).start(); // 新版本下载好就自动换上（PWA 的缓存不会让用户一直停在旧版本）
    inject(OfflineQueue).start(); // 手机里存着、没送出去的草稿：有网了自动送
  }
}
