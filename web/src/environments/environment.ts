import type { AppEnvironment } from './environment.model';

// 生产配置：线上 Firebase 项目 kebunsah。这些 Web 配置值本来就是公开的，不是密钥（安全靠 Firestore 规则和后端校验 token）。
// apiBaseUrl、mapsApiKey 留空时 App 不会白屏：屏 6 提示「服务尚未配置」，屏 5 的地图提示「尚未配置」。
export const environment: AppEnvironment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyCQW9yvQFZsXlfmGSQpwtLGDQpXedrs15g',
    authDomain: 'kebunsah.firebaseapp.com',
    projectId: 'kebunsah',
    appId: '1:533984680346:web:ace793ebc9054e67cc0223',
  },
  emulators: null,
  // 浏览器 key（本来就公开）：已限制只能从 kebunsah.web.app、kebunsah.firebaseapp.com、localhost:4200 调用，且只放行 Maps JavaScript API
  mapsApiKey: 'AIzaSyA__WSIYgGYnpQC8YZXO2ZRoE1WCngEb9A',
  // 线上后端 kebunsah-api（Cloud Run，asia-southeast1）。后端的 CORS 只放行 Hosting 的两个域名
  apiBaseUrl: 'https://kebunsah-api-533984680346.asia-southeast1.run.app',
};
