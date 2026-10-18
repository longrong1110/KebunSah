import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { ApiError, ApiService } from '../../core/api/api.service';
import { BackNavigator } from '../../core/back-navigator';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { pageState, watchPlot } from '../plots/plot-watch';
import {
  editKey,
  groupByDocument,
  hasEmpty,
  toSubmit,
  unsureFields,
  type ConfirmDocument,
} from './confirm';

export type ConfirmErrorKey =
  'empty' | 'format' | 'network' | 'notConfigured' | 'unauthenticated' | 'forbidden' | 'generic';

export function confirmErrorKey(err: unknown): ConfirmErrorKey {
  if (!(err instanceof ApiError)) return 'generic';
  if (err.code === 'network') return 'network';
  if (err.code === 'not_configured') return 'notConfigured';
  if (err.code === 'unauthenticated' || err.code === 'invalid_token') return 'unauthenticated';
  if (err.code === 'forbidden') return 'forbidden';
  if (err.status === 400) return 'format'; // invalid_value／unknown_field：值的格式不对
  return 'generic';
}

type Photo = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'missing' };

// 屏 8「确认字段」：只列读不准、还没人确认的字段（置信度 < 0.7），输入框里是读出的值，用户对着原件改对或直接确认。
// 提交后后端把这些值记成「用户确认的」（优先于读出的值），再重新评估，跳到屏 7。读得准的字段不打扰用户。
@Component({
  selector: 'app-confirm-page',
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
          ←
        </button>
        <h1 class="topbar__title">{{ t().confirm.title }}</h1>
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
            @if (groups().length === 0) {
              <p id="confirm-none" class="lead">{{ t().confirm.none }}</p>
              <p class="hint">{{ t().confirm.noneHelp }}</p>
            } @else {
              <p id="confirm-lead" class="lead">{{ t().confirm.lead }}</p>
              @for (g of groups(); track g.documentId) {
                <section class="confirm-doc" [attr.data-doc]="g.documentId">
                  <h2 class="section-title">{{ docName(g) }}</h2>
                  <button
                    type="button"
                    class="btn-link confirm-doc__photo-btn"
                    [id]="'photo-toggle-' + g.documentId"
                    [attr.aria-expanded]="photos()[g.documentId] !== undefined"
                    (click)="togglePhoto(g.documentId, docName(g))"
                  >
                    {{ photos()[g.documentId] ? t().confirm.hidePhoto : t().confirm.showPhoto }}
                  </button>
                  @if (photos()[g.documentId]; as p) {
                    @switch (p.status) {
                      @case ('loading') {
                        <p class="hint" aria-live="polite">{{ t().confirm.loadingPhoto }}</p>
                      }
                      @case ('missing') {
                        <p class="hint" [id]="'photo-missing-' + g.documentId">
                          {{ t().confirm.photoMissing }}
                        </p>
                      }
                      @case ('ready') {
                        <img
                          class="confirm-doc__photo"
                          [id]="'photo-' + g.documentId"
                          [src]="p.url"
                          [alt]="t().confirm.photoAlt(docName(g))"
                        />
                      }
                    }
                  }
                  @for (f of g.fields; track f.key) {
                    <div class="confirm-field">
                      <label [for]="inputId(f)">{{ t().confirm.field(f.key) }}</label>
                      <input
                        class="field"
                        type="text"
                        autocomplete="off"
                        [id]="inputId(f)"
                        [attr.inputmode]="f.kind === 'area' ? 'decimal' : null"
                        [attr.aria-describedby]="inputId(f) + '-hint'"
                        [attr.aria-invalid]="
                          error() === 'empty' && valueOf(f).trim() === '' ? 'true' : null
                        "
                        [value]="valueOf(f)"
                        (input)="onInput(f, $event)"
                      />
                      <p class="hint" [id]="inputId(f) + '-hint'">
                        @if (f.rawText) {
                          {{ t().confirm.weRead(f.rawText) }}
                        } @else {
                          {{ t().confirm.cantRead }}
                        }
                        {{ t().confirm.hint[f.kind] }}
                      </p>
                    </div>
                  }
                </section>
              }
              <p class="hint" id="confirm-recheck-note">{{ t().confirm.recheckNote }}</p>
            }

            @if (errorText(); as text) {
              <p id="confirm-error" class="error" role="alert">
                <span aria-hidden="true">⚠</span> {{ text }}
              </p>
            }
          }
        }
      </section>

      @if (state() === 'ready') {
        <footer class="bar">
          <button
            type="button"
            class="btn"
            id="confirm-save"
            [disabled]="busy()"
            [attr.aria-busy]="busy()"
            (click)="save()"
          >
            {{
              busy()
                ? t().confirm.saving
                : groups().length === 0
                  ? t().confirm.recheck
                  : t().confirm.save
            }}
          </button>
          <button
            type="button"
            class="btn btn-quiet"
            id="confirm-back"
            [disabled]="busy()"
            (click)="back()"
          >
            {{ t().confirm.back }}
          </button>
        </footer>
      }
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  private readonly api = inject(ApiService);
  protected readonly t = inject(I18nService).t;

  protected readonly plotId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  private readonly w = watchPlot(this.plotId);
  private readonly documents = this.w.subcollection<ConfirmDocument>('documents');
  protected readonly data = { retry: this.w.retry };
  protected readonly state = computed(() => pageState(this.w.plot(), [this.documents()]));

  protected readonly groups = computed(() => {
    const d = this.documents();
    return d?.kind === 'data' ? groupByDocument(unsureFields(d.value.docs)) : [];
  });

  /** 用户改过的值（键 = 文件 id | 字段键）；没改的用读出的值 */
  private readonly edits = signal<Record<string, string>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal<ConfirmErrorKey | null>(null);
  protected readonly errorText = computed(() => {
    const k = this.error();
    return k ? this.t().confirm.errors[k] : null;
  });
  protected readonly photos = signal<Record<string, Photo>>({});

  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  protected docName(g: { docType: string; pageNo: number }): string {
    return this.t().confirm.docName(g.docType, g.pageNo);
  }

  protected inputId(f: { documentId: string; key: string }): string {
    return `field-${f.documentId}-${f.key.replace(/[^a-z0-9_]/gi, '-')}`;
  }

  protected valueOf(f: { documentId: string; key: string; value: string }): string {
    return this.edits()[editKey(f)] ?? f.value;
  }

  protected onInput(f: { documentId: string; key: string }, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.edits.update((e) => ({ ...e, [editKey(f)]: value }));
    if (this.error() === 'empty') this.error.set(null);
  }

  /** 看原件：取 15 分钟有效的读取网址；照片没传上来（种子里的文件）就说明没有 */
  protected async togglePhoto(documentId: string, _name: string): Promise<void> {
    if (this.photos()[documentId]) {
      this.photos.update(({ [documentId]: _gone, ...rest }) => rest);
      return;
    }
    this.photos.update((p) => ({ ...p, [documentId]: { status: 'loading' } }));
    try {
      const { url } = await this.api.documentImage(documentId);
      this.photos.update((p) =>
        p[documentId] ? { ...p, [documentId]: { status: 'ready', url } } : p,
      );
    } catch {
      this.photos.update((p) =>
        p[documentId] ? { ...p, [documentId]: { status: 'missing' } } : p,
      );
    }
  }

  /** 把这些值记成「用户确认的」，再重新评估，去屏 7。没有要确认的字段时，只是重新评估 */
  protected async save(): Promise<void> {
    const plotId = this.plotId();
    if (this.busy() || !plotId) return;
    const payload = toSubmit(this.groups(), this.edits());
    if (hasEmpty(payload)) {
      this.error.set('empty');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      for (const [documentId, fields] of Object.entries(payload)) {
        await this.api.confirmFields(documentId, fields);
      }
      try {
        await this.api.assess(plotId);
      } catch (err) {
        // 已经有一次评估在跑（409）：当作成功，屏 7 会接着显示它
        if (!(err instanceof ApiError && err.status === 409)) throw err;
      }
      await this.router.navigate(['/plots', plotId, 'checking'], {
        ...this.keep,
        replaceUrl: true,
      });
    } catch (err) {
      this.error.set(confirmErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected back(): void {
    const id = this.plotId();
    this.backNav.back(id ? ['/plots', id] : ['/'], this.keep);
  }
}
