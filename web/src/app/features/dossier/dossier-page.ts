import { DOCUMENT, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import type { DocState } from '../../core/firebase/firestore-reader';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Load } from '../../core/load-state';
import { LangButton } from '../../shared/lang-button';
import { buildDossier, SVG_HEIGHT, SVG_WIDTH } from './dossier';
import { dossierState, watchDossier } from './dossier-data';

const docOf = <T>(l: Load<DocState<T>> | null): T | null =>
  l?.kind === 'data' ? l.value.data : null;

// 档案页（导出 PDF）：一张 A4 排版的资料底稿，点「Cetak／Simpan sebagai PDF」用浏览器的打印功能存成 PDF。
// 只读：不写任何东西、不调后端。版面数据全部由 buildDossier 生成（隐私约束都在那里，见 dossier.ts）。
@Component({
  selector: 'app-dossier-page',
  imports: [LangButton],
  templateUrl: './dossier-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DossierPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly titleService = inject(Title);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly plotId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  private readonly data = watchDossier(this.plotId);

  protected readonly state = computed(() =>
    dossierState(this.data.plot(), [
      this.data.assessments(),
      this.data.documents(),
      this.data.title(),
      this.data.person(),
      this.data.mpob(),
      this.data.mspo(),
      this.data.coop(),
    ]),
  );

  /** 打开页面的时刻；档案上的「Dijana pada」用它，不随数据刷新而变 */
  private readonly generatedAt = new Date();

  protected readonly view = computed(() => {
    if (this.state() !== 'ready') return null;
    const plot = this.data.plot();
    const assessments = this.data.assessments();
    const documents = this.data.documents();
    if (plot?.kind !== 'data' || !plot.value.data) return null;
    if (assessments?.kind !== 'data' || documents?.kind !== 'data') return null;

    return buildDossier(this.t(), this.i18n.lang(), {
      plot: plot.value.data,
      title: docOf(this.data.title()),
      person: docOf(this.data.person()),
      coop: docOf(this.data.coop()),
      mpob: docOf(this.data.mpob()),
      mspo: docOf(this.data.mspo()),
      assessments: assessments.value.docs,
      documents: documents.value.docs.map((d) => d.data),
      generatedAt: this.generatedAt,
    });
  });

  /** 缓存里的数据：能显示，但要说明可能不是最新 */
  protected readonly fromCache = computed(() => {
    const sources = [this.data.plot(), this.data.assessments(), this.data.documents()];
    return sources.some((s) => s?.kind === 'data' && s.fromCache);
  });

  protected readonly svgWidth = SVG_WIDTH;
  protected readonly svgHeight = SVG_HEIGHT;

  constructor() {
    // Chrome 存成 PDF 时拿页面标题当文件名；离开页面还原
    const previous = this.titleService.getTitle();
    effect(() => {
      const v = this.view();
      if (v) this.titleService.setTitle(`KebunSah dossier — ${v.header.heading}`);
    });
    inject(DestroyRef).onDestroy(() => this.titleService.setTitle(previous));
  }

  protected print(): void {
    this.document.defaultView?.print();
  }

  /** 从看板点进来就回看板（选中的地块还在查询参数里）；直接打开的链接没有历史，回屏 2 */
  protected back(): void {
    const history = this.document.defaultView?.history;
    if (history && history.length > 1) this.location.back();
    else void this.router.navigate(['/']);
  }

  protected retry(): void {
    this.data.retry();
  }
}
