import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, combineLatest, map, of, switchMap } from 'rxjs';
import { BackNavigator } from '../../core/back-navigator';
import { AuthService } from '../../core/firebase/auth.service';
import {
  FirestoreReader,
  type CollectionState,
  type DocState,
} from '../../core/firebase/firestore-reader';
import { titleCaseName } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { collectionConfirmed, docConfirmed, loadState$, type Load } from '../../core/load-state';
import { LangButton } from '../../shared/lang-button';
import { DraftService } from '../new-plot/draft.service';
import { MemberList } from './member-list';
import { PlotCard } from './plot-card';
import { sortPlots, type PersonData, type PlotData, type UserData } from './plot-types';

type Mode = 'loading' | 'offline' | 'error' | 'noprofile' | 'owner' | 'officer';

// 屏 2「我的地块」（线框 docs/ui/screen-02.png）。
// 按角色分流：园主直接看自己的地块；外勤／管理员先选成员（?member=<personId>），再看这位成员的地块。
// 三态可信：服务器没确认的空结果显示加载（超时转离线），不显示成「0 块地」。
// 写入类动作（「Tambah tanah」之后的新建地块、上传照片）本轮只做本机草稿，见 DraftService。
@Component({
  selector: 'app-plots-page',
  imports: [LangButton, MemberList, PlotCard],
  templateUrl: './plots-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlotsPage {
  private readonly auth = inject(AuthService);
  private readonly reader = inject(FirestoreReader);
  private readonly router = inject(Router);
  private readonly backNav = inject(BackNavigator);
  private readonly route = inject(ActivatedRoute);
  private readonly draft = inject(DraftService);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  private readonly uid = this.auth.user()?.uid ?? '';
  private readonly profileRetry$ = new BehaviorSubject(0);
  private readonly plotsRetry$ = new BehaviorSubject(0);

  protected readonly loggingOut = signal(false);
  protected readonly logoutFailed = signal(false);
  /** 成员搜索词放在页面上：选了成员、再点返回时还在 */
  protected readonly memberQuery = signal('');

  // ---- users/{uid}：角色与 personId ----
  private readonly profile = toSignal(
    this.profileRetry$.pipe(
      switchMap(() => loadState$(this.reader.doc$<UserData>(`users/${this.uid}`), docConfirmed)),
    ),
    { initialValue: { kind: 'loading' } as Load<DocState<UserData>> },
  );

  private readonly user = computed(() => {
    const p = this.profile();
    return p.kind === 'data' ? p.value.data : null;
  });

  /** 园主看自己的；外勤／管理员看选中的成员；其余（没有档案、角色未知、园主没有 personId）显示说明 */
  protected readonly mode = computed<Mode>(() => {
    const p = this.profile();
    if (p.kind !== 'data') return p.kind;
    const u = p.value.data;
    if (!u) return 'noprofile';
    if (u.role === 'smallholder' && u.personId) return 'owner';
    if (u.role === 'field_officer' || u.role === 'coop_admin') return 'officer';
    return 'noprofile';
  });

  protected readonly memberId = toSignal(
    this.route.queryParamMap.pipe(map((q) => q.get('member'))),
    { initialValue: this.route.snapshot.queryParamMap.get('member') },
  );

  /** 现在要看谁的地块 */
  private readonly targetPersonId = computed(() => {
    switch (this.mode()) {
      case 'owner':
        return this.user()?.personId ?? null;
      case 'officer':
        return this.memberId();
      default:
        return null;
    }
  });

  // ---- 目标人的姓名（头部）与地块 ----
  private readonly person = toSignal(
    toObservable(this.targetPersonId).pipe(
      switchMap((id) =>
        id ? loadState$(this.reader.doc$<PersonData>(`persons/${id}`), docConfirmed) : of(null),
      ),
    ),
    { initialValue: null as Load<DocState<PersonData>> | null },
  );

  private readonly personName = computed(() => {
    const p = this.person();
    const name = p?.kind === 'data' ? p.value.data?.fullName : null;
    return name ? titleCaseName(name) : null;
  });

  private readonly plots = toSignal(
    combineLatest([toObservable(this.targetPersonId), this.plotsRetry$]).pipe(
      switchMap(([id]) =>
        id
          ? loadState$(
              this.reader.collection$<PlotData>('plots', {
                where: [{ field: 'operatorPersonId', value: id }],
              }),
              collectionConfirmed,
            )
          : of(null),
      ),
    ),
    { initialValue: null as Load<CollectionState<PlotData>> | null },
  );

  protected readonly plotsState = computed(() => {
    const p = this.plots();
    if (!p) return 'idle' as const;
    if (p.kind !== 'data') return p.kind;
    return p.value.docs.length === 0 ? ('empty' as const) : ('list' as const);
  });

  protected readonly sortedPlots = computed(() => {
    const p = this.plots();
    return p?.kind === 'data' ? sortPlots(p.value.docs) : [];
  });

  protected readonly fromCache = computed(() => {
    const p = this.plots();
    return p?.kind === 'data' && p.fromCache;
  });

  /** 块数只在服务器确认后才显示：缓存里的数可能是旧的 */
  private readonly confirmedCount = computed(() => {
    const p = this.plots();
    return p?.kind === 'data' && !p.fromCache ? p.value.docs.length : null;
  });

  protected readonly heading = computed(() => {
    const t = this.t();
    if (this.mode() !== 'officer') return t.plots.title;
    return this.memberId() ? t.plots.memberTitle(this.personName() ?? '…') : t.members.title;
  });

  /** 线框头部「Pak Ahmad · 3 bidang tanah」：姓名到了才显示；块数确认后才带上 */
  protected readonly subheading = computed(() => {
    if (this.mode() !== 'owner') return null;
    const name = this.personName();
    if (!name) return null;
    const n = this.confirmedCount();
    return n === null ? name : this.t().plots.ownerHeader(name, n);
  });

  /** 合作社管理员：头部多一个进入看板的入口（界面行为，不是授权） */
  protected readonly isCoopAdmin = computed(() => this.user()?.role === 'coop_admin');

  /** 「Tambah tanah」：园主随时可见；外勤只在选了成员之后（新建要知道归属） */
  protected readonly showAdd = computed(
    () => this.mode() === 'owner' || (this.mode() === 'officer' && !!this.memberId()),
  );

  constructor() {
    // 回到 /：上一次没做完的草稿清空（照片本来就不上传）
    this.draft.reset();

    // users.language 只在本机从没选过语言时当默认
    effect(() => {
      const u = this.user();
      if (u) this.i18n.applyProfileDefault(u.language);
    });

    // ?member 指向一个服务器已确认不存在的人（手改网址、成员被删）：退回成员列表，
    // 不留一个标题还挂着「…」、却能点「Tambah tanah」的空页面。缓存里的「不存在」不算（见 docConfirmed）
    effect(() => {
      const p = this.person();
      if (this.mode() === 'officer' && this.memberId() && p?.kind === 'data' && !p.value.data) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { member: null },
          replaceUrl: true,
        });
      }
    });

    // 会话在别处失效（模拟器重启、账号被删）：回登录页，不停在一个读不到数据的页面
    effect(() => {
      if (this.auth.ready() && !this.auth.user() && !this.loggingOut()) {
        void this.router.navigateByUrl('/login', { replaceUrl: true });
      }
    });
  }

  protected selectMember(id: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { member: id } });
  }

  protected openDashboard(): void {
    void this.router.navigate(['/coop']);
  }

  /** 有历史就后退（回到没带 ?member 的成员列表）；没有历史（直接打开带 ?member 的链接）就去掉 ?member */
  protected backToMembers(): void {
    this.backNav.back([], { relativeTo: this.route, queryParams: { member: null } });
  }

  protected add(): void {
    const member = this.mode() === 'officer' ? this.memberId() : null;
    this.draft.begin(member);
    void this.router.navigate(['/plots/new'], member ? { queryParams: { member } } : {});
  }

  protected retryProfile(): void {
    this.profileRetry$.next(this.profileRetry$.value + 1);
  }

  protected retryPlots(): void {
    this.plotsRetry$.next(this.plotsRetry$.value + 1);
  }

  protected async logout(): Promise<void> {
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
