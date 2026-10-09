import { ChangeDetectionStrategy, Component, computed, inject, model, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, switchMap } from 'rxjs';
import { FirestoreReader, type CollectionState } from '../../core/firebase/firestore-reader';
import { titleCaseName } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { collectionConfirmed, loadState$, type Load } from '../../core/load-state';
import { matchesQuery } from '../../core/people-search';
import type { PersonData } from './plot-types';

// 外勤／管理员的「选择成员」列表（屏 2 的第一步）：按姓名 A–Z，可搜索。
// 订阅整个 persons（约 200 条）：persons 没有 coopId，没法按合作社过滤（合同缺口）。
// 行里只显示姓名：icHash / icLast4 虽然会随文档下载，但这里只取 fullName，不渲染、不进搜索、不进日志。
@Component({
  selector: 'app-member-list',
  templateUrl: './member-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberList {
  /** 搜索词：由父页面持有（双向绑定），选了成员再返回时还在 */
  readonly query = model('');
  readonly selected = output<string>();

  private readonly reader = inject(FirestoreReader);
  protected readonly t = inject(I18nService).t;

  private readonly retry$ = new BehaviorSubject(0);

  protected readonly load = toSignal(
    this.retry$.pipe(
      switchMap(() =>
        loadState$(this.reader.collection$<PersonData>('persons'), collectionConfirmed),
      ),
    ),
    { initialValue: { kind: 'loading' } as Load<CollectionState<PersonData>> },
  );

  /** 全部成员，按姓名 A–Z（姓名是全大写 ASCII，直接比较即可） */
  private readonly members = computed(() => {
    const l = this.load();
    if (l.kind !== 'data') return [];
    return l.value.docs
      .map((d) => ({ id: d.id, name: d.data.fullName ?? '' }))
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ ...m, display: titleCaseName(m.name) }));
  });

  protected readonly visible = computed(() =>
    this.members().filter((m) => matchesQuery(m.name, this.query())),
  );

  protected readonly state = computed(() => {
    const l = this.load();
    if (l.kind !== 'data') return l.kind;
    if (this.members().length === 0) return 'empty' as const;
    return this.visible().length === 0 ? ('noMatch' as const) : ('list' as const);
  });

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    this.retry$.next(this.retry$.value + 1);
  }
}
