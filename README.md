# KebunSah

帮马来西亚小园主备齐 EUDR 合规材料的 App：拍地契和证照、圈出地块，AI 核对并做毁林初筛，给出红黄绿结果和缺口清单；合作社在电脑看板上看全部地块。

Google Cloud AI Builder Cup 2026 参赛项目。原型提交截止 **2026-10-18**，内部功能冻结 **10/16**。

## 目录与负责人

| 目录 | 内容 | 负责 |
| --- | --- | --- |
| `web/` | Angular PWA：手机端屏 1–10、合作社看板 → Firebase Hosting | 前端 |
| `seed/` | 200 个模拟地块、仿真证件照 | 前端 |
| `api/` | Python FastAPI → Cloud Run `kebunsah-api` | 后端 |
| `ai-worker/` | Gemini 抽取、规则引擎、Earth Engine → Cloud Run `kebunsah-ai` | 后端 |
| `contract/` | 字段、状态值、接口、示例 JSON | 两人共管 |
| `infra/` | Firestore 规则、Cloud Build 流水线 | 两人共管 |

## 队友处理须知

> 前端整理，给负责后端的队友。随进度更新，最后更新 **2026-10-11**；处理完的事项在后面标「✅」。功能冻结 **10/16**，原型提交 **10/18**。

### 一、先做（它们卡住了前端）

