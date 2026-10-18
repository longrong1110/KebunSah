import { Injectable, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/firebase/auth.service';
import { FirestoreReader } from '../../core/firebase/firestore-reader';
import type { UserData } from './plot-types';

// 当前登录的人在 users/{uid} 里的角色。合作社管理员只能看：结果页、屏 10、地块列表据此不放出任何会改数据的按钮
// （后端对管理员的写请求也一律回 403，这里只是不让他点到一个必然失败的按钮）。
@Injectable({ providedIn: 'root' })
export class CurrentRole {
  private readonly auth = inject(AuthService);
  private readonly reader = inject(FirestoreReader);

  /** 还没读到、没登录、读不到（比如刚登出）都是 null */
  readonly role = toSignal(
    toObservable(computed(() => this.auth.user()?.uid ?? null)).pipe(
      switchMap((uid) =>
        uid
          ? this.reader.doc$<UserData>(`users/${uid}`).pipe(
              map((state) => state.data?.role ?? null),
              catchError(() => of(null)),
            )
          : of(null),
      ),
    ),
    { initialValue: null as string | null },
  );

  /** 合作社管理员：只读 */
  readonly readOnly = computed(() => this.role() === 'coop_admin');
}
