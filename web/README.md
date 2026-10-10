# web：Angular PWA（前端）

手机端屏 1–10 和合作社电脑看板。部署到 Firebase Hosting（构建输出 `web/dist/web/browser`，对上根目录 `firebase.json`）。
Angular 22 + 官方 `firebase` SDK（不用 `@angular/fire`：它的最新版只支持 Angular 20），zoneless，Vitest。

**Firestore 只读**：`plots`、`documents`、`assessments` 等由后端的 API 和 AI 服务写，前端只实时订阅。写入走后端 API。

## 从零到进入「我的地块」

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

号码可以写成 `+60100000001`、`0100000001`、`010-000 0001`。**不在表里的号码**也能登录，得到随机 uid，读不到 `users/{uid}`，屏 2 显示「Profil anda belum dibuat.」。

## 屏幕与路由

登录后所有页面都要求已登录（`requireAuth`），未登录一律回 `/login`；已登录访问 `/login` 回 `/`。

| 路由 | 屏 | 说明 |
| --- | --- | --- |
| `/login` | 1 登录 | 手机号 + OTP；右上角 🌐 BM／EN 切换 |
| `/` | 2 我的地块 | 园主：自己的地块卡片。外勤／管理员：先选成员（可搜名字），选中后看该成员的地块，URL 带 `?member=<personId>`，刷新和返回都不丢 |
| `/plots/new` | 3 拍文件 | 地契、MSPO、MPOB 三张卡片，每份可「拍」或「跳过」，三份都处理完才能「Seterusnya」 |
| `/plots/new/camera/:doc` | 4 取景 | `:doc` 取 `land_title`／`mspo_cert`／`mpob_licence`；非法值回屏 3。拍完先预览，确认才算数 |
| `/plots/new/map` | 5 占位 | 「Peta akan datang」；真正的地图屏由后续分支做 |
| `/plots/:id` | 9 结果 | 屏 2 的卡片点进来。红黄绿横幅、最多先列 3 件「Perlu dibuat」（每件一个按钮，多于 3 件可展开）、通过的检查默认收起、森林初筛一句话（永远带「只是初筛」） |
| `/coop` | 11 合作社看板（电脑宽屏） | 仅 `coop_admin`（屏 2 头部有「Papan pemuka」入口）。左栏筛选、中间统计卡＋表格（红色最前）、右栏选中地块的详情；筛选条件和选中的地块在查询参数里（`?status=red&issue=area,expiry&q=…&plot=…`），刷新和前进后退都保持。窄于 1024px 栈叠 |
| `/plots/:id/issue/:key` | 10 问题详情 | `:key` 是缺口的 `gapCode`（同码多个文件时带 `~docType`，如 `low_confidence~land_title`；不用点号，带点的末段在 PWA 里不会被当成导航请求）。数字对照、可能原因、建议；面积问题还有形状预览 |

### 逐屏怎么试

先按上面「从零到…」起好模拟器并灌入数据，再 `npm start`。取验证码见上一节。

