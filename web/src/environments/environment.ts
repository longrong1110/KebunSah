import type { AppEnvironment } from './environment.model';

// 生产配置。线上 Firebase 项目还没建，Web 配置先留空：App 不会白屏，只是登录会提示「服务尚未配置」。
// 建好项目后把 Firebase 控制台给的 Web 配置填进来（这些值本来就是公开的，不是密钥）。
export const environment: AppEnvironment = {
  production: true,
  firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' },
  emulators: null,
  // 正式 key 要限制 HTTP 来源（Hosting 网址）；还没有，先留空，屏 5 的地图会显示「尚未配置」
  mapsApiKey: '',
};
