import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '../../core/api/api.service';
import { BackNavigator } from '../../core/back-navigator';
import { formatArea } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { OfflineQueue } from '../offline/offline-queue';
import { DOC_TYPES, DraftService } from './draft.service';
import { SubmitService, type SubmitProgress } from './submit.service';

/** 界面文案的键：把 ApiError 的各种码归成几类，每类一句"发生了什么＋下一步" */
export type SubmitErrorKey =
  'network' | 'notConfigured' | 'unauthenticated' | 'forbidden' | 'geometry' | 'generic';

export function submitErrorKey(err: unknown): SubmitErrorKey {
  const code = err instanceof ApiError ? err.code : '';
  if (code === 'network') return 'network';
  if (code === 'not_configured') return 'notConfigured';
  if (code === 'unauthenticated' || code === 'invalid_token') return 'unauthenticated';
  if (code === 'forbidden') return 'forbidden';
  if (
    [
      'geometry_invalid',
      'geometry_missing',
      'point_area_too_large',
      'point_area_invalid',
      'no_geometry',
    ].includes(code)
  )
    return 'geometry';
  return 'generic';
}

// 屏 6「Semak」：总览（圈出的地块＋三份文档的状态）和「开始检查」。
// 点了之后依次建地块、存位置、传照片、触发评估（SubmitService），成功就去屏 7；失败留在这页，草稿不丢，可以重试。
@Component({
  selector: 'app-review-page',
  imports: [LangButton],
  template: `
    <main class="screen">
      <header class="topbar">
        <button
          type="button"
          class="icon-btn"
          id="back"
          [attr.aria-label]="t().common.back"
          [disabled]="busy()"
          (click)="back()"
        >
          <span class="ic ic-back" aria-hidden="true"></span>
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
        @if (queued()) {
          <div id="review-queued" class="queued" role="status">
            <span class="ic ic-cloud-up ic--xl" aria-hidden="true"></span>
            <h2 class="review-title">{{ t().offline.savedTitle }}</h2>
            <p>{{ t().offline.savedBody }}</p>
            <button type="button" class="btn" id="back-to-list" (click)="toList()">
              {{ t().offline.backToList }}
            </button>
          </div>
        } @else if (summary(); as s) {
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

          <p id="review-working" class="lead" role="status" aria-live="polite">
            @if (progressText(); as text) {
              {{ text }}
            }
          </p>
          @if (errorText(); as text) {
            <p id="review-error" class="error" role="alert">{{ text }}</p>
          }

          <button
            type="button"
            class="btn"
            id="start"
            [disabled]="busy()"
            [attr.aria-busy]="busy()"
            (click)="start()"
          >
            {{ error() ? t().newPlot.review.retry : t().newPlot.review.start }}
          </button>
          <p id="review-hint" class="hint">{{ t().newPlot.review.hint }}</p>
        } @else {
          <p id="review-none" class="lead">{{ t().newPlot.review.none }}</p>
          <button type="button" class="btn" id="to-map" (click)="toMap()">
            {{ t().newPlot.review.toMap }}
          </button>
        }
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPage {
  private readonly draft = inject(DraftService);
  private readonly submit = inject(SubmitService);
  private readonly queue = inject(OfflineQueue);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  protected readonly t = inject(I18nService).t;

  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  protected readonly busy = signal(false);
  /** 没信号：整份草稿已经存进手机，等有网自动送出（这页改成说明这件事） */
  protected readonly queued = signal(false);
  private readonly progress = signal<SubmitProgress | null>(null);
  protected readonly error = signal<SubmitErrorKey | null>(null);

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
        const doc = this.draft.doc(type);
        return {
          type: type as string,
          name: n.docs[type],
          // 拍了几张照片也写出来（一份文件可以有好几页）
          status:
            doc.status === 'captured'
              ? n.photoCount(doc.pages.length)
              : doc.status === 'skipped'
                ? n.skipped
                : '—',
        };
      }),
    };
  });

  protected readonly progressText = computed(() => {
    const p = this.progress();
    if (!p || !this.busy()) return null;
    const steps = this.t().newPlot.review.steps;
    return p.step === 'docs' ? steps.docs(p.done, p.total) : steps[p.step];
  });

  protected readonly errorText = computed(() => {
    const key = this.error();
    return key ? this.t().newPlot.review.errors[key] : null;
  });

  protected async start(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // 浏览器明说没网：不白白试一次，直接存进手机
      if (!this.queue.online()) {
        await this.saveForLater();
        return;
      }
      const plotId = await this.submit.run((p) => this.progress.set(p));
      // 先跳走再清草稿：清草稿会撤销照片的预览地址，屏 7 不需要它们
      await this.router.navigate(['/plots', plotId, 'checking']);
      this.draft.reset();
    } catch (err) {
      // 请求中途断网：已建好的地块、已传好的照片记在草稿里，存进手机后接着送，不重复
      if (err instanceof ApiError && err.code === 'network') await this.saveForLater();
      else this.error.set(submitErrorKey(err));
    } finally {
      this.busy.set(false);
      this.progress.set(null);
    }
  }

  private async saveForLater(): Promise<void> {
    const snapshot = this.draft.snapshot();
    if (!snapshot) return;
    await this.queue.enqueue(snapshot);
    this.draft.reset();
    this.queued.set(true);
  }

  /** 存好之后回地块列表（那里最上面能看到「Menunggu dihantar」） */
  protected toList(): void {
    void this.router.navigate(['/'], this.keep);
  }

  protected back(): void {
    this.backNav.back(['/plots/new/map'], this.keep);
  }

  protected toMap(): void {
    void this.router.navigate(['/plots/new/map'], this.keep);
  }
}