- **屏 1**：点右上角 🌐 切到 EN，整页文案换；刷新后仍是 EN（记在 `localStorage` 的 `kebunsah.lang`）。输错号码、错验证码、验证码过期，分别有人话提示。
- **屏 2（园主）**：用 `+60100000011` 登录，看到自己的地块卡片（状态 = 颜色 + 图标 + 文字）。顶部「Log keluar」登出。
- **屏 2（外勤）**：用 `+60100000001` 登录，先看到成员列表；输入名字片段（如 `Ahmad`，不分大小写、忽略标点）过滤；点一个成员进入其地块，浏览器「返回」回到列表。
- **屏 3**：点「Tambah tanah」进入。点卡片进取景；点「Langkau」跳过；用「Atau pilih dari galeri」选一张图直接给第一份待拍的文档；三份处理完「Seterusnya」才亮。
- **屏 4**：浏览器会请求摄像头权限。点快门 → 预览 → 「Guna gambar」回屏 3；「Ambil semula」重拍；点「Galeri」选本地图片也先进预览。手电筒按钮只在设备支持时出现。
- **屏 9／10**：三个演示园主刚好是绿、黄、红。`+60100000011`（Tan Ah Kow）：绿色「Semua lulus」，没有事项；`+60100000012`（Ahmad Zaki bin Rosli）：黄色「Hampir siap」，两件事（面积不符、MPOB 执照 58 天后到期），点「Lihat butiran」看屏 10：地契 3.04 ha 对量出的 3.49 ha、`+0.45 ha (15%)`、形状预览；`+60100000013`（Muthu a/l Raman）：红色，4 件事（先显示 3 件，「Lihat semua (4)」展开），森林初筛提示有损失 0.8 ha。外勤选成员 Krishnan a/l Marimuthu 能看到「Perlu semakan pegawai」。
- **屏 11（看板，要用电脑宽屏看）**：用 `+60100000002`（管理员，档案语言 en，所以默认英语，点 🌐 切 BM）登录，屏 2 头部点「Dashboard」进入，或直接打开 `/coop`。统计卡 Green 110／Yellow 50／Red 24／Needs review 16；点左栏 Red 只看红色，勾「Issue type」里的类型（可多选），在 Member 里输入名字片段；点一行（或用 Tab 到行里的按钮按 Enter）看右栏详情；点「Export summary (CSV)」导出**当前筛选后**的表格。园主或外勤打开 `/coop` 只会看到「Halaman ini untuk pentadbir koperasi.」。
- **没有摄像头的电脑**：取景页会显示「Tiada kamera…」并保留相册入口，屏 3／4 仍可用相册走完。
- **离线**：停掉 Firestore 模拟器，屏 2 在 10 秒内转为离线提示并给「Cuba lagi」；模拟器恢复后点它即可重新订阅。

> 手机用局域网 IP 的 **http** 地址访问时，浏览器不开放 `getUserMedia`（需要 HTTPS 或 `localhost`），取景页会提示「只能通过安全连接打开相机」，相册仍可用。真机拍照要走 HTTPS（部署后的 Hosting，或隧道）。

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
src/app/core/                 phone.ts（号码规范化）、plot-status.ts（状态值、图标、色调）、format.ts（面积、日期）、
                              load-state.ts（加载／离线／出错）、people-search.ts（成员搜索）
