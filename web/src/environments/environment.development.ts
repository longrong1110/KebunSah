import type { AppEnvironment } from './environment.model';

// 开发配置：只连本机 Firebase 模拟器，项目名固定 demo-kebunsah（demo- 前缀的项目 ID 不会访问线上服务）。
// 用 127.0.0.1 而不是 localhost：Windows 优先解析成 ::1，而模拟器绑在 127.0.0.1。
// apiKey 随便填但不能为空，否则 getAuth 抛 auth/invalid-api-key。
export const environment: AppEnvironment = {
  production: false,
  firebase: {
    apiKey: 'demo-key',
    authDomain: 'demo-kebunsah.firebaseapp.com',
    projectId: 'demo-kebunsah',
    appId: '1:000000000000:web:demo',
  },
  emulators: {
    authUrl: 'http://127.0.0.1:9099',
    firestoreHost: '127.0.0.1',
    firestorePort: 8080,
    disableAppVerification: true,
  },
  // Google 官方的 Maps Demo key：只适合原型，用量上限不明，不支持正式上线；能否限制 HTTP 来源未测。
  // 演示前换成自己项目里、限制了来源的正式 key（见根 README「系统还没做的」P1 #10）。
  mapsApiKey: 'AIzaSyB-sAVDPMZKF-ujCzVBox8HBhVgKEt1Myc',
  // 本机后端：python scripts/run_api.py（见 api/README.md）。后端的 CORS 默认放行 localhost:4200 和 127.0.0.1:4200
  apiBaseUrl: 'http://127.0.0.1:8000',
};
