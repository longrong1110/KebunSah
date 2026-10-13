# KebunSah

帮马来西亚小园主备齐 EUDR 合规材料的 App：拍地契和证照、圈出地块，AI 核对并做毁林初筛，给出红黄绿结果和缺口清单；合作社在电脑看板上看全部地块。

Google Cloud AI Builder Cup 2026 参赛项目。原型提交截止 **2026-10-18**，内部功能冻结 **10/16**。

## 目录与负责人

| 目录 | 内容 | 负责 |
| --- | --- | --- |
| `web/` | Angular PWA：手机端屏 1–10、合作社看板 → Firebase Hosting | 前端 |
| `seed/` | 200 个模拟地块、仿真证件照、本地 PostgreSQL（`seed/db`，设计图落地，App 不读它） | 前端 |
| `api/` | Python FastAPI → Cloud Run `kebunsah-api` | 后端 |
| `ai-worker/` | Gemini 抽取、规则引擎、Earth Engine → Cloud Run `kebunsah-ai` | 后端 |
| `contract/` | 字段、状态值、接口、示例 JSON | 两人共管 |
| `infra/` | Firestore 规则、Cloud Build 流水线 | 两人共管 |
| `docs/` | 分工与分支计划（`docs/PLAN.md`） | 两人 |

## 队友处理须知

> 前端整理，给负责后端的队友。最后更新 **2026-10-14**。功能冻结 **10/16**，原型提交 **10/18**。
> **要做的事（先做什么、卡在哪、已知的坑）都在下面「系统还没做的」里**，这里只放前端对 Firestore 的假设、数据库现状和要付费的云服务。

### 一、前端按这些假设在读 Firestore（写入时请对齐；不一致就改合同，不要只改代码）

- **字段名 camelCase**；日期列 `YYYY-MM-DD` 字符串，时间戳列用 Firestore Timestamp。
- **`polygonGeojson` 存成 JSON 字符串**：Firestore 拒绝数组套数组（模拟器实测返回 400 `Nested arrays are not allowed`）。`centroidLat`／`centroidLng` 是两个数字。
- **评估文档**（`plots/{id}/assessments/{aid}`）：`runStatus` 依次 `queued`→`running`→`done`／`failed`，**先写 `queued` 和 `createdAt`**，屏 7 的转圈靠它。`ruleResults[]` 里 `CC-01` 写 `"3.0400 ha"`，`CC-02` 写 `"58 hari"` 或以 `YYYY-MM-DD` 开头的已过期字符串，前端**严格解析这几个数**；`detail`、`description`、`suggestedAction`、`citation`、`summaryText`、`errorMessage` 这类说明文字**前端不显示**（可能含第三人姓名），文案由前端按 `gapCode` 自己生成。全部取值表见 `contract/firestore.md`（在 PR #14 里）。
- `plots.status` 和评估结果**只由 AI 服务写**；前端从不写 Firestore，只把照片传到 Storage。
- **`fields{}` 的键含点**（`land_title.lot_no`）：整篇写入没问题，但按字段路径做局部更新时，未转义的点路径会新建一个嵌套的同名键，两种形状并存（模拟器实测）。要转义路径或改键名。
- 看板（屏 11）和导出 CSV、档案（打印成 PDF）现在**全在浏览器里算**，不依赖 `GET /api/coop/dashboard`、`/api/coop/export`、`/api/plots/{id}/report`；这三个做不做由你定，做了前端再换。
- **姓名相似度算法、`CC-02` 边界**（schema 写「不足 90 天」，企划书写「90 天内」）合同里没定，seed 的取舍见 [`seed/README.md`](seed/README.md)。
- 其余约定和 12 个待对齐的缺口：[`seed/README.md`](seed/README.md)「需要和队友在合同里对齐的缺口」。

### 二、数据库

