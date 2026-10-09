import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../firebase/auth.service';

// 要登录才能进：未登录 → /login。先等登录状态确定，已登录刷新页面时才不会闪现登录页。
export const requireAuth: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  return auth.user() ? true : router.createUrlTree(['/login']);
};

// 登录页：已登录的人不该再看到它 → /
export const redirectIfAuthed: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  return auth.user() ? router.createUrlTree(['/']) : true;
};
