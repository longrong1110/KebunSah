import type { AppEnvironment } from './environment.model';

// 生产配置：线上 Firebase 项目 kebunsah。这些 Web 配置值本来就是公开的，不是密钥（安全靠 Firestore 规则和后端校验 token）。
// 没填的项（apiBaseUrl、mapsApiKey）留空时 App 不会白屏：屏 6 提示「服务尚未配置」，屏 5 的地图提示「尚未配置」。
export const environment: AppEnvironment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyCQW9yvQFZsXlfmGSQpwtLGDQpXedrs15g',
    authDomain: 'kebunsah.firebaseapp.com',
    projectId: 'kebunsah',
    appId: '1:533984680346:web:ace793ebc9054e67cc0223',
  },
  emulators: null,
  // 正式 key 要限制 HTTP 来源（Hosting 网址）；还没有，先留空，屏 5 的地图会显示「尚未配置」
  mapsApiKey: '',
  // 线上后端 kebunsah-api（Cloud Run，asia-southeast1）。后端的 CORS 只放行 Hosting 的两个域名
  apiBaseUrl: 'https://kebunsah-api-533984680346.asia-southeast1.run.app',
};
