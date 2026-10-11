import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BackNavigator } from '../../core/back-navigator';
import { formatArea } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { DOC_TYPES, DraftService } from './draft.service';

// 「Langkah 3：Semak」的占位页（屏 6 的壳）。屏 6 本体——总览、开始检查——要先有「新建地块、传照片、触发评估」的接口合同，
// 现在只把屏 5 圈出的结果与屏 3 的照片张数摆出来，让流程走得通。返回屏 5 时草稿还在，不丢。
@Component({
  selector: 'app-review-placeholder',
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

      <div
        class="progress"
        role="progressbar"
        aria-valuemin="1"
        aria-valuemax="3"
        aria-valuenow="3"
        [attr.aria-label]="t().newPlot.review.step"
      >
        <span class="progress__seg progress__seg--on"></span>
        <span class="progress__seg progress__seg--on"></span>
        <span class="progress__seg progress__seg--on"></span>
      </div>
      <p class="step-label">{{ t().newPlot.review.step }}</p>

      <section class="content content--tight">
        @if (summary(); as s) {
          <h2 class="review-title">{{ t().newPlot.review.summary }}</h2>
          <ul id="review-summary" class="review-list">
            <li id="review-method">{{ s.method }}</li>
            <li id="review-area">{{ s.area }}</li>
            @for (d of s.docs; track d.type) {
              <li>
                {{ d.name }} <span class="chip tone-idle">{{ d.status }}</span>
              </li>
            }
          </ul>
        } @else {
          <p id="review-none" class="lead">{{ t().newPlot.review.none }}</p>
          <button type="button" class="btn" id="to-map" (click)="toMap()">
            {{ t().newPlot.review.toMap }}
          </button>
        }
        <p id="review-soon" class="hint">{{ t().newPlot.review.soon }}</p>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPlaceholder {
  private readonly draft = inject(DraftService);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  protected readonly t = inject(I18nService).t;

  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  /** 屏 5 圈出的结果 + 三份文档各自的状态；草稿里没有可完成的几何时是 null */
  protected readonly summary = computed(() => {
    const g = this.draft.geometry();
    if (!g) return null;
    const r = this.t().newPlot.review;
    const n = this.t().newPlot;
    const ha = g.kind === 'polygon' ? g.areaHa : g.declaredHa;
    const text = formatArea(ha, null) ?? String(ha);
    return {
      method: r.method[g.kind === 'polygon' ? g.method : 'point'],
      area: g.kind === 'polygon' ? r.area(text) : r.declared(text),
      docs: DOC_TYPES.map((type) => {
        const status = this.draft.doc(type).status;
        return {
          type,
          name: n.docs[type],
          status: status === 'captured' ? n.taken : status === 'skipped' ? n.skipped : '—',
        };
      }),
    };
  });

  protected back(): void {
    this.backNav.back(['/plots/new/map'], this.keep);
  }

  protected toMap(): void {
    void this.router.navigate(['/plots/new/map'], this.keep);
  }
}
