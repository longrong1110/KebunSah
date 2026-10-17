# 后端（乙）设计：API + 评估流水线

> 日期 2026-10-13。负责人：乙（后端）。依据：企划书 v4 第 6–9、11 章，`contract/` 与待审的合同 PR #14（评估文档形状、鉴权、assess、屏 8）、#23（新建地块、保存位置与面积、登记文件）。
> 原型提交 **10/18**，功能冻结 **10/16**；今天 10/13，`api/`、`ai-worker/` 里还没有代码，只剩 10/14、10/15 两个工作日做出端到端。

## 1. 目标与范围

**目标**：一块地从“前端新建、圈地、传照片”到“后端评估完、`plots.status` 变色、前端实时看到缺口清单”，在演示主线上现场跑通；同时让 Gemini 的使用在原型里看得见。

**必做**：鉴权、新建地块、保存多边形/点与面积、登记文件并给上传网址、触发评估、Gemini 抽取、规则 CC-01/02/03、森林初筛、缺口与定级、写回 Firestore。
**尽量做**：屏 8 的字段确认（`PATCH …/fields`）、原图读取网址、`steps[]` 日志。
**本轮不做**：`/api/coop/dashboard`、`/api/coop/export`（前端已在浏览器里算）、`/api/plots/{id}/report`（浏览器打印）、`/api/voice`、向量检索（把几段法规原文放进提示词）、Cloud Tasks、服务端 PDF、沙巴与砂拉越。

## 2. 约束与前提

- 现在**没有任何云资源**：GCP/Firebase 项目、计费、Gemini 权限、Earth Engine 注册都还没有。所以**先全部对着本地模拟器开发**，云端并行去办，切换只靠环境变量。
- 前端对 Firestore **只读**；`plots`、`documents`、`titles` 等由 API 写，`assessments`、`plots.status` 只由评估流水线写（同一个进程，不同模块）。
- 一个 Cloud Run 服务 `kebunsah-api`，评估在进程内异步跑（见 §6）。代码仍分成 `api/`、`ai-worker/`、`core/`，将来要拆成两个服务只改 Dockerfile 和 `deploy.yaml`，接口与合同都不变。

## 3. 代码结构

```
core/          纯 Python，不 import 任何云服务，TDD 的主战场
  rules        CC-01 面积 / CC-02 有效期 / CC-03 姓名 / 置信度；aggregate 定级；deriveGaps
  units        面积换算（ha / sqm / acre / sqft）、日期解析
  geo          多边形面积（椭球）与质心（shapely + pyproj.Geod）
  names        姓名归一化与相似度（rapidfuzz）
  masking      身份证号打码、哈希
  params       rule_params 阈值（law / mpob / team）
api/           FastAPI：鉴权依赖、路由、统一错误格式、CORS
ai-worker/     流水线：extract → normalize → rules → forest → explain → aggregate
pyproject.toml 仓库根目录；pytest 的 pythonpath 指向三个目录
Dockerfile     仓库根目录；镜像带上三个目录（`deploy.yaml` 构建上下文改成仓库根）
```

`api/` 与 `ai-worker/` 目录名带连字符，不能直接当包名，所以各自里面再放一个包（`api/app/`、`ai-worker/worker/`），`core/` 里放 `core/kebunsah_core/`。`CODEOWNERS` 补上 `/core/`，`@TianXian-123`。

### 适配器接口（流水线只依赖它们，测试里换成假的）

| 接口 | 线上 | 开发 / 测试 |
| --- | --- | --- |
| `Store` | Firestore（Admin SDK） | 同，连 `FIRESTORE_EMULATOR_HOST`；单元测试用内存实现 |
| `Blobs` | GCS V4 签名网址（Cloud Run 服务账号签名） | 本地目录，由 API 提供一个仅开发开启的 `PUT /dev/blobs/{path}`，对前端看起来和签名网址一样 |
| `Gemini` | `google-genai`，Vertex 或 AI Studio 由环境变量切换 | AI Studio key；单元测试用假客户端 |
| `Forest` | Earth Engine（`JRC/GFC2020/V4` + `UMD/hansen/global_forest_change_2025_v1_13`） | 预先算好的数据（调不通时的降级，视频里如实说明） |

## 4. 接口

鉴权：`Authorization: Bearer <Firebase ID token>`，`firebase_admin.auth.verify_id_token`（模拟器用 `FIREBASE_AUTH_EMULATOR_HOST`）取 `uid`，再读 `users/{uid}` 得 `role`、`coopId`、`personId`。没带或失效 `401`；角色不够或不是自己（自己合作社）的地块 `403`。错误统一 `{ "error": { "code": "snake_case", "message": "英文一句话" } }`，`message` 前端不显示。

