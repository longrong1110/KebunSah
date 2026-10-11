import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BackNavigator } from '../../core/back-navigator';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';

// 「Langkah 2：圈地块」的占位页。屏 5（Google Maps 画边界）是 10/10 的任务，这里先让流程走得通。
// 返回屏 3 时草稿（DraftService）还在，不丢。
@Component({
  selector: 'app-map-placeholder',
  imports: [LangButton],
  template: `
    <main class="screen">
      <header class="topbar">
        <button
          type="button"
          class="icon-btn"
          id="back"
          [attr.aria-label]="t().common.back"
          (click)="back()"
        >
          ←
        </button>
        <h1 class="topbar__title">{{ t().newPlot.title }}</h1>
        <app-lang-button />
      </header>
      <section class="content">
        <p id="map-soon" class="lead">{{ t().newPlot.mapSoon }}</p>
        <p class="hint">{{ t().newPlot.mapSoonHelp }}</p>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPlaceholder {
  private readonly backNav = inject(BackNavigator);
  protected readonly t = inject(I18nService).t;

  protected back(): void {
    this.backNav.back(['/plots/new'], { queryParamsHandling: 'preserve' });
  }
}
