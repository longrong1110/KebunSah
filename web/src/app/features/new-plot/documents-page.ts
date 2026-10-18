import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { BackNavigator } from '../../core/back-navigator';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { DraftService, PAGE2_KEY, type DocType } from './draft.service';
import { ImageProblem, compressFile, type ImageProblemKey } from './image';

// 屏 3「拍文件」（线框 docs/ui/screen-03.png）：地契、MSPO、MPOB 三张卡片，一次拍一份。
// 状态只存在本机内存里（DraftService）：照片上传和新建地块都要等合同定下接口。
// 没有的文件可以跳过，之后由后端评估给出缺口清单，不会卡住。
@Component({
  selector: 'app-documents-page',
  imports: [LangButton],
  templateUrl: './documents-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsPage {
  private readonly draft = inject(DraftService);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');
  protected readonly t = inject(I18nService).t;

  protected readonly entries = this.draft.entries;
  protected readonly canContinue = this.draft.allResolved;
  protected readonly firstPending = this.draft.firstPending;

  /** 地契第 2 页（可选）：地契拍好了才出现；不影响「下一步」 */
  protected readonly page2 = this.draft.page2;
  protected readonly titleTaken = computed(
    () => this.draft.doc('land_title').status === 'captured',
  );

  /** 相册选图失败时的提示键（非图片、太大、读不出） */
  protected readonly notice = signal<ImageProblemKey | null>(null);

  // 返回／进入相邻页面时保留当前的查询参数（外勤替成员新建时带着 ?member）
  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  /** 有历史就后退，没有就回屏 2（保留 ?member） */
  protected back(): void {
    this.backNav.back(['/'], this.keep);
  }

  protected open(type: DocType): void {
    void this.router.navigate(['/plots/new/camera', type], this.keep);
  }

  protected openPage2(): void {
    void this.router.navigate(['/plots/new/camera', PAGE2_KEY], this.keep);
  }

  protected removePage2(): void {
    this.draft.clear(PAGE2_KEY);
  }

  protected skip(type: DocType): void {
    this.draft.skip(type);
  }

  protected next(): void {
    if (this.canContinue()) void this.router.navigate(['/plots/new/map'], this.keep);
  }

  protected openGallery(): void {
    this.fileInput().nativeElement.click();
  }

  /** 「Atau pilih dari galeri」：对第一张待拍的文档选图，选好直接变已拍（来源 gallery） */
  protected async onGalleryPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // 允许连续两次选同一个文件
    const type = this.draft.firstPending();
    if (!file || !type) return;
    this.notice.set(null);
    try {
      this.draft.capture(type, await compressFile(file), 'gallery');
    } catch (err) {
      this.notice.set(err instanceof ImageProblem ? err.key : 'unreadable');
    }
  }
}