| 接口 | 做什么 |
| --- | --- |
| `POST /api/me` | 首次登录建 `persons` 与 `users/{uid}`，**只能建 `smallholder`**；外勤和管理员由种子或 Admin SDK 预建，角色不能自己申请。已有档案则直接返回 |
| `POST /api/plots` | `{memberId?}` → 建 `plots/{id}`（`status: pending`、`coopId`、`operatorPersonId`）→ `201 {plotId}` |
| `PATCH /api/plots/{id}` | 多边形或一个点＋`areaHaDeclared`（`>0` 且 `<4`）。后端校验闭合、坐标范围，用 `Geod` 重算面积与质心，`polygonGeojson` 存成 JSON 字符串；不自动重评估 |
| `POST /api/plots/{id}/documents` | `{docType, contentType, source}` → 建 `documents/{docId}`，返回 15 分钟有效的 PUT 网址。同一 `docType` 重复登记：旧的 `isCurrent=false`，新的接替 |
| `POST /api/plots/{id}/assess` | 先写 `assessments/{aid}`（`queued`＋`createdAt`），返回 `202 {assessmentId}`；已有 `queued`/`running` 返回 `409`（带那一条的 id） |
| `PATCH /api/documents/{id}/fields` | `{fields: {key: value}}` → 校验 key 与格式 → 写 `confirmedValue`/`confirmedBy`/`confirmedAt`；不自动重评估 |
| `GET /api/documents/{id}/image` | 15 分钟有效的读取网址（Storage 规则不对前端开放读） |

## 5. 评估流水线

```
queued → running
 ① 到 Storage 确认文件到了（→ uploaded）；Gemini 抽取（extracting → extracted / failed / needs_review）
 ② 规范化；写或更新 titles / mpobLicences / mspoCertificates；confirmedValue 优先于 normalizedValue
 ③ 规则 CC-01 / CC-02 / CC-03；置信度 < 0.7 且没确认的字段 → 相关规则 needs_review
 ④ 森林初筛（失败 → forestRisk = unknown → needs_review）
 ⑤ Gemini 写摘要与缺口说明；gapCode / severity 由规则确定，不让模型决定
 ⑥ aggregate：一次写 assessments（done）+ plots.status + lastAssessedAt
```

- **降级**：任何一步异常只降级那一项（该项 `needs_review`，流程继续）。整条流水线崩了：`runStatus: failed`、`errorMessage`、`plots.status: needs_review`。
- **并发与残留**：`assess` 时检查同一地块的 `queued`/`running`；超过 10 分钟没结束的当作残留，改成 `failed` 再放行，避免 Cloud Run 实例被回收后永远 `409`。
- **Gemini**：抽取用 Flash、解释用 Pro（模型 id 放配置，实现时核对当时的稳定版）；Pydantic 作 response schema；每次调用设超时（默认 40 秒），遇 429/5xx 退避重试两次；记录耗时与 token 用量。身份证号读出后立刻打码再入库，哈希加服务端 pepper。
- **提示注入**：证件内容一律当数据不当指令；输出过 schema 校验；字段值进规则前再做格式校验（日期、数字、单位）。
- **日志**：每步一条结构化日志，同时进 Cloud Logging 和评估文档的 `steps[]`（前端不读，视频的“智能体日志”画面用它）；`progress: {read, check, forest, actions}` 也一并写，前端愿意读就读，不读无妨。

### 异步方式

`POST …/assess` 用 FastAPI `BackgroundTasks` 启动流水线并立刻回 202。Cloud Run 部署加 `--no-cpu-throttling`（返回响应后仍保持 CPU），`min-instances=1` 视演示稳定性决定。接口形状不变，将来换成 Cloud Tasks 只改派发那一行。

### 字段键里的点

`documents.fields` 的键含点（`land_title.lot_no`）。流水线写读出值、API 写确认值，都用 `FieldPath("fields", "land_title.lot_no", "confidence")` 转义局部更新，**不改键名**；在 Firestore 模拟器里实测两种写法不会并存。

## 6. 合同上我替前端/合同做的默认决定

