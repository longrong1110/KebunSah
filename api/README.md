# api：Python FastAPI（后端）

部署到 Cloud Run 服务 `kebunsah-api`（asia-southeast1），评估流水线（`ai-worker/`）在同一进程里异步跑。整体设计见 `docs/superpowers/specs/2026-10-13-backend-design.md`，这一轮的实现计划见 `docs/superpowers/plans/2026-10-17-backend-2-api-pipeline.md`。

## 接口

鉴权：`Authorization: Bearer <Firebase ID token>`。没带或失效 `401`；角色不够或不是自己（自己合作社）的地块 `403`。错误统一 `{"error": {"code": "snake_case", "message": "英文一句话"}}`。

| 接口 | 做什么 |
| --- | --- |
| `POST /api/me` | 首次登录建 `persons` + `users/{uid}`，只能建 `smallholder`；已有档案直接返回并更新 `lastLoginAt` |
| `POST /api/plots` | 建空地块（`pending`）；外勤要带 `memberId` |
| `PATCH /api/plots/{id}` | 多边形或「一个点＋手填面积」；面积（椭球，4 位小数）与质心由后端重算，`polygonGeojson` 存成字符串 |
| `POST /api/plots/{id}/documents` | 登记证件（`land_title`／`mpob_licence`／`mspo_cert`），返回 15 分钟有效的 PUT 网址；同一种证件重拍，旧的 `isCurrent=false` |
| `POST /api/plots/{id}/assess` | 先写一条 `queued` 的评估，回 `202 {assessmentId}`；已有 `queued`／`running` 回 `409`（带那一条的 id），超过 10 分钟的当残留放行 |
| `PATCH /api/documents/{id}/fields` | 屏 8 确认字段：写 `confirmedValue`／`confirmedBy`／`confirmedAt`，不自动重评估；全部通过校验才写 |
| `GET /api/documents/{id}/image` | 15 分钟有效的读取网址 |
| `GET /healthz` | 健康检查 |

评估结果不走接口返回：前端订阅 Firestore 的 `plots/{id}/assessments/*` 和 `plots.status`。形状见 `seed/data/assessments.json`（待合并的合同分支里是 `contract/firestore.md`）。

## 本地跑

```bash
py -3.11 -m venv .venv && .venv\Scripts\activate         # 仓库根目录
python -m pip install -r requirements-dev.txt
python -m pytest                                          # 默认不含 emulator 标记的测试
```

连模拟器跑完整主线（需要 Java 21+ 和 firebase-tools，见 `web/README.md`）：

```bash
cd web && npm run emulators                               # 终端 1：Auth 9099 + Firestore 8080
cd .. && copy .env.example .env                           # 填 GEMINI_API_KEY
python -m uvicorn app.main:create_app_from_env --factory --port 8000    # 终端 2；PYTHONPATH=core;api;ai-worker
python scripts/e2e_local.py                               # 终端 3：用 seed/photos 走完整条主线
python -m pytest -m emulator                              # 对模拟器的集成测试（带点的键、集合组查询、整条流程）
python scripts/gemini_smoke.py --list-models              # 看 key 能用哪些模型
python scripts/gemini_smoke.py                            # 9 张仿真证件照的逐字段准确率（要 key、要花钱）
```

不想起模拟器时设 `STORE_BACKEND=memory`，API 用内存存储（重启就清空）。

## 环境变量

见 `.env.example`。本地和线上用同一份代码，只靠变量切换：`FIRESTORE_EMULATOR_HOST`／`FIREBASE_AUTH_EMULATOR_HOST`（连模拟器）、`BLOBS_MODE=local|gcs`、`STORAGE_BUCKET`、`GEMINI_API_KEY`、`GEMINI_EXTRACT_MODEL`／`GEMINI_EXPLAIN_MODEL`、`CORS_ORIGINS`、`ASSESS_AS_OF`。

## 目录

```
app/            FastAPI：config · errors · store（Store 协议 + 内存实现）· firestore_store · blobs（本地 + GCS 签名网址）
                auth · deps · access · routes_*.py · main（create_app / create_app_from_env）
tests/          TestClient + 内存 Store + 假 token 校验 + 假抽取器；emulator 标记的测试要模拟器
```
