import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, map, switchMap } from 'rxjs';
import { AuthService } from '../../core/firebase/auth.service';
import { FirestoreReader, type DocState } from '../../core/firebase/firestore-reader';
import { formatDay, formatYmd } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { docConfirmed, loadState$, type Load } from '../../core/load-state';
import { LangButton } from '../../shared/lang-button';
import type { UserData } from '../plots/plot-types';
import { checkedAt, forestNote } from '../result/assessment';
import { bannerLook } from '../result/banner-look';
import { forestLine, gapView } from '../result/gap-view';
import { parseRing, toSvgPoints } from '../result/polygon';
import { dashboardState, watchCoop, type DashboardState } from './coop-data';
import {
  BUCKETS,
  ISSUE_CATEGORIES,
  bucketLabel,
  buildRows,
  countBuckets,
  countIssues,
  filterRows,
  filterToParams,
  isFilterEmpty,
  parseFilter,
  rowTexts,
  sortRows,
  summaryCsv,
  type DashboardFilter,
  type IssueCategory,
} from './rows';
import type { BannerKey } from '../result/assessment';

type PageState = 'loading' | 'offline' | 'error' | 'forbidden' | 'nocoop' | DashboardState;

/** 表格一次渲染的行数；多出来的点「Tunjuk lagi」每次再展开这么多 */
const ROWS_PER_PAGE = 100;