1. 评估文档带 `coopId`（来自 `plots.coopId`），为收紧 `firestore.rules` 的 collection group 读取做准备。
2. `CC-02` **每份文件一条**，带 `docType`。`schema.sql` 的 `rule_results` 加一列 `doc_type`（取值同 `gaps.doc_type`，其余规则为 `NULL`），唯一约束从 `UNIQUE (assessment_id, rule_code)` 改成 `UNIQUE INDEX ON (assessment_id, rule_code, COALESCE(doc_type, ''))`。Firestore 里 `ruleResults[]` 本来就没有唯一约束，只是 SQL 设计图要同步。这是对 `contract/schema.sql` 的改动，要单独开 `contract:` PR。
3. `users/{uid}` 由后端 `POST /api/me` 首次登录建档，只能建 `smallholder`；`lastLoginAt` 由 `/api/me` 更新。
4. 上传完成**不用** `object.finalize` 触发器，也不加确认接口：`assess` 时流水线直接去 Storage 看对象在不在（不在即视为没有这份文件，按 `missing_doc` 处理）。
5. CC-01 面积偏小沿用种子的“不判、按通过”；CC-02 边界按 `< 90` 天才警告、到期当天算未过期（与种子一致）；CC-03 取地契各持有人中最像的一位，再与执照、MSPO 名单取最低（与种子一致），不采用“身份证哈希相同即同一人”的捷径。
6. 原图读取走后端的签名读取网址，不给前端开 Storage 读规则；裁剪框 `box` 本轮不写，前端先显示整张图。

## 7. 测试

- **`core/`**：pytest，TDD。规则与定级对 `seed/data/assessments.json` 的 200 个地块做 golden 对照：每块地的 `CC-01`、`CC-03` 结果、`CC-02`（种子里只有“最差的一份”那一条，所以对照时取我方各条中最差的）以及汇总出的 `plots.status` 必须一致；面积与质心对种子多边形做数值对照；姓名相似度用种子样本校准，阈值 0.85 两侧有安全带。
- **`api/`**：FastAPI `TestClient` + 内存 `Store` + 假 token 校验；每个接口覆盖 401/403/404/409/422。
- **集成**：对 Firestore 与 Auth 模拟器的少量测试（`pytest -m emulator`，默认不跑，PR 检查里不跑）；覆盖带点键的局部更新。
- **Gemini 冒烟**：脚本对 `seed/photos` 的 9 张仿真证件照真实抽取，与 `seed/data/documents.json` 的期望字段对照，打印逐字段准确率与耗时；不进 PR 检查（要 key、要钱）。
- **PR 检查**：`infra/cloudbuild/pr.yaml` 的后端步骤从 `dotnet test` 改成 `pytest`（共管文件，需甲 Approve）。

## 8. 排期（10/13 晚起）

| 时间 | 内容 | 产出 |
| --- | --- | --- |
| 10/13 晚 | 审 #14/#23 并写明默认决定；Python 骨架与 Dockerfile；`pr.yaml` 改 pytest；`core/rules` + golden 测试 | 合同可合并；`core/` 绿 |
| 10/14 | 6 个接口（对模拟器）；`Blobs` 本地实现；Gemini 抽取；`POST /api/me` | `v0.1-e2e`（需前端合并 #14/#23 并接上屏 6） |
| 10/15 | 流水线补全：森林、解释、降级、并发残留；Dockerfile 部署（GCP 项目一建好就做）；联调 #2 | 可演示主线；公开网址 |
| 10/16 | 只修 bug；`v0.9-freeze` | 冻结 |
| 10/17–18 | 英文技术提案；补测试；复核提交清单 | `v1.0-submit` |

## 9. 云端待办（需要人去办，不是代码能解决的）

1. **今晚**：在 aistudio.google.com 拿 API key（不用绑卡）→ 放 `.env`（不进仓库）。
2. **尽快**：有人（符合试用资格的那位）建 GCP 项目，区域 `asia-southeast1`，开 Blaze，**立刻设预算告警**。没有它就没有公开网址，提交不了。
3. **同一个项目里**：去 Earth Engine 注册（用途会被审核，越早越好）；调不通就用预先算好的数据。
4. **项目建好当天**：先部署一个健康检查接口，验证：Cloud Run 服务账号对自己的 Token Creator 权限（V4 签名网址要它）、Storage bucket 的 CORS（浏览器 PUT）、API 的 CORS（Hosting 来源）。

## 10. 风险

| 风险 | 应对 |
| --- | --- |
| 10/15 之前没有 GCP 项目 | 排期里把“建项目”放在第一优先；其余全部可在模拟器上先做完，建好当天只剩部署 |
| Gemini 抽取不稳 | 退避重试；低置信度字段交给屏 8 确认；仍失败的文件标 `needs_review`，其余照常评估 |
| Earth Engine 调不通或被判商业 | 预先算好的数据，视频里如实说明 |
| 前端不显示 Gemini 的说明文字（`summaryText`、`description`、`suggestedAction`） | 评委看到的 GenAI 价值主要来自抽取与红黄绿；`steps[]` 日志可做视频画面；和甲商量是否在屏 9/10 或看板里显示摘要。不挡开工 |
| 评估超过 2 分钟 | 同一份文件的抽取并行跑；森林查询与抽取并行；界面照常“评估中” |
| 带点的键、嵌套数组等 Firestore 限制 | 用 `FieldPath`；`polygonGeojson` 存字符串；单元测试覆盖 |
