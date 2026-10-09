import { Routes } from '@angular/router';
import { redirectIfAuthed, requireAuth } from './core/auth/auth.guard';

// 页面一律懒加载，初始包只带路由与登录状态。
// 未知路径回 ''：已登录就是首页，未登录再被守卫转到 /login。
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
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  { path: '**', redirectTo: '' },
];
