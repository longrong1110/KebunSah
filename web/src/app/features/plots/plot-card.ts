import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { FirestoreReader, type DocState } from '../../core/firebase/firestore-reader';
import { formatArea, formatDay } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { docConfirmed, loadState$, type Load } from '../../core/load-state';
import { statusOf } from '../../core/plot-status';
import type { PlotItem, TitleData } from './plot-types';

// 一块地的卡片（线框屏 2）：标题 Lot {lotNo}, {district}、「面积 · 日期」、状态三件套。
// 标题里的 lotNo 在 titles/{landTitleId} 里：每张卡片自己订阅一次，随卡片销毁取消（成员切换、离开页面时不残留监听）。
@Component({
  selector: 'app-plot-card',
  templateUrl: './plot-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlotCard {
  readonly plot = input.required<PlotItem>();

  private readonly reader = inject(FirestoreReader);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  private readonly landTitleId = computed(() => this.plot().data.landTitleId ?? null);

  private readonly title = toSignal(
    toObservable(this.landTitleId).pipe(
      switchMap((id) =>
        id ? loadState$(this.reader.doc$<TitleData>(`titles/${id}`), docConfirmed) : of(null),
      ),
    ),
    { initialValue: null as Load<DocState<TitleData>> | null },
  );

  protected readonly view = computed(() => {
    const t = this.t();
    const p = this.plot().data;
    const status = statusOf(p.status);
    const title = this.title();
    const fallback = [p.titleNo ?? p.nickname, p.district].filter(Boolean).join(', ');

    // 标题：没有地契 → Lot baharu；title 读到了 → Lot {lotNo}, {district}；
    // title 确认不存在或迟迟读不到 → 退回 plots 上复制的 titleNo / nickname + district，不冒充「Lot baharu」；
    // 还在读 → 骨架。
    let heading: string | null;
    let loading = false;
    if (!this.landTitleId()) {
      heading = t.plots.newLot;
    } else if (title?.kind === 'data' && title.value.data?.lotNo) {
      heading = t.plots.lot(title.value.data.lotNo, title.value.data.district ?? p.district ?? '');
    } else if (title && title.kind !== 'loading') {
      heading = fallback || t.plots.notFilled;
    } else {
      heading = null;
      loading = true;
    }

    const area = formatArea(p.areaHaComputed, p.areaHaDeclared);
    const day = formatDay(p.lastAssessedAt, this.i18n.lang());
    const subtitle = [area ? t.plots.areaHa(area) : t.plots.notFilled, day]
      .filter(Boolean)
      .join(' · ');

    return { heading, loading, subtitle, status, statusLabel: t.status[status.key] };
  });
}
