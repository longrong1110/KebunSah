import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { BackNavigator } from '../../core/back-navigator';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { pageState } from '../plots/plot-watch';
import { latestAssessment } from '../result/assessment';
import { watchPlotAssessment } from '../result/result-data';
import { logFacts, logRows, type StepStatus } from './log';

const LOOK: Record<StepStatus, { tone: 'ok' | 'warn' | 'bad'; icon: string }> = {
  ok: { tone: 'ok', icon: '✓' },
  degraded: { tone: 'warn', icon: '⚠' },
  failed: { tone: 'bad', icon: '✕' },
};

// 「智能体日志」：这块地最近一次检查，系统每一步做了什么（读证件、核对规则、查森林、写建议）、用了哪个模型、花了多久。
// 数据就是后端写进评估文档的 steps[]，评估还在跑时一步一步出现（Firestore 实时订阅）。只读，状态不只靠颜色（图标＋文字）。
@Component({
  selector: 'app-log-page',
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
        <h1 class="topbar__title">{{ t().log.title }}</h1>
        <app-lang-button />
      </header>

      <section class="content content--tight">
        @switch (state()) {
          @case ('loading') {
            <div id="loading" aria-live="polite">
              <span class="skeleton skeleton-card" aria-hidden="true"></span>
              <p class="hint">{{ t().common.loading }}</p>
            </div>
          }
          @case ('offline') {
            <p id="offline" class="error" role="alert">
              <span aria-hidden="true">⚠</span> {{ t().plots.offline }}
            </p>
            <button type="button" class="btn" id="retry" (click)="data.retry()">
              {{ t().common.retry }}
            </button>
          }
          @case ('error') {
            <p id="error" class="error" role="alert">
              <span aria-hidden="true">⚠</span> {{ t().plots.error }}
            </p>
            <button type="button" class="btn" id="retry" (click)="data.retry()">
              {{ t().common.retry }}
            </button>
          }
          @case ('notfound') {
            <p id="not-found" class="lead">{{ t().result.notFound }}</p>
          }
          @case ('ready') {
            @if (view(); as v) {
              <p id="log-lead" class="lead">{{ t().log.lead }}</p>
              @if (v.rows.length === 0) {
                <p id="log-none" class="hint">{{ v.running ? t().log.running : t().log.none }}</p>
              } @else {
                @if (v.running) {
                  <p id="log-running" class="hint" aria-live="polite">{{ t().log.running }}</p>
                }
                <ol id="log-list" class="log-list">
                  @for (r of v.rows; track $index) {
                    <li class="log-row" [attr.data-step]="r.step">
                      <div class="log-row__head">
                        <strong class="log-row__name">{{
                          r.known ? t().log.steps[r.known] : r.step
                        }}</strong>
                        <span [class]="'chip tone-' + r.tone">
                          <span aria-hidden="true">{{ r.icon }}</span>
                          <span>{{ t().log.status[r.status] }}</span>
                        </span>
                        @if (r.ms !== null) {
                          <span class="hint log-row__ms">{{ t().log.ms(r.ms) }}</span>
                        }
                      </div>
                      @if (r.detail) {
                        <p class="log-row__detail">{{ r.detail }}</p>
                      }
                    </li>
                  }
                </ol>
              }
              @if (v.hasFacts) {
                <section class="issue-section" id="log-facts">
                  <h2 class="section-title">{{ t().log.facts.title }}</h2>
                  <dl class="log-facts">
                    @if (v.facts.readers.length > 0) {
                      <dt>{{ t().log.facts.reader }}</dt>
                      <dd id="fact-reader">{{ v.facts.readers.join(', ') }}</dd>
                    }
                    @if (v.writer) {
                      <dt>{{ t().log.facts.writer }}</dt>
                      <dd id="fact-writer">{{ v.writer }}</dd>
                    }
                    @if (v.facts.forestDataset) {
                      <dt>{{ t().log.facts.forest }}</dt>
                      <dd id="fact-forest">{{ v.facts.forestDataset }}</dd>
                    }
                    @if (v.facts.rulesVersion) {
                      <dt>{{ t().log.facts.rules }}</dt>
                      <dd id="fact-rules">{{ v.facts.rulesVersion }}</dd>
                    }
                    @if (v.seconds !== null) {
                      <dt>{{ t().log.facts.total }}</dt>
                      <dd id="fact-total">{{ t().log.ms(v.seconds * 1000) }}</dd>
                    }
                  </dl>
                </section>
              }
            }
          }
        }
      </section>

      <footer class="bar">
        <button type="button" class="btn btn-quiet" id="back-to-result" (click)="toResult()">
          {{ t().log.back }}
        </button>
      </footer>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  protected readonly t = inject(I18nService).t;

  protected readonly plotId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  protected readonly data = watchPlotAssessment(this.plotId);
  protected readonly state = computed(() => pageState(this.data.plot(), [this.data.assessments()]));

  protected readonly view = computed(() => {
    const a = this.data.assessments();
    if (this.state() !== 'ready' || a?.kind !== 'data') return null;
    const latest = latestAssessment(a.value.docs)?.data ?? null;
    const facts = logFacts(latest);
    const start = latest?.startedAt instanceof Date ? latest.startedAt.getTime() : null;
    const end = latest?.finishedAt instanceof Date ? latest.finishedAt.getTime() : null;
    const seconds =
      start !== null && end !== null && end >= start ? Math.round((end - start) / 100) / 10 : null;
    return {
      rows: logRows(latest).map((r) => ({ ...r, ...LOOK[r.status] })),
      running: latest?.runStatus === 'queued' || latest?.runStatus === 'running',
      facts,
      writer: facts.writer === 'template' ? this.t().log.facts.template : facts.writer,
      seconds,
      hasFacts:
        facts.readers.length > 0 ||
        facts.writer !== null ||
        facts.forestDataset !== null ||
        facts.rulesVersion !== null ||
        seconds !== null,
    };
  });

  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  /** 有历史就后退（从结果页或进度页来的就回那里）；没有就去这块地的结果页 */
  protected back(): void {
    const id = this.plotId();
    this.backNav.back(id ? ['/plots', id] : ['/'], this.keep);
  }

  protected toResult(): void {
    const id = this.plotId();
    void this.router.navigate(id ? ['/plots', id] : ['/'], this.keep);
  }
}
