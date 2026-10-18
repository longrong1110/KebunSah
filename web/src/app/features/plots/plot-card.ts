import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { FirestoreReader, type DocState } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import { docConfirmed, loadState$, type Load } from '../../core/load-state';
import { statusOf } from '../../core/plot-status';
import { parseRing, toSvgPoints } from '../result/polygon';
import { plotHeading, plotSubtitle } from './plot-title';
import type { PlotItem, TitleData } from './plot-types';

// 一块地的卡片（线框屏 2）：标题 Lot {lotNo}, {district}、「面积 · 日期」、状态三件套。整张卡片是链接，点进屏 9（结果）。
// 标题里的 lotNo 在 titles/{landTitleId} 里：每张卡片自己订阅一次，随卡片销毁取消（成员切换、离开页面时不残留监听）。
@Component({
  selector: 'app-plot-card',
  imports: [RouterLink],
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
    const { heading, loading } = plotHeading(t, p, this.title());
    const ring = parseRing(p.polygonGeojson);
    return {
      heading,
      loading,
      subtitle: plotSubtitle(t, p, this.i18n.lang()),
      thumb: ring ? toSvgPoints(ring, 56, 56, 7) : null,
      status,
      statusLabel: t.status[status.key],
    };
  });
}
