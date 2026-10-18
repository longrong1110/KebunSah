import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { formatArea } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { OfflineQueue } from './offline-queue';

// 屏 2 地块列表最上面：手机里存着、还没送出去的草稿。每一张说清楚「在等什么」；
// 等着的有网时可以点「现在送」；后端明确拒绝的标「失败」，只能「Buang」。
@Component({
  selector: 'app-pending-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length > 0) {
      <section class="pending" aria-labelledby="pending-title">
        <h2 id="pending-title" class="section-title">{{ t().offline.pendingTitle }}</h2>
        <ul class="plot-list">
          @for (row of rows(); track row.id) {
            <li class="plot-card pending-card" [attr.data-tone]="row.failed ? 'bad' : 'review'">
              <span class="plot-card__thumb" aria-hidden="true">
                <span class="ic ic-cloud-up ic--lg"></span>
              </span>
              <div class="plot-card__body">
                <p class="plot-card__title">{{ row.title }}</p>
                <p class="plot-card__meta">
                  {{ row.failed ? t().offline.failedNote : t().offline.waitingNote }}
                </p>
                <div class="plot-card__row">
                  <span class="chip" [class.tone-bad]="row.failed" [class.tone-review]="!row.failed">
                    <span
                      class="ic"
                      [class.ic-alert]="row.failed"
                      [class.ic-offline]="!row.failed"
                      aria-hidden="true"
                    ></span>
                    <span>{{ row.failed ? t().offline.failed : t().offline.waiting }}</span>
                  </span>
                </div>
                <div class="pending-card__actions">
                  @if (!row.failed && queue.online()) {
                    <button
                      type="button"
                      class="btn btn-quiet pending-card__btn"
                      [id]="'send-' + row.id"
                      [disabled]="queue.syncing()"
                      (click)="queue.flush()"
                    >
                      {{ queue.syncing() ? t().offline.sending : t().offline.sendNow }}
                    </button>
                  }
                  <button
                    type="button"
                    class="btn-link btn-link--danger"
                    [id]="'remove-' + row.id"
                    (click)="queue.remove(row.id)"
                  >
                    {{ t().offline.remove }}
                  </button>
                </div>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class PendingList {
  /** 外勤替某位成员新建时是那位成员的 id；园主自己是 null。只显示属于当前这个人的 */
  readonly memberId = input<string | null>(null);

  protected readonly queue = inject(OfflineQueue);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly rows = computed(() =>
    this.queue
      .items()
      .filter((e) => e.memberId === this.memberId())
      .map((e) => {
        const ha = e.geometry.kind === 'polygon' ? e.geometry.areaHa : e.geometry.declaredHa;
        return {
          id: e.id,
          failed: e.state === 'failed',
          title: this.t().offline.card(e.pages.length, formatArea(ha, null)),
        };
      }),
  );
}
