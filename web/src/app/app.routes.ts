import { Routes } from '@angular/router';
import { redirectIfAuthed, requireAuth } from './core/auth/auth.guard';

// 页面一律懒加载，初始包只带路由与登录状态。
// 角色分流（园主／外勤）放在懒加载的页面里，不放守卫：守卫不能注入 FirestoreReader（会把 Firestore 拖进初始包）。
// 新建地块的页面（屏 3、屏 4、屏 5、屏 6 的壳）都要登录；未知路径回 ''：已登录就是屏 2，未登录再被守卫转到 /login。
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [redirectIfAuthed],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/plots/plots-page').then((m) => m.PlotsPage),
  },
  {
    path: 'plots/new',
    pathMatch: 'full',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/new-plot/documents-page').then((m) => m.DocumentsPage),
  },
  {
    path: 'plots/new/camera/:doc',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/new-plot/camera-page').then((m) => m.CameraPage),
  },
  {
    path: 'plots/new/map',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/new-plot/map-page').then((m) => m.MapPage),
  },
  // 屏 6 的壳：屏 5「Selesai」之后进来；本体要等建地块、上传、评估的接口合同
  {
    path: 'plots/new/review',
    canActivate: [requireAuth],
    loadComponent: () =>
      import('./features/new-plot/review-placeholder').then((m) => m.ReviewPlaceholder),
  },
  // 屏 9 结果。必须排在 plots/new* 之后，'new' 才不会被当成地块 id
  {
    path: 'plots/:id',
    pathMatch: 'full',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/result/result-page').then((m) => m.ResultPage),
  },
  // 屏 10 问题详情：:key 是缺口的 gapCode（同码多个文件时带 docType）
  {
    path: 'plots/:id/issue/:key',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/result/issue-page').then((m) => m.IssuePage),
  },
  // 屏 7 评估中：转圈＋分步进度，可离开；现在从屏 9 的「Lihat kemajuan」进入（屏 6「开始检查」做好后由它跳转）
  {
    path: 'plots/:id/checking',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/checking/checking-page').then((m) => m.CheckingPage),
  },
  // 导出档案（A4 版面，浏览器打印成 PDF）：从看板里选中地块后进入
  {
    path: 'plots/:id/dossier',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/dossier/dossier-page').then((m) => m.DossierPage),
  },
  // 屏 11 合作社看板（电脑宽屏）：筛选条件与选中的地块在查询参数里（?status=&issue=&q=&plot=）
  {
    path: 'coop',
    canActivate: [requireAuth],
    loadComponent: () => import('./features/coop/coop-page').then((m) => m.CoopPage),
  },
  { path: '**', redirectTo: '' },
];