// 屏 11「合作社看板」（线框 docs/ui/screen-11-dashboard.png）：宽屏三栏，左筛选、中统计＋表格、右详情。
// 一页完成「看分布 → 找问题 → 看原因 → 导出」。只读：订阅 Firestore 实时更新，不调后端。
// 「谁能看」只是界面行为（role = coop_admin），不是授权：infra/firestore.rules 现在是登录即可读全部。
@Component({
  selector: 'app-coop-page',
  imports: [LangButton],
  templateUrl: './coop-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoopPage {
  private readonly auth = inject(AuthService);
  private readonly reader = inject(FirestoreReader);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly doc = inject(DOCUMENT);
  protected readonly t = this.i18n.t;

  private readonly uid = this.auth.user()?.uid ?? '';
  private readonly profileRetry$ = new BehaviorSubject(0);

  protected readonly loggingOut = signal(false);
  protected readonly logoutFailed = signal(false);

  // ---- users/{uid}：角色与合作社 ----
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

  /** 只有管理员、且绑定了合作社，才去订阅数据；否则一个都不订阅 */
  private readonly coopId = computed(() => {
    const u = this.user();
    return u?.role === 'coop_admin' && u.coopId ? u.coopId : null;
  });

  private readonly data = watchCoop(this.coopId);

  protected readonly state = computed<PageState>(() => {
    const p = this.profile();
    if (p.kind !== 'data') return p.kind;
    const u = p.value.data;
    if (!u || u.role !== 'coop_admin') return 'forbidden';
    if (!u.coopId) return 'nocoop';
    return dashboardState(
      this.data.plots(),
      this.data.assessments(),
      this.data.persons(),
      this.data.titles(),
    );
  });

  /** 顶栏的角色标签只对管理员显示（非管理员打开看板时不该写着「admin」） */
  protected readonly isAdmin = computed(() => this.user()?.role === 'coop_admin');

  protected readonly coopName = computed(() => {
    const c = this.data.coop();
    return c?.kind === 'data' ? (c.value.data?.name ?? null) : null;
  });

  // ---- 行、筛选（筛选条件与选中的地块都在查询参数里，刷新、前进后退都保持） ----
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly filter = computed<DashboardFilter>(() => {
    const p = this.params();
    return parseFilter((k) => p.get(k));
  });
  protected readonly selectedId = computed(() => this.params().get('plot'));

  private readonly rows = computed(() => {
    const plots = this.data.plots();
    const assessments = this.data.assessments();
    const persons = this.data.persons();
    const titles = this.data.titles();
    if (
      this.state() !== 'ready' ||
      plots?.kind !== 'data' ||
      assessments?.kind !== 'data' ||
      persons?.kind !== 'data' ||
      titles?.kind !== 'data'
    ) {
      return [];
    }
    return sortRows(
      buildRows({
        plots: plots.value.docs,
        assessments: assessments.value.docs,
        persons: persons.value.docs,
        titles: titles.value.docs,
      }),
    );
  });

  protected readonly total = computed(() => this.rows().length);

  /** 表格一次最多渲染这么多行（200 行渲染得动，真实规模更大时不会一次渲染几千个 DOM 行）；其余点「Tunjuk lagi」逐页展开 */
  /** 筛选条件变了（不含选中的地块）就回到第一页；选中一块地不会让已展开的行收回去 */
  private readonly filterKey = computed(() => JSON.stringify(this.filter()));
  private readonly visibleLimit = linkedSignal({
    source: this.filterKey,
    computation: () => ROWS_PER_PAGE,
  });
  private readonly counts = computed(() => countBuckets(this.rows()));
  private readonly issueCounts = computed(() => countIssues(this.rows()));
  private readonly filtered = computed(() => filterRows(this.rows(), this.filter()));
  /** 筛选后的行数（「N / 总数」与「没有匹配」都按它，不是按这一页渲染了几行） */
  protected readonly filteredCount = computed(() => this.filtered().length);
  /** 筛选后还没渲染出来的行数；大于 0 才显示「Tunjuk lagi」 */
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.filteredCount() - this.visibleLimit()),
  );
  protected readonly filterActive = computed(() => !isFilterEmpty(this.filter()));

  /** 数据来自本地缓存（还没和服务器对过）：能显示，但要说明可能不是最新 */
  protected readonly fromCache = computed(() =>
    [this.data.plots(), this.data.assessments(), this.data.persons(), this.data.titles()].some(
      (s) => s?.kind === 'data' && s.fromCache,
    ),
  );

  /** 四张统计卡：恒为全合作社，不随筛选联动 */
  protected readonly cards = computed(() => {
    const t = this.t();
    const total = this.total();
    return (['green', 'yellow', 'red', 'needs_review'] as const).map((key) => ({
      key,
      label: bucketLabel(t, key),
      count: this.counts()[key],
      pct: total ? Math.round((this.counts()[key] / total) * 100) : 0,
      look: bannerLook(key),
    }));
  });

  /** 左栏状态筛选：All plots，其后每个有数量的桶（正在选中的也留着，免得选中项凭空消失） */
  protected readonly statusFilters = computed(() => {
    const t = this.t();
    const current = this.filter().status;
    const counts = this.counts();
    return BUCKETS.filter((b) => counts[b] > 0 || b === current).map((key) => ({
      key,
      label: bucketLabel(t, key),
      count: counts[key],
      look: bannerLook(key),
      active: current === key,
    }));
  });

  protected readonly issueFilters = computed(() => {
    const t = this.t();
    const selected = this.filter().issues;
    const counts = this.issueCounts();
    return ISSUE_CATEGORIES.filter((c) => counts[c] > 0 || selected.includes(c)).map((key) => ({
      key,
      label: t.coop.issues[key],
      count: counts[key],
      active: selected.includes(key),
    }));
  });

  protected readonly tableRows = computed(() => {
    const t = this.t();
    const lang = this.i18n.lang();
    const selected = this.selectedId();
    return this.filtered()
      .slice(0, this.visibleLimit())
      .map((row) => ({
        id: row.id,
        text: rowTexts(t, lang, row),
        look: bannerLook(row.bucket),
        bucket: row.bucket,
        selected: row.id === selected,
      }));
  });

  // ---- 右栏详情 ----
  protected readonly detail = computed(() => {
    const id = this.selectedId();
    if (!id) return { kind: 'none' as const };
    const row = this.rows().find((r) => r.id === id);
    if (!row) return { kind: 'notfound' as const };

    const t = this.t();
    const lang = this.i18n.lang();
    const texts = rowTexts(t, lang, row);
    const done = row.concluded;
    const note = done ? forestNote(done) : null;
    const ring = parseRing(row.plot.polygonGeojson);
    const checked = done ? checkedAt(done) : null;
    const day = checked ? formatDay(checked, lang) : null;

    return {
      kind: 'row' as const,
      id: row.id,
      title: t.coop.detail.title(texts.plot, texts.member ?? '—'),
      status: texts.status,
      look: bannerLook(row.bucket),
      bucket: row.bucket,
      /** 还没有结论（没有评估、还在检查、失败）时的一句话 */
      note: done
        ? null
        : row.bucket === 'running'
          ? t.coop.detail.notes.running
          : row.bucket === 'needs_review'
            ? t.coop.detail.notes.needs_review
            : t.coop.detail.notes.pending,
      inFilter: this.filtered().some((r) => r.id === row.id),
      points: ring ? toSvgPoints(ring) : null,
      issues: done ? row.gaps.map((g) => ({ key: g.key, ...gapView(t, lang, done, g) })) : [],
      concluded: done !== null,
      forest: note ? forestLine(t, note) : null,
      checkedOn: day ? t.result.checkedOn(day) : null,
    };
  });

  constructor() {
    // users.language 只在本机从没选过语言时当默认（管理员的档案是 en）
    effect(() => {
      const u = this.user();
      if (u) this.i18n.applyProfileDefault(u.language);
    });

    // 会话在别处失效：回登录页，不停在一个读不到数据的页面
    effect(() => {
      if (this.auth.ready() && !this.auth.user() && !this.loggingOut()) {
        void this.router.navigateByUrl('/coop/login', { replaceUrl: true });
      }
    });
  }

  // ---- 动作 ----

  private go(params: Record<string, string | null>, replace = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  protected setStatus(status: BannerKey | null): void {
    this.go(filterToParams({ ...this.filter(), status }));
  }

  protected toggleIssue(issue: IssueCategory): void {
    const current = this.filter().issues;
    const issues = current.includes(issue)
      ? current.filter((i) => i !== issue)
      : [...current, issue];
    this.go(filterToParams({ ...this.filter(), issues }));
  }

  /** 输入时用替换历史：打一个字不该多一条后退记录 */
  protected setQuery(q: string): void {
    this.go(filterToParams({ ...this.filter(), q }), true);
  }

  protected clearFilters(): void {
    this.go({ status: null, issue: null, q: null });
  }

  protected showMore(): void {
    this.visibleLimit.update((n) => n + ROWS_PER_PAGE);
  }

  protected select(id: string): void {
    this.go({ plot: id });
  }

  protected openResult(id: string): void {
    void this.router.navigate(['/plots', id]);
  }

  /** 选中了地块才能导出档案：进 A4 版面的档案页，在那里用浏览器打印成 PDF */
  protected openDossier(): void {
    const d = this.detail();
    if (d.kind === 'row') void this.router.navigate(['/plots', d.id, 'dossier']);
  }

  protected backToPlots(): void {
    void this.router.navigate(['/']);
  }

  /**
   * 档案本身没读到（离线／出错）才重试档案；档案读到了、是数据订阅出问题，就只重试数据订阅——
   * 重启档案订阅会让 coopId 暂时为空，把已经好的数据订阅也拆掉再重建。
   */
  protected retry(): void {
    const p = this.profile();
    if (p.kind === 'offline' || p.kind === 'error')
      this.profileRetry$.next(this.profileRetry$.value + 1);
    else this.data.retry();
  }

  /**
   * 导出当前筛选后的表格（CSV）。内容见 rows.ts 的 summaryCsv：不含证件信息、评估说明文字、plotId；
   * 防公式注入、UTF-8 带 BOM。没有行时不导出。
   */
  protected exportCsv(): void {
    const rows = this.filtered();
    if (rows.length === 0) return;
    const csv = summaryCsv(this.t(), this.i18n.lang(), rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = this.doc.createElement('a');
    a.href = url;
    a.download = `kebunsah-ringkasan-${formatYmd(new Date())}.csv`;
    this.doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0); // 立刻撤销会让部分浏览器取消下载
  }

  protected async logout(): Promise<void> {
    this.logoutFailed.set(false);
    this.loggingOut.set(true); // 先把内容藏起来：登出瞬间监听会收到 permission-denied，不让用户看到
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/coop/login', { replaceUrl: true });
    } catch {
      this.loggingOut.set(false);
      this.logoutFailed.set(true);
    }
  }
}
