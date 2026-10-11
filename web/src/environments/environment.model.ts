// 环境配置的形状。开发与生产两个文件都满足它；生产构建会把 environment.development.ts 换掉，
// 所以模拟器地址只存在于开发文件里，生产产物不带。

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export interface EmulatorConfig {
  authUrl: string;
  firestoreHost: string;
  firestorePort: number;
  // 模拟器不发真短信，关掉 reCAPTCHA 校验才能用测试号登录
  disableAppVerification: boolean;
}

export interface AppEnvironment {
  production: boolean;
  firebase: FirebaseWebConfig;
  // null = 不连模拟器（生产）
  emulators: EmulatorConfig | null;
  // Google Maps JavaScript API 的浏览器 key（本来就公开，不是密钥）。空 = 没配置：屏 5 的地图显示「尚未配置」，不白屏
  mapsApiKey: string;
}
