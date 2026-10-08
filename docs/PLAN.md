# 分工与分支计划（2 人，10/8–10/18）

依据企划书 v3 第 11 章。原型提交截止 **10/18**，内部功能冻结 **10/16**。

## 1. 前端与后端怎么分

| | 前端 | 后端 |
| --- | --- | --- |
| 目录 | `web/`、`seed/` | `api/`、`ai-worker/` |
| 负责 | 手机端屏 1–10；合作社电脑看板；Google Maps 圈地块与面积预览；拍照并直传 Storage；Firebase 登录、Hosting、Firestore 安全规则；导出（浏览器打印 PDF、CSV）；200 个模拟地块；演示视频 | C# API：新建地块、保存多边形、登记文件并发上传网址、开始评估、看板统计；AI 服务：Gemini 抽取、规则核对（面积、有效期、姓名）、Earth Engine 森林初筛、缺口清单、红黄绿定级；Cloud Run、Cloud Tasks、Secret Manager、日志 |
| 写哪些数据 | 只把照片传到 Storage，Firestore 一律只读、实时订阅 | `plots`、`documents`、`titles` 等由 API 写；`assessments`、`gaps` 和 `plots.status` 只由 AI 服务写 |

**交界只有 `contract/`**：4 个接口的请求与响应、状态值（`pending` / `green` / `yellow` / `red` / `needs_review`）、三份示例 JSON（绿、黄、红）。
前端拿示例 JSON 先做界面，后端拿示例数据先跑评估，两边不用互相等。

## 2. 分支规则

- 只有 `main` 是长期分支，`main` 上永远能跑。不直接推 main，一律走 PR。
- 分支前缀：前端 `fe/…`，后端 `be/…`，合同 `contract/…`，冻结后修 bug `fix/…`。
- 一个分支一件事，做完当天合进 main，合完删掉。
- 合并前先 `git pull origin main`，本地跑通再合；用 Squash merge。
- 前端只改 `web/`、`seed/`，后端只改 `api/`、`ai-worker/`。改 `contract/` 或 `infra/` 要对方同意。

## 3. 逐日分支

| 日期 | 前端 | 后端 | 同步点 |
| --- | --- | --- | --- |
| 10/8 四 | `contract/v1`：两人一起定合同 | 同左 | 今晚定完合同（约 2 小时） |
| 10/8 四 | `fe/setup`：Angular 骨架、Firebase 项目、测试号登录 | `be/setup`：API 骨架、Cloud Run 跑通 Hello World | — |
| 10/9 五 | `fe/screens-1-3`：登录、我的地块、拍文件（接示例数据） | `be/gemini-extract`：地契、MSPO、MPOB 抽取，输出带置信度的 JSON | — |
| 10/10 六 | `fe/map-plot`：屏 5–6，圈地块、开始检查 | `be/plot-api`：4 个接口上线、签名网址直传 | 前端接上真实 API |
| 10/11 日 | `fe/assess-result`：屏 7、9，评估中与结果 | `be/rules`：面积、有效期、姓名规则 + 单元测试；写出 `assessments` | 第一次端到端（暂无森林初筛） |
| 10/12 一 | `fe/confirm-issues`：屏 8、10，确认字段与问题详情 | `be/earth-engine`：先让 1 块地查通 | — |
| 10/13 二 | `fe/coop-dashboard`：红黄绿统计、筛选、详情 | `be/grading`：Gemini 解释、缺口清单、定级 | 联调 #1：5 份仿真文件 |
| 10/14 三 | `fe/export-seed`：导出、200 个模拟地块 | `be/stability`：超时、重试、失败降级为 `needs_review` | 必须有端到端，否则停掉「尽量做」 |
| 10/15 四 | `fe/polish`：大字、马来语文案、空状态与错误提示 | `be/accuracy`：修评估误差、固定部署版本 | 联调 #2：按演示脚本彩排 |
| 10/16 五 | 只开 `fix/…` | 只开 `fix/…` | 功能冻结，打标签 `v0.9-freeze` |
| 10/17 六 | 录演示视频；英文提案产品章节 | 英文提案技术章节；补测试 | — |
| 10/18 日 | 检查提交清单 | 复核技术内容 | 提交，打标签 `v1.0-submit` |

第一次端到端跑通时打标签 `v0.1-e2e`。演示前出问题可以直接回到这些标签。

## 4. 卡住了怎么办

- 卡住超过半天，马上叫对方，或按企划书 v3 第 11 章的降级预案处理。
- 每晚 15 分钟对一下：今天合了哪些分支、卡在哪、明天需要对方给什么。
