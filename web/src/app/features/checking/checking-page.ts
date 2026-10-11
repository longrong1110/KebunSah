import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { dossierState } from '../dossier/dossier-data';
import { buildChecking } from './checking';
import { watchChecking } from './checking-data';

// 屏 7「评估中」（线框 docs/ui/screen-07.png）：转圈＋四步清单，说明大约 2 分钟、可以离开。
// 只读：不写任何东西，也不调后端。评估是实时订阅，queued → running → done 页面自己变。
// 步骤的进度只用真实信号推（见 checking.ts），失败不显示错误信息，当前那一步标「需人工复核」。
@Component({
  selector: 'app-checking-page',
  imports: [LangButton],
  templateUrl: './checking-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckingPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly plotId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  private readonly data = watchChecking(this.plotId);

  protected readonly state = computed(() =>
    dossierState(this.data.plot(), [this.data.assessments(), this.data.documents()]),
  );

  protected readonly view = computed(() => {
    if (this.state() !== 'ready') return null;
    const assessments = this.data.assessments();
    const documents = this.data.documents();
    if (assessments?.kind !== 'data' || documents?.kind !== 'data') return null;
    return buildChecking(this.t(), {
      assessments: assessments.value.docs,
      documents: documents.value.docs.map((d) => d.data),
    });
  });

  /** 缓存里的数据：能显示，但要说明可能不是最新（缓存里的「检查中」可能早已结束） */
  protected readonly fromCache = computed(() =>
    [this.data.plot(), this.data.assessments(), this.data.documents()].some(
      (s) => s?.kind === 'data' && s.fromCache,
    ),
  );

  // 去屏 2 与屏 9 都保留当前的查询参数（外勤的 ?member）
  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  /** 「Kembali ke Tanah saya」固定去屏 2（不是历史后退：线框里这个按钮的去处是明确的） */
  protected backToPlots(): void {
    void this.router.navigate(['/'], this.keep);
  }

  protected seeResult(): void {
    const id = this.plotId();
    // 进度页只是过渡页：替换历史，屏 9 的 ← 不会退回已经完成的进度页
    if (id) void this.router.navigate(['/plots', id], { ...this.keep, replaceUrl: true });
  }

  protected retry(): void {
    this.data.retry();
  }
}
