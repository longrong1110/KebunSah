import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { fromEvent } from 'rxjs';
import { BackNavigator } from '../../core/back-navigator';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  CameraError,
  CameraService,
  type CameraErrorKey,
  type CameraHandle,
} from './camera.service';
import { DraftService, isDocType, type DocSource, type DocType } from './draft.service';
import { ImageProblem, compressFile, renderJpeg, type ImageProblemKey } from './image';

// 打开之前：opening；首帧到达：live；点了快门：processing；拍完/选完：preview；打不开：error
type View = 'opening' | 'live' | 'error' | 'processing' | 'preview';

// 屏 4「拍照取景」（线框 docs/ui/screen-04.png）：取景框＋一句提示，快门最大居中；顶部写明正在拍哪份文件。
// 拍完先预览，确认才算数（「Guna gambar」）；拍错可重拍（「Ambil semula」）。
// 摄像头与预览的 blob URL 在以下情况都会释放：点 ✕、浏览器返回、路由切走、切到后台、授权等待中就离开、轨道被系统结束。
@Component({
  selector: 'app-camera-page',
  templateUrl: './camera-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CameraPage {
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  private readonly route = inject(ActivatedRoute);
  private readonly draft = inject(DraftService);
  private readonly camera = inject(CameraService);
  private readonly doc = inject(DOCUMENT);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  protected readonly t = inject(I18nService).t;

  protected readonly docType = signal<DocType | null>(null);
  protected readonly docName = computed(() => {
    const type = this.docType();
    return type ? this.t().newPlot.docs[type] : '';
  });

  protected readonly view = signal<View>('opening');
  protected readonly cameraError = signal<CameraErrorKey>('other');
  /** 相册选图失败的提示（非图片、太大、读不出）：停在当前状态，不跳走 */
  protected readonly notice = signal<ImageProblemKey | null>(null);
  protected readonly torchSupported = signal(false);
  protected readonly torchOn = signal(false);
  protected readonly previewUrl = signal<string | null>(null);

  private readonly stream = signal<MediaStream | null>(null);
  private handle: CameraHandle | null = null;
  private previewBlob: Blob | null = null;
  private previewSource: DocSource = 'camera';
  private destroyed = false;
  /** 切到后台时被我们停掉的取景：回前台要自动恢复 */
  private resumeOnVisible = false;
  /** 每次 start 加一：晚到的、已经过期的 getUserMedia 结果要丢掉 */
  private startToken = 0;

  constructor() {
    const raw = this.route.snapshot.paramMap.get('doc');
    if (!isDocType(raw)) {
      // 非法的文档类型：回屏 3
      void this.router.navigate(['/plots/new'], {
        replaceUrl: true,
        queryParamsHandling: 'preserve',
      });
      return;
    }
    this.docType.set(raw);

    // <video> 在 @if／@switch 里，出现的时机不固定：srcObject 要命令式赋值
    effect(() => {
      const el = this.video()?.nativeElement;
      const stream = this.stream();
      if (el && stream && el.srcObject !== stream) {
        el.srcObject = stream;
        // 自动播放被拦就等用户点（iOS 要 playsinline + muted）；老浏览器的 play() 可能不返回 Promise
        void Promise.resolve(el.play?.()).catch(() => undefined);
      }
    });

    // 切到后台：关摄像头（灯不能一直亮）；回前台：自动恢复
    fromEvent(this.doc, 'visibilitychange')
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.doc.visibilityState === 'hidden') {
          if (this.view() === 'opening' || this.view() === 'live') {
            this.resumeOnVisible = true;
            this.stopCamera();
          }
        } else if (this.resumeOnVisible) {
          this.resumeOnVisible = false;
          void this.start();
        }
      });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.stopCamera(); // 同时作废还在等授权的 open()
      this.revokePreview();
    });

    void this.start();
  }

  /** 打开摄像头。授权等待不设超时（用户可能正在选择）。 */
  protected async start(): Promise<void> {
    this.stopCamera(); // 先停掉可能还开着的旧流，并作废上一次还在等的 open()
    const token = ++this.startToken;
    this.notice.set(null);
    this.view.set('opening');
    try {
      const handle = await this.camera.open();
      // 流先到、页面已经走了（或已重新开始）：立刻停掉，否则摄像头灯会一直亮
      if (this.destroyed || token !== this.startToken) {
        handle.stop();
        return;
      }
      this.handle = handle;
      this.torchSupported.set(handle.torchSupported);
      this.torchOn.set(false); // 每次新取景默认关闭
      handle.onEnded(() => {
        if (this.handle === handle) {
          this.stopCamera();
          this.fail('other'); // 被别的应用抢占、或摄像头被拔掉
        }
      });
      this.stream.set(handle.stream);
    } catch (err) {
      if (this.destroyed || token !== this.startToken) return;
      this.fail(err instanceof CameraError ? err.key : 'other');
    }
  }

  /** 首帧到达：取景可用，快门才能点 */
  protected onFrame(): void {
    if (this.view() === 'opening') this.view.set('live');
  }

  protected async shutter(): Promise<void> {
    if (this.view() !== 'live') return; // 处理中双击只产生一张
    const el = this.video()?.nativeElement;
    if (!el) return;
    this.view.set('processing');
    try {
      const blob = await renderJpeg(el, el.videoWidth, el.videoHeight);
      this.showPreview(blob, 'camera');
    } catch (err) {
      this.notice.set(err instanceof ImageProblem ? err.key : 'unreadable');
      this.view.set('live');
    }
  }

  /** 屏 4 内的相册入口：选好先进预览，不直接算数 */
  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.notice.set(null);
    try {
      this.showPreview(await compressFile(file), 'gallery');
    } catch (err) {
      this.notice.set(err instanceof ImageProblem ? err.key : 'unreadable');
    }
  }

  protected async toggleTorch(): Promise<void> {
    if (!this.handle) return;
    try {
      const next = !this.torchOn();
      await this.handle.setTorch(next);
      this.torchOn.set(next);
    } catch {
      // 点击出错：按钮消失，不崩
      this.torchSupported.set(false);
      this.torchOn.set(false);
    }
  }

  /** 「Guna gambar」：这份文档变已拍，回屏 3；走后退，历史里不留相邻两条 /plots/new，浏览器「返回」也不会又回到相机 */
  protected use(): void {
    const type = this.docType();
    if (!type || !this.previewBlob) return;
    this.draft.capture(type, this.previewBlob, this.previewSource);
    this.backNav.back(['/plots/new'], { queryParamsHandling: 'preserve' });
  }

  /** 「Ambil semula」：回到取景，旧预览释放 */
  protected retake(): void {
    this.revokePreview();
    void this.start();
  }

  /** 「✕」：回屏 3，卡片状态不变；走后退，浏览器「返回」不会又回到相机、再弹一次授权 */
  protected close(): void {
    this.backNav.back(['/plots/new'], { queryParamsHandling: 'preserve' });
  }

  protected openGallery(input: HTMLInputElement): void {
    input.click();
  }

  private showPreview(blob: Blob, source: DocSource): void {
    if (this.destroyed) return; // 拍照／压缩途中用户已离开：不能再造一个没人撤销的 blob URL
    this.revokePreview();
    this.stopCamera(); // 预览时不需要摄像头
    this.previewBlob = blob;
    this.previewSource = source;
    this.previewUrl.set(URL.createObjectURL(blob));
    this.view.set('preview');
  }

  private fail(key: CameraErrorKey): void {
    this.cameraError.set(key);
    this.view.set('error');
  }

  /** 停掉摄像头，并作废还在等授权的 open()：它晚到时在 start() 里发现 token 不符，会立刻把那路流停掉 */
  private stopCamera(): void {
    this.startToken++;
    this.handle?.stop();
    this.handle = null;
    this.stream.set(null);
    this.torchSupported.set(false);
    this.torchOn.set(false);
    const el = this.video()?.nativeElement;
    if (el) el.srcObject = null;
  }

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
    this.previewBlob = null;
  }
}
