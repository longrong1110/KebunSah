import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { OfflineQueue } from './offline-queue';

// 页面顶上的一条提示：没信号时说「还能拍照和画，有网了再送」；存着的草稿送出去之后说「已送出，正在检查」并给一个去看的入口。
// 没事的时候什么都不显示。role="status"：读屏会念，但不打断。
@Component({
  selector: 'app-connection-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!queue.online()) {
      <div id="offline-banner" class="conn conn--off" role="status">
        <span class="ic ic-offline" aria-hidden="true"></span>
        <span>{{ t().offline.banner }}</span>
      </div>
    } @else if (queue.sent(); as plotId) {
      <div id="sent-banner" class="conn conn--ok" role="status">
        <span class="ic ic-check" aria-hidden="true"></span>
        <span>{{ t().offline.sent }}</span>
        <button type="button" class="btn-link" id="sent-view" (click)="view(plotId)">
          {{ t().offline.view }}
        </button>
        <button
          type="button"
          class="icon-btn"
          id="sent-dismiss"
          [attr.aria-label]="t().offline.dismiss"
          (click)="queue.dismissSent()"
        >
          <span class="ic ic-x" aria-hidden="true"></span>
        </button>
      </div>
    }
  `,
})
export class ConnectionBanner {
  protected readonly queue = inject(OfflineQueue);
  private readonly router = inject(Router);
  protected readonly t = inject(I18nService).t;

  protected view(plotId: string): void {
    this.queue.dismissSent();
    void this.router.navigate(['/plots', plotId, 'checking']);
  }
}
