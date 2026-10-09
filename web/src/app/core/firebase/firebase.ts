import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import type { AppEnvironment } from '../../../environments/environment.model';

// Firebase 应用与 Auth 的惰性、幂等初始化。
// Firestore 的接线放在 firestore-facade.ts：它只在首页的懒加载块里用到，不拖大初始包。

// 生产配置留空时抛这个：调用方据此显示「服务尚未配置」，而不是白屏。
export class NotConfiguredError extends Error {
  constructor() {
    super('Firebase belum dikonfigurasi');
    this.name = 'NotConfiguredError';
  }
}

export const firebaseConfigured = (env: AppEnvironment = environment): boolean =>
  Boolean(env.firebase.apiKey && env.firebase.projectId);

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured()) throw new NotConfiguredError();
  return getApps().length ? getApp() : initializeApp(environment.firebase);
}

// 热更新会让本模块重新执行，而 Firebase 实例还在：模拟器只能连一次，所以标志放在 globalThis 上。
export const wiredFlag = (name: string) => `__kebunsah_${name}`;

let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  const emu = environment.emulators;
  const g = globalThis as Record<string, unknown>;
  if (emu && !g[wiredFlag('auth')]) {
    connectAuthEmulator(auth, emu.authUrl, { disableWarnings: true });
    // 模拟器不发真短信，关掉应用验证才能用测试号登录
    auth.settings.appVerificationDisabledForTesting = emu.disableAppVerification;
    g[wiredFlag('auth')] = true;
  }
  return auth;
}
