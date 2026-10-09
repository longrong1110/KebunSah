import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../../core/firebase/auth.service';
import {
  FirestoreReader,
  type CollectionState,
  type DocState,
} from '../../core/firebase/firestore-reader';
import { PLOT_STATUSES, ROLE_LABEL, STATUS_VIEW, countByStatus } from '../../core/plot-status';

type Load<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'data'; value: T };

// 超过这么久还没拿到服务器确认的快照，就按"连不上"处理（首个快照常常是本地缓存的空集合）
const OFFLINE_AFTER_MS = 10_000;

// 占位首页，同时是"订阅写法"的第一个范例（会被屏 2 替换，但这个写法保留）：
//   FirestoreReader 给冷 Observable → toSignal 变成 signal（zoneless 下视图才会刷新）
//   → 组件销毁时 toSignal 自动取消订阅，不会泄漏监听。
@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly reader = inject(FirestoreReader);

  readonly uid = this.auth.user()?.uid ?? '';
  readonly phone = this.auth.user()?.phoneNumber ?? '';
  readonly statuses = PLOT_STATUSES;
  readonly statusView = STATUS_VIEW;
  readonly loggingOut = signal(false);
  readonly logoutFailed = signal(false);
  private readonly timedOut = signal(false);

  private readonly plots = toSignal(
    this.reader.collection$<{ status?: unknown }>('plots').pipe(
      map((value): Load<CollectionState<{ status?: unknown }>> => ({ kind: 'data', value })),
      catchError(() => of<Load<CollectionState<{ status?: unknown }>>>({ kind: 'error' })),
    ),
    { initialValue: { kind: 'loading' } as Load<CollectionState<{ status?: unknown }>> },
  );

  private readonly profile = toSignal(
    this.reader.doc$<{ role?: string }>(`users/${this.uid}`).pipe(
      map((value): Load<DocState<{ role?: string }>> => ({ kind: 'data', value })),
      catchError(() => of<Load<DocState<{ role?: string }>>>({ kind: 'error' })),
    ),
    { initialValue: { kind: 'loading' } as Load<DocState<{ role?: string }>> },
  );

  /** 首页计数：只有服务器确认过的快照才算数；缓存里的空集合不能显示成"0" */
  readonly plotsView = computed(() => {
    const p = this.plots();
    if (p.kind === 'error') return { kind: 'error' as const };
    if (p.kind === 'data') {
      const confirmed = !p.value.fromCache || p.value.docs.length > 0;
      if (confirmed)
        return {
          kind: 'ok' as const,
          counts: countByStatus(p.value.docs),
          fromCache: p.value.fromCache,
        };
    }
    return this.timedOut() ? { kind: 'offline' as const } : { kind: 'loading' as const };
  });

  readonly profileView = computed(() => {
    const p = this.profile();
    if (p.kind === 'error') return { kind: 'error' as const };
    if (p.kind === 'data') {
      if (p.value.data)
        return {
          kind: 'ok' as const,
          role: ROLE_LABEL[p.value.data.role ?? ''] ?? p.value.data.role ?? '-',
        };
      if (!p.value.fromCache) return { kind: 'missing' as const };
    }
    // 和计数一样：迟迟拿不到服务器确认，就按读不到处理，不能一直转圈
    return this.timedOut() ? { kind: 'error' as const } : { kind: 'loading' as const };
  });

  constructor() {
    const timer = setTimeout(() => this.timedOut.set(true), OFFLINE_AFTER_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));

    // 会话在别处失效（比如模拟器重启、账号被删）：回登录页，不停在一个读不到数据的首页
    effect(() => {
      if (this.auth.ready() && !this.auth.user() && !this.loggingOut()) {
        void this.router.navigateByUrl('/login', { replaceUrl: true });
      }
    });
  }

  async logout(): Promise<void> {
    this.logoutFailed.set(false);
    this.loggingOut.set(true); // 先把内容藏起来：登出瞬间监听会收到 permission-denied，不让用户看到
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch {
      // 登出失败（例如本地存储写不进去）：恢复页面并告诉用户，不能留一个空白页
      this.loggingOut.set(false);
      this.logoutFailed.set(true);
    }
  }
}
