import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { ApiError, ApiService } from '../../core/api/api.service';
import { BackNavigator } from '../../core/back-navigator';
import { FirestoreReader, type DocState } from '../../core/firebase/firestore-reader';
import { formatDay } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { docConfirmed, loadState$, type Load } from '../../core/load-state';
import { LangButton } from '../../shared/lang-button';
import { plotHeading, plotSubtitle } from '../plots/plot-title';
import type { PlotData, TitleData } from '../plots/plot-types';
import {
  bannerKey,
  checkedAt,
  concludedAssessment,
  forestNote,
  latestAssessment,
  openGaps,
  passedRules,
} from './assessment';
import { bannerLook } from './banner-look';
import { forestLine, gapView } from './gap-view';
import { pageState } from '../plots/plot-watch';
import { watchPlotAssessment } from './result-data';

/** 先列最多这么多件要做的事，其余收起（线框：先列最多 2–3 件） */
const VISIBLE_GAPS = 3;

// 屏 9「结果」（线框 docs/ui/screen-09.png）：先给结论，再列最多 2–3 件要做的事（每件一个按钮），
// 通过的检查默认折叠，森林初筛写明「只是初筛」。只读：不写 Firestore；唯一调后端的地方是「还没开始」时的「开始检查」。
// 事项的标题与说明按 gapCode 用词典生成，不显示评估文档里自带的说明文字（见 assessment.ts 的说明）。
@Component({
  selector: 'app-result-page',
  imports: [LangButton],
  templateUrl: './result-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  private readonly reader = inject(FirestoreReader);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly plotId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  private readonly data = watchPlotAssessment(this.plotId);
  protected readonly state = computed(() => pageState(this.data.plot(), [this.data.assessments()]));

  private readonly plot = computed<PlotData | null>(() => {
    const p = this.data.plot();
    return p?.kind === 'data' ? p.value.data : null;
  });

  // 头部的标题要 titles/{landTitleId} 里的 lotNo，规则与屏 2 卡片相同
  private readonly title = toSignal(
    toObservable(computed(() => this.plot()?.landTitleId ?? null)).pipe(
      switchMap((id) =>
        id ? loadState$(this.reader.doc$<TitleData>(`titles/${id}`), docConfirmed) : of(null),
      ),
    ),
    { initialValue: null as Load<DocState<TitleData>> | null },
  );

  protected readonly gapsExpanded = signal(false);
  protected readonly passedOpen = signal(false);

  protected readonly view = computed(() => {
    const plot = this.plot();
    const a = this.data.assessments();
    if (this.state() !== 'ready' || !plot || a?.kind !== 'data') return null;

    const t = this.t();
    const lang = this.i18n.lang();
    const latest = latestAssessment(a.value.docs)?.data ?? null;
    const key = bannerKey(latest);
    // 没有评估、还在检查、或失败：不列事项、不写通过项、不写评估日期和森林初筛
    const done = concludedAssessment(latest);
    const gaps = done ? openGaps(done) : [];

    const items = gaps.map((g) => {
      const v = gapView(t, lang, done!, g);
      return { key: g.key, title: v.title, detail: v.detail, button: v.button };
    });

    const checked = done ? checkedAt(done) : null;
    const checkedDay = checked ? formatDay(checked, lang) : null;
    const note = done ? forestNote(done) : null;
    const forest = note === null ? null : forestLine(t, note);
    const heading = plotHeading(t, plot, this.title());

    return {
      bannerKey: key,
      look: bannerLook(key),
      headline: t.result.banner[key].headline,
      sub: t.result.banner[key].sub(items.length),
      checkedOn: checkedDay ? t.result.checkedOn(checkedDay) : null,
      heading: heading.heading,
      loadingHeading: heading.loading,
      subtitle: plotSubtitle(t, plot, lang),
      items,
      total: items.length,
      passed: done ? passedRules(done) : [],
      forest,
      fromCache: this.fromCache(),
    };
  });

  protected readonly shown = computed(() => {
    const v = this.view();
    if (!v) return [];
    return this.gapsExpanded() ? v.items : v.items.slice(0, VISIBLE_GAPS);
  });

  protected readonly visibleLimit = VISIBLE_GAPS;

  /** 缓存里的数据：能显示，但要说明可能不是最新（缓存里的旧「通过」不能当成最新结论） */
  private fromCache(): boolean {
    const p = this.data.plot();
    const a = this.data.assessments();
    return (p?.kind === 'data' && p.fromCache) || (a?.kind === 'data' && a.fromCache);
  }

  // 返回屏 2 与进入屏 10 都保留当前的查询参数（外勤的 ?member）
  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  /** 有历史就后退（管理员从看板进来就回看板，筛选与选中的地块都在）；没有就回屏 2（保留 ?member） */
  protected back(): void {
    this.backNav.back(['/'], this.keep);
  }

  /** 「还没开始」的地块（建好了但没触发评估，例如屏 6 提交到一半失败后刷新了页面）：直接触发评估，去屏 7 */
  protected readonly starting = signal(false);
  protected readonly startFailed = signal(false);
  private readonly api = inject(ApiService);

  protected async startCheck(): Promise<void> {
    const id = this.plotId();
    if (!id || this.starting()) return;
    this.starting.set(true);
    this.startFailed.set(false);
    try {
      await this.api.assess(id);
    } catch (err) {
      // 已经有一次评估在跑（409）当作成功，屏 7 会接着显示它
      if (!(err instanceof ApiError && err.status === 409)) {
        this.startFailed.set(true);
        this.starting.set(false);
        return;
      }
    }
    this.starting.set(false);
    this.openChecking();
  }

  /** 评估还在跑：去屏 7 看分步进度 */
  protected openChecking(): void {
    const id = this.plotId();
    if (id) void this.router.navigate(['/plots', id, 'checking'], this.keep);
  }

  protected openIssue(key: string): void {
    const id = this.plotId();
    if (id) void this.router.navigate(['/plots', id, 'issue', key], this.keep);
  }

  protected retry(): void {
    this.data.retry();
  }
}