- App 实际用的数据层是 **Firestore**（企划书第 6–7 章、8.9 节）。本地演示跑 Firebase 模拟器：`cd web && npm run emulators`，再 `cd seed && npm run load` 灌 200 个模拟地块。
- **`contract/schema.sql` 已经建成一个真的 PostgreSQL 16 本地数据库**：`cd seed && npm run db:up`（需要 Docker，端口 5433），`npm run db:check` 跑 7 项约束自检。它是设计图和校验用的，不是 App 读写的库，详见 [`seed/db/README.md`](seed/db/README.md)。
- **线上 Firestore（以及若改用的 Cloud SQL）还没建**：要 GCP／Firebase 项目和账单，需要负责人在控制台创建（区域 `asia-southeast1`；哪些要付费、怎么选见下面「三、要付费或要账号的云服务」）；建好后把 Firebase 控制台给的 Web 配置填进 `web/src/environments/environment.ts`（这些值本来就公开）。
- 上线前：身份证哈希要加服务端秘密值（pepper），`schema.sql` 开头有说明。

### 三、要付费或要账号的云服务（请两人一起定）

> 数字取自官方页面（2026-10-12 读的，价格会变，**以控制台和官方页面为准**）：[Firebase 定价](https://firebase.google.com/pricing)、[Google Cloud 免费试用与免费额度](https://docs.cloud.google.com/free/docs/free-cloud-features)。**提交要求「可运行原型部署在 Cloud Run 或 Firebase，附公开可访问网址」，并且要用 Gemini／Gemma 或 Google 智能体平台**——所以只在本机跑的方案满足不了提交，只能用于开发和第一次演示。

| 服务 | 免费吗 | 要绑卡吗 | 我们拿它做什么 |
| --- | --- | --- | --- |
| **Firebase Spark** | 免费。Firestore 存 1 GiB、每天读 5 万／写 2 万；Hosting 存 10 GB、每天传输 360 MB | 不要 | 前端 Hosting、Firestore（200 个模拟地块绰绰有余） |
| **Firebase Blaze** | 包含 Spark 的免费额度，超出才计费；合格的新用户有 $300 试用金 | **要** | Spark **没有**的下面这些都要它：Cloud Storage、Cloud Functions、手机号短信登录 |
| **Google Cloud 试用** | $300、90 天，不扣费 | **要**（只做 $0–1 预授权）。资格：从没付过费给 Google Cloud、Google Maps Platform 或 Firebase | 开通 Blaze 和计费账号的最现实方式 |
| **Cloud Run**（`kebunsah-api`、`kebunsah-ai`） | 每月 200 万次请求、36 万 GB 秒内存、18 万 vCPU 秒 | **要**计费账号 | 后端 API 与 AI 服务；Cloud Build 每月 2,500 分钟、Artifact Registry 0.5 GB、Secret Manager 6 个版本也在免费额度内 |
| **Cloud Storage**（证件照） | Blaze 上有免费额度，但**只覆盖美国三个区域**（us-central1／us-west1／us-east1）；放 `asia-southeast1` 要按量付费，几十张照片费用很小但不是零 | 要（Blaze） | 存证件照（前端用签名网址或约定路径上传） |
| **手机号短信 OTP** | Spark 上不可用，按发送的短信计费 | 要（Blaze） | 登录。可用 Firebase 控制台的「测试手机号」（固定验证码、不发短信）绕开；**前端没在 Spark 上验证过** |
| **Gemini**（评估必需） | Vertex AI 的免费额度页面没给数字；AI Studio 的 Gemini API 有免费档，页面没给数字，且**试用金不能付 AI Studio 的费用** | Vertex AI 要计费账号 | 读证件照、解释、定级。走 Vertex AI 还是 AI Studio 请后端定 |
| **Earth Engine** | **前端没查** | ？ | 森林初筛。请后端确认注册方式与费用 |
| **Google Maps** | 现在用官方 Demo key：免费、免绑卡，但**只适合原型**，用量上限不明 | 正式 key 要计费账号 | 屏 5 的卫星图。上线前要换成限制了 HTTP 来源的正式 key |

**请两人一起定的事**（前端的倾向写在后面，不同意就改）：

1. **谁出卡、谁建 Firebase／GCP 项目**：倾向用符合试用资格的那位建项目、开 Blaze、**立刻在控制台设预算告警**；区域 `asia-southeast1`。没有这一步，后端上不了 Cloud Run，提交的公开网址也就没有。
2. **证件照存哪**（前端不能写 Firestore，所以照片不论存哪，都是后端写或签名网址直传）：
   - **A. Cloud Storage（倾向）**：要 Blaze，费用很小；照片不进 Firestore 文档，屏 7／看板订阅文档时不会把图片拉下来。
   - **B. 照片转 base64 存 Firestore（Spark 可用，不推荐）**：Firestore 单个文档上限 1 MiB，base64 比原图大约三分之一。模拟证件照 250–420 KB（转 base64 约 330–560 KB），真手机拍的往往更大，可能超限；而且要由后端写入（前端不能写），还是要有后端——Cloud Run 要计费账号，**省不下那张卡**。若坚持，要放在单独的集合里（如 `documentImages/{docId}`，不要和被订阅的 `documents` 放一起），并限制图片尺寸。
   - **C. 只在本机跑（Firebase 模拟器，含 Storage 模拟器）**：零成本，开发和第一次演示够用，但**满足不了提交要求的公开网址**。App 读写的是 Firestore 模拟器，不是 `seed/db` 里的 PostgreSQL（那个是设计图落地，没接进 App）。
3. **手机号 OTP 怎么登录**：测试手机号（不发短信，零成本，演示够用）还是真实短信（要 Blaze）。
4. **Gemini 走 Vertex AI 还是 AI Studio**（后端定），以及 Earth Engine 的注册。
5. **正式 Maps key**：谁的项目、限制哪些来源。

## 系统还没做的（交接清单，按优先度）

> 2026-10-14 整理。前端负责人 10/15 起不在（回来日期待补）。**只列系统还没做的**；已做完的见上面的「队友处理须知」和 `web/README.md`。
> **现状一句话：** 前端「读」的流程全部做完（登录、我的地块、拍文件、圈地块、评估中、结果、问题详情、合作社看板、导出档案），数据来自本地 Firebase 模拟器里的种子；**「写」的路径整条没通**——新建地块、传照片、开始评估，因为后端没有代码、合同 #14／#23 没人审、没有线上项目。
> 时间：10/16 功能冻结，10/18 提交（要求公开可访问网址，并用 Gemini／Gemma）。

### P0：演示和提交的系统必需

| # | 事项 | 现状与做法 | 谁 | 依赖 |
| --- | --- | --- | --- | --- |
| 1 | **后端 API 与 AI 服务** | `api/`、`ai-worker/` 只有 README。要做：`POST/GET /api/plots`、`PATCH /api/plots/{id}`、`POST /api/plots/{id}/documents`、`POST /api/plots/{id}/assess`；Gemini 抽取（三种文件，带置信度）、规则引擎（面积 CC-01、有效期 CC-02、姓名 CC-03）、写出 `assessments`／`gaps`／`plots.status`。**时间不够的最低限度版本**：一个脚本把 `seed/photos/` 的仿真证件照交给 Gemini 抽取、核对规则、写出评估，先让「用了 Gemini」成立 | 队友 | 合同 #14／#23 |
| 2 | **审并 Approve [#14](https://github.com/longrong1110/KebunSah/pull/14)、[#23](https://github.com/longrong1110/KebunSah/pull/23)** | 无回应。#14 是评估文档形状、鉴权、`assess`、屏 8 字段确认；#23 是建地块、保存位置与面积、登记文件，堆叠在 #14 上，先审 #14。不同意的地方直接在 PR 里改，以你们为准 | 队友 | — |
| 3 | **线上项目与部署（公开网址）** | 没有 Firebase／GCP 项目。要：建项目开计费（哪些要钱见上面「三、要付费或要账号的云服务」）、开 Firestore／Auth／Storage、`web/src/environments/environment.ts` 填 Firebase Web 配置和正式 Maps key、Hosting 发布前端、Cloud Run 发布 `kebunsah-api`／`kebunsah-ai`、把 `seed/` 灌进线上 Firestore（要服务账号，**不进仓库**） | 有卡的人开通计费账号；**Hosting 部署归接手前端的人**（`docs/PLAN.md` 里 Hosting 归前端），Cloud Run 归后端 | 上面「三」里的决定 |
| 4 | **前端接线：屏 6 本体、建地块、上传、开始评估** | 现在屏 6 只是壳（`web/src/app/features/new-plot/review-placeholder.ts`）。批准后要做：建地块 → `PATCH` 保存屏 5 的多边形／点（草稿已在 `DraftService`，面积由后端重算）→ 每份文件取签名网址并 `PUT` 直传 → `POST /assess` → 跳屏 7（`/plots/:id/checking` 已有）；加载态和错误态；屏 9 里「Belum mula」状态补「开始检查」按钮。**粗估 1 天** | 前端接手人 | #1、#2 |
| 5 | **端到端联调** | 用 5 份仿真证件照跑完整链路（联调 #1），再按演示脚本彩排（联调 #2）；跑通打标签 `v0.1-e2e` | 两人 | #1、#4 |

### P1：强烈建议

| # | 事项 | 备注 |
| --- | --- | --- |
| 6 | **收紧 `infra/firestore.rules`**（若用 Storage 还要 `storage.rules`） | 现在任何登录用户都能读全部集合，包括 `persons` 的 `icHash`／`icLast4`。至少改成只能读本合作社；看板用 collection group 读评估，所以评估文档要带 `coopId`（#14 的提议）。`docs/PLAN.md` 把 Firestore 规则归在前端名下，但它是共管文件，改动要对方 Approve（两人共审） |
| 7 | **接上 PR 检查（Cloud Build）** | `infra/cloudbuild/pr.yaml` 的后端步骤还是 `dotnet test`，后端是 Python，要换成 pytest；GitHub 上 PR 页面现在看不到任何检查 |
| 8 | **谁创建 `users/{uid}`、谁写 `lastLoginAt`** | 前端只读，只能是后端；线上 Auth 不能预设 uid（首次登录建档或用 Admin SDK 预建）。现在没有档案的账号首页显示「Profil anda belum dibuat.」 |
| 9 | **森林初筛（Earth Engine）** | 先让 1 块地查通；1–2 块演示地块的坐标要落在真实有森林变化的区域，种子里的森林数据只是占位 |
| 10 | **换正式 Maps key** | 现在是 Google Demo key，只适合原型，用量上限不明；限制 HTTP 来源（`localhost:4200` 和 Hosting 网址），只开 Maps JavaScript API |
| 11 | **真机验证（只能人手做）** | 屏 3／4／5 的相机、手电筒、触摸、双指缩放、定位权限、iOS Safari；看板真实大屏；档案打印预览（取消「页眉和页脚」）。手机访问本机要 HTTPS 或隧道；步骤和逐条清单见 [`docs/real-device-testing.md`](docs/real-device-testing.md) |
| 12 | **屏 10「重画」** | 现在禁用。批准 #23 后改成进入重画（带 plotId，复用屏 5 的页面）＋ `PATCH` 保存，粗估 2–3 小时 |
| 13 | **`firebase.json` 加 `emulators`**（共管文件） | 加了之后 `web/scripts/emulators.mjs` 可以退休；现在只起 Auth＋Firestore，Storage 模拟器没接 |

### P2：有空再做，可砍

- **屏 8 确认字段**（只显示读不准的、可直接改）：要 `PATCH /api/documents/{id}/fields`（#14 的提议）。粗估约 1 天
- **看板里的证件原图与地图并排**：现在只有形状预览。要先定原图怎么读（#14：后端给 15 分钟签名读取网址，还是 `storage.rules` 放行），并且 Storage 里要有照片
- `GET /api/coop/dashboard`、`/api/coop/export`、`/api/plots/{id}/report`：前端已在浏览器里算统计、导出 CSV 和档案，**不依赖它们**，做不做由后端定
- 屏 9 的「Hantar ke koperasi」、看板的「Override as pass」：线框里的虚线建议功能，没做，要先确认要不要
- 把 200 个模拟地块也灌进本地 PostgreSQL（现在只有 `schema.sql` 自带的 3 个）；屏 7 与档案页共用的 `dossierState` 小清理；屏 1／4 的无障碍审计；清理已合并的旧分支和 `.gitignore` 加 `*-debug.log`

### 写这些之前需要先定的（括号里是前端的默认）

| 决定 | 默认 | 影响 |
| --- | --- | --- |
| 谁出卡建项目、开不开 Blaze | 符合 $300 试用资格的那位，立刻设预算告警 | #3 |
| 证件照存哪 | Cloud Storage（不用 base64 存 Firestore） | #3、#4、P2 原图 |
| 手机号 OTP | 测试手机号，不发真短信 | #3 |
| Gemini 走 Vertex AI 还是 AI Studio | 后端定 | #1 |
| #14 里前端已定的 7 件事（原图读取、`coopId`、`CC-02` 每份文件一条……） | 同意 | #1、#6 |
| 上传完成后谁通知后端 | Storage 的 `object.finalize` 触发（#23 的建议） | #1、#4 |

**别在 #14／#23 批准前写调用后端接口的前端代码**，合同还会变。

## 演示视频计划（3 分钟）

> 依据企划书第 12 章，按前端现在**真的做出来了什么**改写。官方要求：约 3 分钟、**英文**、上传 YouTube／Vimeo／公开 Google Drive，要看得出用了 Gemini，并标明问题陈述 Sustainability & Social Impact。录制排在 **10/17（六）**，10/15 联调 #2 先按这份彩排。故事线：问题 → 园主体验 → 智能体幕后 → 合作社视角 → 影响。

### 画面时间表

| 时间 | 画面 | 旁白要点（英文录制） | 现在能录吗 |
| --- | --- | --- | --- |
| 0:00–0:25 | 油棕园实景（无版权素材）＋ EUDR 倒计时字幕 | 没有地块证明的棕榈油进不了欧盟；小园主最难准备 | ⚠ 缺实景素材（谁找？） |
| 0:25–1:10 | **手机竖屏（375×812 的手机框），马来语界面**：登录 `+60100000012`（Ahmad Zaki）→ 屏 2「Tambah tanah」→ 屏 3 拍三份文件 → 屏 5 在卫星图上圈出地块（缩放到 4.325, 101.162 的 Kampar 附近），徽标显示面积 | 不用打字、不懂英文，两分钟完成；GPS 走角点是备选 | ✅ 屏 3／5 都能录。屏 3 的照片用 `seed/photos/` 的仿真证件照从相册选；真机拍摄要 HTTPS，没验证过 |
| 1:10–1:50 | **分屏**：左边屏 7「评估中」四步清单自己往下走；右边智能体执行日志逐步出现 | 读取手写地契、发现面积不符、查询卫星森林数据、检索法规 | ⚠ 左半边能录（先用模拟器 REST 把黄色地块的 `runStatus` 改成 `running` 再改回 `done`，命令见 `web/README.md`）；**右半边要后端真实日志，现在没有**。没有就不录这一半，**不伪造日志** |
| 1:50–2:20 | **屏 9 结果**（黄色「Hampir siap」，两件事）→ 点「Lihat butiran」进**屏 10**：地契 3.04 ha 对量出的 3.49 ha（+0.45 ha，15%）；MPOB 执照 58 天后到期，建议去哪里、带什么 | 缺口清单、办理步骤用马来语给，不说「识别失败」 | ✅ 种子里的黄色演示地块。注意：企划书原稿讲的是「缺 MPOB 执照副本」，种子里实际是**面积不符＋执照将到期**，旁白按实际讲 |
| 2:20–2:45 | **合作社看板（电脑宽屏 1280×720，英文）**：登录 `+60100000002` → `/coop`，统计卡 Green 110／Yellow 50／Red 24／Needs review 16，点 Red 筛选、选一行 → 「Export dossier (PDF)」→ 浏览器打印预览 | 200 个地块红黄绿一目了然；一键生成档案。**不要说「代表成员提交」**（「Hantar ke koperasi」没做） | ✅ |
| 2:45–3:00 | 架构图＋扩展地图（印尼、泰国、咖啡、可可）＋公开网址 | 从马来西亚出发，同一套方法服务所有 EUDR 商品 | ❌ 英文版架构图和扩展地图还没做；公开网址要等部署 |

### 录制前清单

- [ ] 起模拟器并灌数据（`web/README.md` 的「从零到进入『我的地块』」）；**种子的基准日是 2026-10-09，演示日在前后 10 天内各地块状态才不变——10/19 以后「58 天后到期」之类的数字会漂，要在 10/18 前录完**
- [ ] **屏 5 的地图要联网，用的是 Google 的 Demo key（用量上限不明）**：录制前一天别反复刷地图，录制当天先试一次确认地图出来；备选是 Leaflet＋Esri（没做成品，只验证过可行）
- [ ] 画面里的数据一律标明是模拟的：证件照自带「SIMULATED / CONTOH」水印，视频再加一行英文字幕「Simulated data」（企划书 §8.10 的要求）
- [ ] 手机段用马来语（浏览器 localStorage 里 `kebunsah.lang` 清掉或设 `ms`），看板段切英语；旁白和字幕一律英文
- [ ] 窗口尺寸：手机段 375×812，看板段 1280×720；关掉书签栏、控制台、开发模式提示
- [ ] 打印预览里**取消勾选「页眉和页脚」**（否则 PDF 会印出带地块 id 的网址）
- [ ] 旁白单独录（英文），画面分段录、剪辑拼接；背景音乐用无版权的
- [ ] 视频传到 YouTube／Vimeo／公开 Google Drive，**换一个没登录的浏览器确认能打开**

### 要提前定的事

1. **真实端到端**：原定 10/14 的检查点已过，截至 2026-10-14 后端没有代码，端到端未达成。**默认走「分段拼接」**：屏 5 画完边界，直接切到已有的黄色结果，**旁白不要说「刚上传的这份被评估了」**——评委看到的每一幕都要是真的做出来的；后端若赶上，再换成真实链路。
2. **森林初筛画面**：种子里的森林数据是演示占位（`forestDataset` 为空），1–2 个坐标落在真实有森林变化的区域要等 Earth Engine 联调。没有真实数据就别说「卫星检测到毁林」，只说「初筛」。
3. **谁找实景素材、谁配音、谁剪辑**（待定）。
4. **英文版架构图和扩展地图**（企划书第 6 章的图要翻成英文）。

## 怎么协作

完整的前后端分工和逐日分支计划见 [`docs/PLAN.md`](docs/PLAN.md)。

- `main` 永远能跑。不直接推 main，一律走 PR。
- 每人从 main 拉短分支，前端 `fe/…`，后端 `be/…`，合同 `contract/…`，冻结后修 bug `fix/…`。
- 一个 PR 一件事，当天开当天合；用 Squash merge，合并后删分支（远程现在还留着一批已合并的旧分支，可以批量清掉；`contract/assessment-shape` 和 `contract/plot-write` 还在等审，别删）。
- PR 检查（Cloud Build，`infra/cloudbuild/pr.yaml`）是目标，**目前还没接到 GitHub**；现在靠作者本地跑检查（前端：`cd web && npm run verify`）。
- 改 `contract/` 或 `infra/` 要对方 Approve；只改自己目录的 PR 检查绿了就自己合。
- 合同先改、代码后改：动字段或接口，先开只改 `contract/` 的 PR。
- 密钥不进仓库：Gemini 走 Cloud Run 服务账号，其他密钥放 Secret Manager。
- 里程碑打标签：`v0.1-e2e`（第一次端到端）、`v0.9-freeze`（10/16）、`v1.0-submit`（10/18）。

```bash
git switch main && git pull
git switch -c fe/screens-1-3
# …改代码…
git add . && git commit -m "web: 屏 1 手机号 OTP 登录"
git push -u origin fe/screens-1-3
gh pr create --fill
```

## 本地运行前端（Firebase 模拟器）

第一次演示全部在本地跑，用 Firebase 模拟器，不连线上项目，**不需要 `.env`、不需要改任何配置**。完整说明、测试账号、常见问题见 [`web/README.md`](web/README.md)。

**前置条件**（每台开发机都要装）：

| 项 | 要求 |
| --- | --- |
| Node | `^22.22.3`、`^24.15` 或 `>=26`（Node 20 或旧版 22 会 `npm install` 失败） |
| Java | 11 或更新（Firestore 模拟器依赖 Java） |
| `firebase-tools` | `npm install -g firebase-tools`（提供 `firebase` 命令） |
| 网络 | 屏 5 的 Google 地图在线加载；Maps 的 Demo key 已在 `web/src/environments/environment.development.ts` 里，不用另配 |
| Docker | **可选**：只有想起本地 PostgreSQL（`seed/db`）才要，App 不依赖它 |

**启动**（三个终端，按顺序）：

```bash
cd web && npm install && npm run emulators     # 终端 1：Auth(9099) + Firestore(8080)，别关
cd seed && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run load   # 终端 2：灌数据、建测试账号
cd web && npm start                            # 终端 3：http://localhost:4200
```

PowerShell 设环境变量：`$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; npm run load`。

**登录**：模拟器不发短信，验证码从模拟器取（PowerShell 里用 `curl.exe`）：

```bash
curl http://127.0.0.1:9099/emulator/v1/projects/demo-kebunsah/verificationCodes
```

测试手机号：`+60100000011`／`12`／`13` 是园主（绿／黄／红），`+60100000001` 是外勤，`+60100000002` 是合作社管理员（看板 `/coop`，要电脑宽屏）。

**注意**：

- 用 `npm run emulators`，**不要**直接 `firebase emulators:start`：`firebase.json`（共管文件）没有 `emulators` 设置，直接启动 Auth 起不来；`npm run emulators` 用独立配置绕过（原因见 `web/README.md`「模拟器怎么启动的」）。目前只起 Auth＋Firestore，Storage 模拟器没接。
- **模拟器一重启，数据和账号全清空**，要重新跑 `npm run load`；浏览器里残留的旧登录会被当成未登录。
- 屏 4 要摄像头，电脑没有就走相册（仿真证件照在 `seed/photos/`）；屏 5 的地图要在**可见的**浏览器窗口里才会正常显示。
- 一次跑完只读检查、构建、产物检查和全部测试：`cd web && npm run verify`。
- 现在能跑通的是「读」的全部流程；建地块、上传、开始评估要等后端和合同（见上面「系统还没做的」）。

## 发布流水线

PR → Cloud Build 检查（**目前没接到 GitHub**；`pr.yaml` 的后端步骤还是 `dotnet test` 骨架，后端是 Python，要换成 pytest；前端是 `ng build`）→ 合并 main → Cloud Build 部署（`infra/cloudbuild/deploy.yaml`）：
镜像推 Artifact Registry，部署两个 Cloud Run 服务，前端发布到 Firebase Hosting。区域 `asia-southeast1`。
