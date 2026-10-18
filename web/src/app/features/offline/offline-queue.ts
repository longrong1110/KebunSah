import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { ApiError } from '../../core/api/api.service';
import { SubmitService } from '../new-plot/submit.service';
import { PENDING_STORE } from './pending-store';
import { isRetryable, type PendingPlot, type PendingSnapshot } from './pending-plot';

const RETRY_EVERY_MS = 60_000;

// 没信号时「开始检查」把整份草稿存在手机里，有信号了自动送出去（按存的先后一份一份送）。
// 什么时候送：页面启动、浏览器报告「又有网了」、以及每分钟看一次。同一时间只送一份队列，不会重复送。
// 送的过程中每一步都记下来（后端地块是否建好、哪些页传好了），中途又断网也不会重复建地块、重复传照片。
// 断网、没登录、服务端暂时不可用都算「以后再试」；后端明确拒绝（数据本身有问题）才标「失败」，等用户处理。
@Injectable({ providedIn: 'root' })
export class OfflineQueue {
  private readonly store = inject(PENDING_STORE);
  private readonly submit = inject(SubmitService);
  private readonly doc = inject(DOCUMENT);

  /** 手机现在有没有网（浏览器的判断；「连着 Wi-Fi 但没网」它看不出来，那种情况靠请求失败来发现） */
  readonly online = signal(true);
  /** 手机里等着送的草稿，最早的在前 */
  readonly items = signal<readonly PendingPlot[]>([]);
  readonly syncing = signal(false);
  /** 刚刚送出去的那块地的 id：横幅用它告诉用户「已送出，正在检查」，点掉后清空 */
  readonly sent = signal<string | null>(null);

  private started = false;
  private flushing = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    const win = this.doc.defaultView;
    this.online.set(win?.navigator.onLine !== false);
    win?.addEventListener('online', () => {
      this.online.set(true);
      void this.flush();
    });
    win?.addEventListener('offline', () => this.online.set(false));
    win?.setInterval(() => void this.flush(), RETRY_EVERY_MS);
    void this.refresh().then(() => this.flush());
  }

  async refresh(): Promise<void> {
    this.items.set(await this.store.list());
  }

  /** 存一份草稿等着送；存好就尝试送一次（有网的话马上送） */
  async enqueue(snapshot: PendingSnapshot): Promise<void> {
    await this.store.put({
      ...snapshot,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      state: 'waiting',
      errorCode: null,
    });
    await this.refresh();
    void this.flush();
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    await this.refresh();
  }

  dismissSent(): void {
    this.sent.set(null);
  }

  /** 把等着的草稿一份一份送出去。已经在送、或者没网时什么都不做 */
  async flush(): Promise<void> {
    if (this.flushing || !this.online()) return;
    this.flushing = true;
    this.syncing.set(true);
    try {
      for (const entry of await this.store.list()) {
        if (entry.state === 'failed') continue;
        try {
          const plotId = await this.submit.runPending(entry, (patch) => this.patch(entry.id, patch));
          await this.store.remove(entry.id);
          this.sent.set(plotId);
        } catch (err) {
          if (isRetryable(err)) {
            break; // 这一份还没送完（断网、没登录、服务端暂时不可用）：后面的也不用试了，等下次
          }
          await this.patch(entry.id, {
            state: 'failed',
            errorCode: err instanceof ApiError ? err.code : 'unknown',
          });
        }
      }
    } finally {
      this.flushing = false;
      this.syncing.set(false);
      await this.refresh();
    }
  }

  private async patch(id: string, patch: Partial<PendingPlot>): Promise<void> {
    const current = (await this.store.list()).find((e) => e.id === id);
    if (current) await this.store.put({ ...current, ...patch });
  }
}
