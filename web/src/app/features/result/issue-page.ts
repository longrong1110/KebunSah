import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { BackNavigator } from '../../core/back-navigator';
import { formatArea, formatDay } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import {
  areaCompare,
  checkedAt,
  concludedAssessment,
  formatDiff,
  latestAssessment,
  openGaps,
} from './assessment';
import { gapView } from './gap-view';
import { parseRing, toSvgPoints } from './polygon';
import { pageState } from '../plots/plot-watch';
import { watchPlotAssessment } from './result-data';

// 屏 10「问题详情」（线框 docs/ui/screen-10.png）：数字对照、可能原因、建议，不责怪用户。
// 只读，也还没有能「修复」的东西：重画需要屏 5 和保存多边形的接口，上传需要上传接口，都没有。
// 所以「Lukis semula」禁用并写明原因（不跳到新建地块的占位页，那会被当成新地块），
// 其余事项只给说明，不放会失败或没效果的按钮。
@Component({
  selector: 'app-issue-page',
  imports: [LangButton],
  templateUrl: './issue-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuePage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly plotId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  private readonly issueKey = toSignal(this.route.paramMap.pipe(map((p) => p.get('key'))), {
    initialValue: this.route.snapshot.paramMap.get('key'),
  });

  private readonly data = watchPlotAssessment(this.plotId);
  protected readonly state = computed(() => pageState(this.data.plot(), [this.data.assessments()]));

  /**
   * ready 时：找得到这个事项 → { found: true, ... }；找不到（已解决、没有评估、key 写错）→ { found: false }。
   * 数字对照取评估时的 CC-01 快照，所以标上评估日期。
   */
  protected readonly view = computed(() => {
    const p = this.data.plot();
    const a = this.data.assessments();
    if (this.state() !== 'ready' || p?.kind !== 'data' || a?.kind !== 'data') return null;

    const t = this.t();
    const lang = this.i18n.lang();
    const latest = latestAssessment(a.value.docs)?.data ?? null;
    const done = concludedAssessment(latest);
    const gap = done ? openGaps(done).find((g) => g.key === this.issueKey()) : undefined;
    if (!done || !gap) return { found: false as const };

    const text = gapView(t, lang, done, gap);

    const isArea = gap.known === 'area_mismatch';
    const compare = isArea ? areaCompare(done) : null;
    const geran = compare ? formatArea(compare.geran, null) : null;
    const lukisan = compare ? formatArea(compare.lukisan, null) : null;
    const ring = isArea ? parseRing(p.value.data?.polygonGeojson) : null;
    const checked = checkedAt(done);
    const day = checked ? formatDay(checked, lang) : null;

    return {
      found: true as const,
      title: text.title,
      detail: text.detail,
      cause: text.cause,
      advice: text.advice,
      // 两格对照只在两个数都读得出来时显示，否则只剩文字说明（不出现 NaN、0 或空的「ha」）
      compare: compare && geran && lukisan ? { geran, lukisan, diff: formatDiff(compare) } : null,
      points: ring ? toSvgPoints(ring) : null,
      checkedOn: day ? t.result.checkedOn(day) : null,
      isArea,
      // 「读不准」类：可以去屏 8 对着原件确认
      isLowConfidence: gap.known === 'low_confidence',
    };
  });

  protected readonly heading = computed(() => {
    const v = this.view();
    return v?.found ? v.title : this.t().result.title;
  });

  // 有历史就后退（回到屏 9）；没有就去 /plots/{id}，保留当前的查询参数（外勤的 ?member）
  protected back(): void {
    const id = this.plotId();
    if (id) this.backNav.back(['/plots', id], { queryParamsHandling: 'preserve' });
  }

  /** 屏 8：确认读不准的值 */
  protected openConfirm(): void {
    const id = this.plotId();
    if (id)
      void this.router.navigate(['/plots', id, 'confirm'], { queryParamsHandling: 'preserve' });
  }

  protected retry(): void {
    this.data.retry();
  }
}
