import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackNavigator } from '../../core/back-navigator';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangButton } from '../../shared/lang-button';
import { DraftService, MAX_PAGES, type DocType } from './draft.service';
import { ImageProblem, compressFile, type ImageProblemKey } from './image';
import { submitErrorKey, type SubmitErrorKey } from './review-page';
import { SubmitService } from './submit.service';

// 屏 3「拍文件」（线框 docs/ui/screen-03.png）：地契、MSPO、MPOB 三张卡片。
// 每份文件可以有好几页（最多 4 张照片：地契常常正反两页）：每张卡片自己有「拍照」和「相册」两个按钮，
// 相册可以一次选多张，拍照拍完一张可以接着拍下一张；拍错的那一张点 ✕ 撤掉。
// 状态只存在本机内存里（DraftService），屏 6「开始检查」才交给后端。没有的文件可以跳过，之后由后端评估给出缺口清单，不会卡住。
@Component({
  selector: 'app-documents-page',
  imports: [LangButton],
  templateUrl: './documents-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsPage {
  private readonly draft = inject(DraftService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly submit = inject(SubmitService);
  private readonly backNav = inject(BackNavigator);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');
  protected readonly t = inject(I18nService).t;

  /** 已有地块补文件／换文件（路由 plots/:id/documents）；没有 id 就是新建地块流程的第 1 步 */
  protected readonly existingId = this.route.snapshot.paramMap.get('id');
  protected readonly sending = signal(false);
  protected readonly sendError = signal<SubmitErrorKey | null>(null);

  protected readonly entries = this.draft.entries;
  /** 新建：三份都拍了或跳过了；补文件：至少拍了一份（没有「跳过」） */
  protected readonly canContinue = computed(() =>
    this.existingId
      ? this.draft.entries().some((e) => e.doc.status === 'captured')
      : this.draft.allResolved(),
  );
  protected readonly maxPages = MAX_PAGES;

  /** 相册选图的提示键（非图片、太大、读不出、选多了） */
  protected readonly notice = signal<ImageProblemKey | 'tooMany' | null>(null);

  /** 点了哪张卡片的「相册」：选好的照片加到这份文件上 */
  private galleryTarget: DocType | null = null;

  // 返回／进入相邻页面时保留当前的查询参数（外勤替成员新建时带着 ?member）
  private readonly keep = { queryParamsHandling: 'preserve' } as const;

  /** 有历史就后退，没有就回屏 2（保留 ?member）；补文件时回这块地的结果页 */
  protected back(): void {
    this.backNav.back(this.existingId ? ['/plots', this.existingId] : ['/'], this.keep);
  }

  protected pagesOf(type: DocType) {
    return this.draft.pagesOf(type);
  }

  protected isFull(type: DocType): boolean {
    return this.draft.pagesOf(type).length >= MAX_PAGES;
  }

  /** 打开相机：拍到的照片加成这份文件的新一页 */
  protected open(type: DocType): void {
    if (this.isFull(type)) return;
    void this.router.navigate(['/plots/new/camera', type], this.keep);
  }

  protected removePage(type: DocType, index: number): void {
    this.notice.set(null);
    this.draft.removePage(type, index);
  }

  protected skip(type: DocType): void {
    this.draft.skip(type);
  }

  protected next(): void {
    if (!this.canContinue()) return;
    const id = this.existingId;
    if (id) void this.sendToPlot(id);
    else void this.router.navigate(['/plots/new/map'], this.keep);
  }

  /** 补文件：每一页传上去（同一份文件同一页由新的接替旧的），重新评估，去屏 7。失败留在这页，照片不丢 */
  private async sendToPlot(id: string): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    this.sendError.set(null);
    try {
      await this.submit.runDocuments(id, () => undefined);
      this.draft.reset();
      await this.router.navigate(['/plots', id, 'checking'], { ...this.keep, replaceUrl: true });
    } catch (err) {
      this.sendError.set(submitErrorKey(err));
    } finally {
      this.sending.set(false);
    }
  }

  protected openGallery(type: DocType): void {
    if (this.isFull(type)) return;
    this.galleryTarget = type;
    this.fileInput().nativeElement.click();
  }

  /** 从相册选了一张或多张：都加到点的那份文件上（来源 gallery），超过 4 页的不要，并说明 */
  protected async onGalleryPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // 允许连续两次选同一个文件
    const type = this.galleryTarget ?? this.draft.firstPending();
    this.galleryTarget = null;
    if (files.length === 0 || !type) return;
    this.notice.set(null);
    for (const file of files) {
      if (this.isFull(type)) {
        this.notice.set(this.notice() ?? 'tooMany');
        break;
      }
      try {
        this.draft.addPage(type, await compressFile(file), 'gallery');
      } catch (err) {
        this.notice.set(this.notice() ?? (err instanceof ImageProblem ? err.key : 'unreadable'));
      }
    }
  }
}
