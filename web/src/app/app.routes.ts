import { Routes } from '@angular/router';
import { redirectIfAuthed, requireAuth } from './core/auth/auth.guard';

// 页面一律懒加载，初始包只带路由与登录状态。
// 角色分流（园主／外勤）放在懒加载的页面里，不放守卫：守卫不能注入 FirestoreReader（会把 Firestore 拖进初始包）。
// 新建地块的三个页面（屏 3、屏 4、屏 5 占位）都要登录；未知路径回 ''：已登录就是屏 2，未登录再被守卫转到 /login。
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
    loadComponent: () =>
      import('./features/new-plot/map-placeholder').then((m) => m.MapPlaceholder),
  },
  { path: '**', redirectTo: '' },
];
