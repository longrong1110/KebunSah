import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { FirestoreReader, type DocState } from '../../core/firebase/firestore-reader';
import { formatDay } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { docConfirmed, loadState$, type Load } from '../../core/load-state';
import { statusOf } from '../../core/plot-status';
import { LangButton } from '../../shared/lang-button';
import { plotHeading, plotSubtitle } from '../plots/plot-title';
import type { PlotData, TitleData } from '../plots/plot-types';
import {
  bannerKey,
  checkedAt,
  concludedAssessment,
  forestNote,
  gapFacts,
  latestAssessment,
  openGaps,
  passedRules,
  type BannerKey,
} from './assessment';
import { pageState, watchPlotAssessment } from './result-data';

/** 先列最多这么多件要做的事，其余收起（线框：先列最多 2–3 件） */
const VISIBLE_GAPS = 3;

// 横幅的图标与色调：四种结论沿用 statusOf（颜色＋图标＋文字三件套）；「还在检查」是线框外的状态，用中性色
const BANNER_LOOK: Record<BannerKey, { icon: string; tone: string }> = {
  green: pick('green'),
  yellow: pick('yellow'),
  red: pick('red'),
  needs_review: pick('needs_review'),
  pending: pick('pending'),
  running: { icon: '…', tone: 'idle' },
};
function pick(value: string) {
  const s = statusOf(value);
  return { icon: s.icon, tone: s.tone };
}

// 屏 9「结果」（线框 docs/ui/screen-09.png）：先给结论，再列最多 2–3 件要做的事（每件一个按钮），
// 通过的检查默认折叠，森林初筛写明「只是初筛」。只读：不写任何东西，也不调后端。
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
  private readonly reader = inject(FirestoreReader);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly plotId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  private readonly data = watchPlotAssessment(this.plotId);
  protected readonly state = computed(() => pageState(this.data.plot(), this.data.assessments()));

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
      const text = g.known ? t.result.gapText[g.known] : t.result.gapUnknown;
      const ctx = {
        doc: t.result.docName(g.docType),
        docType: g.docType,
        facts: done
          ? gapFacts(done, g, lang)
          : { geran: null, lukisan: null, days: null, date: null },
      };
      return { key: g.key, title: text.title(ctx), detail: text.detail(ctx), button: text.button };
    });

    const checked = done ? checkedAt(done) : null;
    const checkedDay = checked ? formatDay(checked, lang) : null;
    const note = done ? forestNote(done) : null;
    const forest =
      note === null
        ? null
        : note.kind === 'low'
          ? t.result.forest.low
          : note.kind === 'loss'
            ? t.result.forest.loss(note.ha)
            : t.result.forest.unknown;
    const heading = plotHeading(t, plot, this.title());

    return {
      bannerKey: key,
      look: BANNER_LOOK[key],
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

  protected back(): void {
    void this.router.navigate(['/'], this.keep);
  }

  protected openIssue(key: string): void {
    const id = this.plotId();
    if (id) void this.router.navigate(['/plots', id, 'issue', key], this.keep);
  }

  protected retry(): void {
    this.data.retry();
  }
}
