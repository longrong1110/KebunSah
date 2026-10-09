# web：Angular PWA（前端）

手机端屏 1–10 和合作社电脑看板。部署到 Firebase Hosting（构建输出 `web/dist/web/browser`，对上根目录 `firebase.json`）。
Angular 22 + 官方 `firebase` SDK（不用 `@angular/fire`：它的最新版只支持 Angular 20），zoneless，Vitest。

**Firestore 只读**：`plots`、`documents`、`assessments` 等由后端的 API 和 AI 服务写，前端只实时订阅。写入走后端 API。

## 从零到登录进首页

需要 Node `^22.22.3 || ^24.15 || >=26`（`package.json` 的 `engines`）、Java 11+、全局的 `firebase-tools`。

```bash
cd web && npm install
npm run emulators               # 终端 1：Auth(9099) + Firestore(8080)
cd ../seed
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run load   # 终端 2：灌入数据并建测试账号
cd ../web && npm start          # 终端 3：http://localhost:4200
```

PowerShell 设环境变量：`$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; npm run load`。
**模拟器一重启，数据和账号全清空**，要重新 `npm run load`；浏览器里残留的旧会话会被当成未登录。

### 测试号与取验证码

模拟器不发真短信。点「Hantar kod OTP」后，验证码从模拟器取：

```bash
curl http://127.0.0.1:9099/emulator/v1/projects/demo-kebunsah/verificationCodes
# PowerShell 里请用 curl.exe（curl 是 Invoke-WebRequest 的别名，输出会是一张对象表）
```

| 手机号 | uid（= `users` 文档 id） | 角色 |
| --- | --- | --- |
| +60100000001 | `demo-officer-1` | 外勤 `field_officer` |
| +60100000002 | `demo-admin-1` | 合作社管理员 `coop_admin` |
| +60100000011 / 12 / 13 | `demo-smallholder-1` / `2` / `3` | 园主 `smallholder` |

号码可以写成 `+60100000001`、`0100000001`、`010-000 0001`。**不在表里的号码**也能登录，得到随机 uid，读不到 `users/{uid}`，首页显示「Profil anda belum dibuat.」。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 开发服务，开发配置（连模拟器），不注册 service worker |
| `npm run build` | 生产构建（默认就是生产配置） |
| `npm test` / `npx ng test --watch=false` | 单元测试（Vitest） |
| `npm run check:readonly` | `src/` 里不得出现 Firestore 写函数 |
| `npm run check:prod-bundle` | 生产产物里不得带模拟器痕迹（先 `ng build`） |
| `npm run test:scripts` | 两个检查脚本自己的回归测试 |
| `npm run format` | 按 `.prettierrc` 格式化 `src` 与 `scripts` |
| `npm run verify` | 只读检查 + 脚本测试 + 生产构建 + 产物检查 + 单元测试，一次跑完 |
| `npm run emulators` | 启动模拟器（见下） |

## 目录与惯例

```
src/environments/             environment.ts（生产）/ environment.development.ts（开发，带模拟器地址）
src/app/core/firebase/        firebase.ts（App + Auth 惰性幂等初始化）、firestore-facade.ts（Firestore 只读外观）、
                              auth.service.ts（手机号 OTP）、firestore-reader.ts（只有 doc$ / collection$）
src/app/core/auth/            路由守卫
src/app/core/                 phone.ts（号码规范化）、plot-status.ts（状态值、标签、图标）
src/app/features/<屏>/        每屏一个目录，懒加载
scripts/                      emulators.mjs、check-readonly.mjs、check-prod-bundle.mjs
```

- **服务分层**：组件不直接 import `firebase/*`。登录状态只看 `AuthService.user` / `ready`；读数据只通过 `FirestoreReader`。Firestore 的 SDK 只在 `firestore-facade.ts` 里，随首页懒加载，不进初始包（拆开前初始包 794 kB，拆开后 351 kB）。
- **订阅写法**（zoneless 下的惯例）：`FirestoreReader` 给**冷** Observable，组件用 `toSignal(...)` 变成 signal，视图才会刷新；组件销毁时 `toSignal` 自动取消订阅，不会泄漏监听。不要在 `subscribe` 回调里直接改普通属性。参考 `features/home/home.ts`。
- **别把 0 当事实**：`collection$` 带出 `fromCache`。服务器还没确认的空快照不能显示成「0」，要显示加载态，超时（10 秒）转成离线状态。
- **环境隔离**：模拟器地址只写在 `environment.development.ts`。`ng build` 默认走生产配置，用 `environment.ts` 换掉开发文件，所以生产产物里没有 `demo-kebunsah`、`127.0.0.1`、端口号；`check:prod-bundle` 把关。线上 Firebase 项目建好后，把 Web 配置填进 `environment.ts`（这些值是公开的，不是密钥）。生产配置为空时 App 不白屏，登录页提示「Perkhidmatan belum disediakan.」。
- **模拟器地址用 `127.0.0.1`，不用 `localhost`**：Windows 优先解析成 `::1`，模拟器绑在 `127.0.0.1`。
- **状态永远是「颜色 + 图标 + 文字」**，状态值只用 `contract/status.md` 的字符串，见 `core/plot-status.ts`。
- 界面文案以马来语为主，说人话、给下一步（企划书 v3「状态与文案规范」）。正文 ≥16px，触控目标 ≥48px。

## 模拟器怎么启动的（为什么不直接 `firebase emulators:start`）

`npm run emulators` 运行 `scripts/emulators.mjs`。原因（都是实测过的）：

1. 根目录 `firebase.json` 没有 `emulators.auth` 时，Auth 模拟器**不会启动**；`firebase.json` 是和队友共管的，这里不改。
2. 独立配置文件里的 `firestore.rules`：相对路径会被判成「在项目目录之外」（项目目录 = 配置文件所在目录），写成别的相对路径则找不到文件，而**找不到时模拟器会静默退回「允许所有读写」**。脚本用绝对路径，并在文件不存在时直接报错不启动。
3. 在 `web/` 里启动，`*-debug.log` 落在 `web/`（已被 `web/.gitignore` 忽略），不污染仓库根。

以后 `firebase.json` 加上 `emulators` 设置，这个脚本就可以退休。

## 已知限制

- 登录页是脚手架：屏 1 的正式界面（含右上角语言切换）由 `fe/screens-1-3` 按企划书 v3 的屏 1 线框做，到时替换，服务层和错误处理沿用。
- 首页是占位页：显示 uid、角色和 `plots` 各状态计数，用来验证 seed → 模拟器 → 网页整条链路；屏 2 到时替换，订阅写法保留。
- 首次登录谁来创建 `users/{uid}`、`lastLoginAt` 谁写，合同还没定（见 `seed/README.md` 缺口 10），本次不创建。
- CI：`infra/cloudbuild/pr.yaml`、`deploy.yaml` 里的 `node:20` 满足不了 Angular 22 的 Node 要求，PR 检查接上之前必须改成 `node:22` 或 `node:24`（共管文件，要队友同意）。
- Service worker 只在生产构建注册（`ng serve` 下不注册）；Claude 内置浏览器窗格不允许注册 service worker，实际的离线行为还没在真实浏览器里验证过。
- 登录页与首页都没有语言切换，文案固定为马来语。