src/app/core/i18n/            dict.ms.ts / dict.en.ts（词典）、i18n.service.ts（当前语言）
src/app/shared/               跨屏共用的小组件（语言按钮）
src/app/features/<屏>/        每屏一个目录，懒加载：login、plots（屏 2）、new-plot（屏 3、4 与占位）、result（屏 9、10）、coop（屏 11）
src/testing/                  测试替身：fake-facade.ts（假 Firestore）、fake-image.ts（假的图像管线）
scripts/                      emulators.mjs、check-readonly.mjs、check-prod-bundle.mjs
```

- **服务分层**：组件不直接 import `firebase/*`。登录状态只看 `AuthService.user` / `ready`；读数据只通过 `FirestoreReader`。`firebase/*` 只在 `core/firebase/` 下 import：Firestore 的 SDK 只被 `firestore-facade.ts`（及它用的 `timestamps.ts`）引用，随首个用到数据的页面懒加载，不进初始包（拆开前初始包 794 kB，拆开后 351 kB）。
- **订阅写法**（zoneless 下的惯例）：`FirestoreReader` 给**冷** Observable，组件用 `toSignal(...)` 变成 signal，视图才会刷新；组件销毁时 `toSignal` 自动取消订阅，不会泄漏监听。不要在 `subscribe` 回调里直接改普通属性。参考 `features/plots/plots-page.ts`。
- **别把 0 当事实**：`collection$` 带出 `fromCache`。服务器还没确认的空快照不能显示成「0」，要显示加载态，超时（10 秒）转成离线状态。统一用 `core/load-state.ts` 的 `loadState$()`，产出 `loading | offline | error | data` 四态，每个订阅各管各的计时器，「Cuba lagi」重新订阅。
- **只读过滤**：`collection$(path, { where: [{ field, value }] })` 只支持「等于」。这是为了少下载，**不是权限**——`infra/firestore.rules` 现在是「任何登录用户可读全部」，园主改地址栏也能读到别人的数据。规则收紧由队友做（见下方已知限制）。
- **多语言**：词典是两个带类型的对象，`dict.ms.ts` 是基准，`dict.en.ts` 声明为同一个 `Dict` 类型，漏一个键编译就报错。组件用 `inject(I18nService).t`（signal）取词，模板写 `{{ t().plots.title }}`；带参数的文案是函数。新增文案两个文件都要加。语言的取值优先级：本机上次的选择（`localStorage` `kebunsah.lang`）> `users.language`（只认 `ms`／`en`）> 马来语。`<html lang>` 随之同步。
- **草稿只在内存里**：`features/new-plot/draft.service.ts` 保存屏 3 三份文档的状态和照片 Blob，刷新就没了。回到 `/` 会清空并撤销所有预览 URL。
- **图片管线**：`features/new-plot/image.ts`。相册和相机的图都统一重画到 canvas 再编码成 JPEG（质量 0.85，长边 ≤1600px，小图不放大，按 EXIF 方向摆正，输出不含 EXIF／GPS），相册文件 >20 MB 直接拒绝。1600px 对地契上的小字做 OCR 可能偏小，屏 8 读字段前很可能要调大（改 `MAX_LONG_SIDE` 一处即可）。
- **摄像头一定要关**：`camera-page` 在点 ✕、浏览器返回、路由切走、切到后台、授权等待中就离开、轨道被系统结束时，都会停掉所有轨道并撤销预览 URL。
- **环境隔离**：模拟器地址只写在 `environment.development.ts`。`ng build` 默认走生产配置，用 `environment.ts` 换掉开发文件，所以生产产物里没有 `demo-kebunsah`、`127.0.0.1`、端口号；`check:prod-bundle` 把关。线上 Firebase 项目建好后，把 Web 配置填进 `environment.ts`（这些值是公开的，不是密钥）。生产配置为空时 App 不白屏，登录页提示「Perkhidmatan belum disediakan.」。
- **模拟器地址用 `127.0.0.1`，不用 `localhost`**：Windows 优先解析成 `::1`，模拟器绑在 `127.0.0.1`。
- **状态永远是「颜色 + 图标 + 文字」**，状态值只用 `contract/status.md` 的字符串，见 `core/plot-status.ts`。
- **评估结果（屏 9／10）**：读 `plots/{id}/assessments`（读数据层只有等值过滤、没有 orderBy，所以订阅整个子集合，在客户端按 `createdAt` 取**最新一次**，不论状态——最新一次还在跑就如实显示「Sedang disemak」，不拿旧的 done 当结论）。事项的标题、详情、原因、建议由 `gapCode` 在词典（`result.gapText`）里生成，数字从 `ruleResults` 的 `CC-01`（面积）、`CC-02`（天数／日期）的字符串里**严格解析**，认不出就退回不带数字的句子。`features/result/assessment.ts` 里**只声明界面用得到的字段**：`ruleResults[].detail`、`gaps[].description／suggestedAction`、`summaryText`、`evidence`、`errorMessage` 等不声明、不渲染（它们可能含第三人姓名，种子里还是中文占位）。纯逻辑都在 `assessment.ts`／`polygon.ts`，有单元测试。
- 界面文案以马来语为主，说人话、给下一步（企划书 v3「状态与文案规范」）。正文 ≥16px，触控目标 ≥48px。

## 模拟器怎么启动的（为什么不直接 `firebase emulators:start`）

`npm run emulators` 运行 `scripts/emulators.mjs`。原因（都是实测过的）：

1. 根目录 `firebase.json` 没有 `emulators.auth` 时，Auth 模拟器**不会启动**；`firebase.json` 是和队友共管的，这里不改。
2. 独立配置文件里的 `firestore.rules`：相对路径会被判成「在项目目录之外」（项目目录 = 配置文件所在目录），写成别的相对路径则找不到文件，而**找不到时模拟器会静默退回「允许所有读写」**。脚本用绝对路径，并在文件不存在时直接报错不启动。
3. 在 `web/` 里启动，`*-debug.log` 落在 `web/`（已被 `web/.gitignore` 忽略），不污染仓库根。

以后 `firebase.json` 加上 `emulators` 设置，这个脚本就可以退休。

## 已知限制

- **照片不上传、地块不创建**：`contract/api.md` 还没有上传照片和新建地块的请求／响应，前端对 Firestore 只读也不能自己写。屏 3、4 拍的照片只留在本机内存；「Seterusnya」进的是占位页。合同定了再接。
- **没有模糊检测**：屏 4 目前不判断照片糊不糊（原型阶段由后端评估）；`unreadable` 提示只在「图片解码或编码失败」时出现。
- **只有马来语和英文**：企划书里的中文界面不做。词典里的 `needs_review` 标签（「Perlu semakan pegawai」）线框里没有，是临时文案，10/15 的 `fe/polish` 统一。
- **真机相机行为没验证过**：电脑上的 Claude 内置浏览器没有真实摄像头。后置镜头选择、手电筒、iOS Safari 的 `playsinline` 自动播放、权限弹窗，都要在真机（HTTPS）上走一遍。取景流程在自动化里是用注入的假 `getUserMedia` 验证的。
- **`firestore.rules` 过宽**：现在任何登录用户都能读全部集合，包括 `persons` 里的 `icHash`／`icLast4`。屏 2 的角色分流和成员列表只是界面行为，不是授权；规则收紧是队友的事（共管文件）。成员列表读的是 `persons` 的 `fullName`，不显示证件号。
- 首次登录谁来创建 `users/{uid}`、`lastLoginAt` 谁写，合同还没定（见 `seed/README.md` 缺口 10），本次不创建。没有档案的账号，屏 2 显示「Profil anda belum dibuat.」并提供登出。
- **看板（屏 11）用 collection group 读评估**：`collection$('assessments', { group: true })` 一次拿到所有地块的评估，在客户端按 `plotId` 与本合作社的地块（`plots` 按 `coopId` 等值过滤）对上。**代价**：它会把**所有合作社、所有历史评估**下载到浏览器（包括不渲染的字段，如 `ruleResults[].detail` 里的第三人姓名），`persons` 也是整个集合下载（含 `icHash`／`icLast4`，界面不用）。`infra/firestore.rules` 现在是「登录即可读全部」，任何登录用户用开发者工具都读得到别的合作社的数据；规则收紧时 collection group 要单独写规则，评估文档最好自带 `coopId`——请队友在合同里定。「只有管理员能看」只是界面行为。
- **看板的状态以最新评估为准**（与屏 9 同一套规则），屏 2 的卡片用 `plots.status`；种子里两者一致，真实后端若不一致，同一块地在两处可能不同色。看板没有评估的地块是「Belum mula」。
- **看板导出 CSV 是本轮的临时做法**：纯前端生成（当前筛选后的表格；列 Plot、District、Member、Status、Main issue、Updated；**含成员姓名**，不含证件信息、评估说明、地块 id；防公式注入、UTF-8 带 BOM）。合同里的 `GET /api/coop/export` 还是「待定」，定了再换。「Export dossier (PDF)」依赖档案页，现在禁用并写明「Akan datang」；虚线的「Override as pass」是待确认功能，没做。
- **看板没有证件原图**（Storage 里没有照片），右栏只画形状预览（内联 SVG，不是卫星图）。表格 200 行一次渲染，保证 200 行；更多要分页／虚拟滚动。宽屏布局只在内置浏览器里看过，真实大屏未验证。
- **评估文档的形状是种子的临时约定**（camelCase 的 `ruleResults`／`gaps`／`runStatus`，`gapCode` 取 `area_mismatch／expiring／expired／name_mismatch／not_in_mspo／low_confidence／missing_doc`，规则 `result` 取 `pass／warn／fail／needs_review`），`contract/` 里还没有示例。真实后端写入若不同，解析是防御式的：缺字段不崩，未知 `gapCode` 走通用文案；但要请队友把形状补进合同。
- **屏 10 不放会失败的按钮**：「Lukis semula」需要屏 5 的重画和保存多边形的接口，现在**禁用**并写明原因（不能跳到 `/plots/new/map`，那是新建草稿）；上传新文件、确认字段（屏 8）也都还没有，其余事项只给说明。屏 9 上的「Cara mendapatkannya」是进屏 10 看步骤，不是真的去办。线框里虚线的「Hantar ke koperasi」是待确认功能，没做。
- **数字对照取评估时的快照**（`CC-01` 的 `expectedValue`／`actualValue`），可能与 `plots.areaHaComputed` 的当前值不同，所以页面上标了「Disemak pada …」。形状预览是内联 SVG，没有地图底图。
- CI：`infra/cloudbuild/pr.yaml`、`deploy.yaml` 里原来的 `node:20` 满足不了 Angular 22 的 Node 要求，已由 #8 改成 `node:24` 并合并。
- Service worker 只在生产构建注册（`ng serve` 下不注册）；Claude 内置浏览器窗格不允许注册 service worker，实际的离线行为还没在真实浏览器里验证过。