| # | 事项 | 前端在等什么 |
| --- | --- | --- |
| 1 | **审 [PR #14](https://github.com/longrong1110/KebunSah/pull/14)**（评估文档形状、鉴权、assess、屏 8 的字段确认；只改 `contract/`），没异议就 Approve。**再审 [PR #23](https://github.com/longrong1110/KebunSah/pull/23)**（新建地块、保存位置与面积、登记文件；堆叠在 #14 上，先审 #14） | 屏 6「开始检查」、屏 8「确认字段」、看板按合作社收紧读取。PR 描述和评论里有前端已按推荐方案定下的 7 件事（原图读取方式、`coopId`、`CC-02` 每份文件一条……），不同意请直接指出，以你们为准 |
| 2 | **定「新建地块 → 传照片」的接口请求与响应**：`POST /api/plots`、`PATCH /api/plots/{id}`（保存多边形）、`POST /api/plots/{id}/documents`（签名上传网址并登记）。前端已在 **#23** 里起草了一版，你改成你们要的就行 | 前端对 Firestore 只读、不能自己发明接口。屏 5（圈地块）已合并（#22），只产出本地草稿、不调接口；屏 6 提交那一步、上传、屏 10 重画全卡在这里 |
| 3 | `PATCH /api/plots/{id}` 里**面积由后端按多边形重算**，前端只传多边形（点模式传点 + 手填面积）。`contract/api.md` 原来写的是前端传 `area_ha_computed`，与 `schema.sql`「不信前端传的数」相矛盾，#23 已改 | 前端据此不传 `area_ha_computed` |
| 4 | **谁创建 `users/{uid}`、谁写 `lastLoginAt`**：uid 必须等于 Firebase Auth 的 uid。线上 Auth 不能预设 uid，要么首次登录由后端建档，要么用 Admin SDK 预建账号 | 前端不创建，现在没有档案的账号首页显示「Profil anda belum dibuat.」 |

### 二、前端按这些假设在读 Firestore（写入时请对齐；不一致就改合同，不要只改代码）

- **字段名 camelCase**；日期列 `YYYY-MM-DD` 字符串，时间戳列用 Firestore Timestamp。
- **`polygonGeojson` 存成 JSON 字符串**：Firestore 拒绝数组套数组（模拟器实测返回 400 `Nested arrays are not allowed`）。`centroidLat`／`centroidLng` 是两个数字。
- **评估文档**（`plots/{id}/assessments/{aid}`）：`runStatus` 依次 `queued`→`running`→`done`／`failed`，**先写 `queued` 和 `createdAt`**，屏 7 的转圈靠它。`ruleResults[]` 里 `CC-01` 写 `"3.0400 ha"`，`CC-02` 写 `"58 hari"` 或以 `YYYY-MM-DD` 开头的已过期字符串，前端**严格解析这几个数**；`detail`、`description`、`suggestedAction`、`citation`、`summaryText`、`errorMessage` 这类说明文字**前端不显示**（可能含第三人姓名），文案由前端按 `gapCode` 自己生成。全部取值表见 `contract/firestore.md`（在 PR #14 里）。
- `plots.status` 和评估结果**只由 AI 服务写**；前端从不写 Firestore，只把照片传到 Storage。
- **`fields{}` 的键含点**（`land_title.lot_no`）：整篇写入没问题，但按字段路径做局部更新时，未转义的点路径会新建一个嵌套的同名键，两种形状并存（模拟器实测）。要转义路径或改键名。
- 看板（屏 11）和导出 CSV、档案（打印成 PDF）现在**全在浏览器里算**，不依赖 `GET /api/coop/dashboard`、`/api/coop/export`、`/api/plots/{id}/report`；这三个做不做由你定，做了前端再换。
- 其余约定和 12 个待对齐的缺口：[`seed/README.md`](seed/README.md)「需要和队友在合同里对齐的缺口」。

### 三、数据库

- App 实际用的数据层是 **Firestore**（企划书第 6–7 章、8.9 节）。本地演示跑 Firebase 模拟器：`cd web && npm run emulators`，再 `cd seed && npm run load` 灌 200 个模拟地块。
- **`contract/schema.sql` 已经建成一个真的 PostgreSQL 16 本地数据库**：`cd seed && npm run db:up`（需要 Docker，端口 5433），`npm run db:check` 跑 7 项约束自检。它是设计图和校验用的，不是 App 读写的库，详见 [`seed/db/README.md`](seed/db/README.md)。
- **线上 Firestore（以及若改用的 Cloud SQL）还没建**：要 GCP／Firebase 项目和账单，需要负责人在控制台创建（区域 `asia-southeast1`）；建好后把 Firebase 控制台给的 Web 配置填进 `web/src/environments/environment.ts`（这些值本来就公开）。
- 上线前：身份证哈希要加服务端秘密值（pepper），`schema.sql` 开头有说明。

### 四、已知的坑和遗留

- **`infra/firestore.rules` 现在是「登录即可读」**：任何登录用户能读全部数据。收紧时 collection group（看板读全部 `assessments`）要单独写规则，所以 PR #14 提议评估文档带 `coopId`。
- **`infra/cloudbuild/pr.yaml` 的后端步骤还是 `dotnet test` 骨架**（`api/` 下没有 `.sln`／`.csproj` 就自动跳过）：后端是 Python，PR 检查实际不会跑你的测试，需要换成 `pytest`。
- **`firebase.json` 还没有 `emulators` 节**（共管文件，前端没动）。前端用 `web/` 里的脚本和一份独立配置起 Auth + Firestore 模拟器，细节和两个路径坑见 [`web/README.md`](web/README.md)「模拟器怎么启动的」；Storage 模拟器还没接。
- **地图用 Google Maps JS 的 Demo key**（官方的免费试用 key，只适合原型，用量上限不明）；Google 的 Drawing Library 已下线，屏 5 自己画多边形（Google 的 `Polygon` + 可拖动 `Marker`）。屏 5 落地后 key 放在 `web/src/environments/`，不是密钥（浏览器端本来就公开），但**上线前要换成限制了 HTTP 来源的正式 key**。
- **姓名相似度算法、`CC-02` 边界**（schema 写「不足 90 天」，企划书写「90 天内」）合同里没定，seed 的取舍见 `seed/README.md`。
- 里程碑标签：`v0.1-e2e`（第一次端到端）、`v0.9-freeze`（10/16）、`v1.0-submit`（10/18）。前后端第一次端到端联调之前，前端屏 5–6 之后的写入路径是空的。

## 怎么协作

完整的前后端分工和逐日分支计划见 [`docs/PLAN.md`](docs/PLAN.md)。

- `main` 永远能跑。不直接推 main，一律走 PR。
- 每人从 main 拉短分支，前端 `fe/…`，后端 `be/…`，合同 `contract/…`，冻结后修 bug `fix/…`。
- 一个 PR 一件事，当天开当天合；用 Squash merge，合并后删分支。
- PR 必须通过 Cloud Build 检查（`infra/cloudbuild/pr.yaml`）。
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

## 本地运行（Firebase 模拟器）

第一次演示全部在本地跑，用 Firebase 模拟器（Auth、Firestore、Storage），不连线上项目。

**前置条件**（每台开发机都要装）：

- Java 11 或更新版本（Firestore 和 Storage 模拟器依赖 Java）
- `firebase-tools`：`npm install -g firebase-tools`，或每次用 `npx firebase-tools`

**现状**：`firebase.json`（共管文件）还没有 `emulators` 设置，所以直接 `firebase emulators:start` 起不来。前端的做法是 `cd web && npm run emulators`（独立配置，目前只起 Auth + Firestore，Storage 还没接，原因见 [`web/README.md`](web/README.md)「模拟器怎么启动的」）。`firebase.json` 补上 `emulators` 之后可以改用下面的命令：

```bash
firebase emulators:start --only auth,firestore,storage
```

## 发布流水线

PR → Cloud Build 检查（`dotnet test`、`ng build`）→ 合并 main → Cloud Build 部署（`infra/cloudbuild/deploy.yaml`）：
镜像推 Artifact Registry，部署两个 Cloud Run 服务，前端发布到 Firebase Hosting。区域 `asia-southeast1`。
