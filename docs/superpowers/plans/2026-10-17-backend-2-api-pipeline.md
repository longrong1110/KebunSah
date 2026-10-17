# 后端计划 2：API 与评估流水线（竖切）Implementation Plan

> 依据 `docs/superpowers/specs/2026-10-13-backend-design.md`（§3–§7）和合同提议分支 `contract/assessment-shape`、`contract/plot-write`（`contract/firestore.md`、`contract/api.md`）。
> 与计划 1 的 `core/` 衔接：`evaluate_plot(PlotFacts, critical, as_of, params)`。
> **这份计划写于 10/17，原型 10/18 提交，所以只做能让主线端到端跑通的最小竖切**；每个任务自带测试，按顺序做，任务结束都提交。

**Goal:** 一块地从「建地块 → 存多边形 → 登记并上传证件 → 触发评估」到「Gemini 抽取 → 规则 → 定级 → 写回 `assessments` 与 `plots.status`」在本地（内存 / 模拟器）跑通，并留好上云的开关。

**Architecture:** FastAPI 应用通过 `create_app(Deps)` 组装依赖（`Store`、`Blobs`、`TokenVerifier`、`Extractor`、`Explainer`、`Forest`、`Settings`），测试里全部换成假的。评估流水线 `worker.pipeline.run_assessment` 是同步函数，由 `BackgroundTasks` 在响应之后调用；抽取并行用线程池。`core/` 不 import 云服务。

**Tech Stack:** Python 3.11、FastAPI、pydantic v2、firebase-admin（Auth + Firestore）、google-cloud-storage（V4 签名网址）、google-genai、pytest + httpx `TestClient`。

## Global Constraints

- 前端对 Firestore 只读；`plots`、`documents`、`assessments`、`plots.status` 只由本服务写。
- 错误统一 `{"error": {"code": "snake_case", "message": "英文一句话"}}`；401 没带 / 失效，403 角色不对或不是自己的（自己合作社的）地块。
- 字段键含点（`land_title.lot_no`）：局部更新一律用 `Store.update_nested(path, (“fields”, key, “confidence”), value)`（Firestore 里是 `FieldPath`），不改键名。
- `polygonGeojson` 存 JSON 字符串；点模式 `areaHaDeclared` 必须 `0 < x < 4`；多边形面积由后端 `core.geo.parse_polygon` 重算（4 位小数）。
- `confirmedValue` 优先于 `normalizedValue`；置信度 < 0.70 且没确认 → 相关规则 `needs_review`（`core` 已实现）。
- Gemini：证件内容当数据不当指令；输出过 Pydantic schema；字段值进规则前再做格式校验；每次调用超时 40 秒，429/5xx 退避重试两次。
- 身份证号：本轮**不抽取**（规则用不到；少一份个人信息进库）。
- 评估并发：同一地块已有 `queued`/`running` → 409；超过 10 分钟没结束的当残留，改 `failed` 再放行。
- 环境变量切换线上 / 本地，代码不分叉：`FIRESTORE_EMULATOR_HOST`、`FIREBASE_AUTH_EMULATOR_HOST`、`BLOBS_MODE=local|gcs`、`GEMINI_API_KEY`、`HASH_PEPPER` 等。

## File Structure

```
api/app/
  config.py        Settings.from_env()
  errors.py        ApiError、统一错误处理
  store.py         Store 协议 + MemoryStore（测试 / 无模拟器时用）
  firestore_store.py  FirestoreStore（Admin SDK）
  blobs.py         Blobs 协议 + LocalBlobs + GcsBlobs
  auth.py          TokenVerifier、FirebaseTokenVerifier、current_user 依赖
  deps.py          Deps 容器
  routes_me.py / routes_plots.py / routes_documents.py / routes_dev.py
  main.py          create_app(deps)；app = create_app_from_env()
ai-worker/worker/
  fields.py        每种证件的字段键与规范化（日期、面积、单位、姓名）
  gemini.py        Extractor 协议、GeminiExtractor、提示词、schema
  explain.py       Explainer 协议、TemplateExplainer、GeminiExplainer
  forest.py        Forest 协议、PrecomputedForest
  facts.py         从 documents / plot / persons / mspo 查询拼出 PlotFacts + critical
  pipeline.py      run_assessment(...)
tests: api/tests/test_api_*.py  ai-worker/tests/test_worker_*.py
Dockerfile、infra/cloudbuild/pr.yaml（改 pytest）、contract/schema.sql（rule_results.doc_type）
```

---

### Task 1: 依赖、骨架、错误格式、Store

**Files:** `requirements.txt`、`requirements-dev.txt`、`pyproject.toml`、`api/app/{__init__,config,errors,store}.py`、`api/tests/test_api_store.py`

**Interfaces — Produces:**
```python
class Store(Protocol):
    def get(self, path: str) -> dict | None
    def set(self, path: str, data: dict) -> None                       # 整篇替换
    def update(self, path: str, data: dict) -> None                    # 顶层字段合并，文档必须存在
    def update_nested(self, path: str, field_path: tuple[str, ...], value: Any) -> None
    def list(self, collection: str, where: Sequence[tuple[str, str, Any]] = ()) -> list[tuple[str, dict]]  # (doc_id, data)
    def find_in_group(self, group: str, doc_id: str) -> tuple[str, dict] | None   # (完整路径, data)
```
- [ ] 测试：MemoryStore 的 get/set/update/list(where `==`/`in`)/find_in_group；`update_nested` 对含点的键只改那一个键，不产生并存的嵌套键。
- [ ] 实现 → 通过 → 提交。

### Task 2: 鉴权与 `POST /api/me`

**Interfaces — Produces:** `User(uid, role, coop_id, person_id)`；`TokenVerifier.verify(token) -> dict`（含 `uid`、可选 `phone_number`、`name`）；依赖 `current_user`。
- [ ] 测试：无头 → 401；坏 token → 401；档案不存在时 `/api/me` 建 `persons` + `users/{uid}`（只能 `smallholder`，`language` 默认 `ms`）→ 201；已有档案 → 200 且更新 `lastLoginAt`；请求体里想自带 `role` 被忽略。
- [ ] 实现 `auth.py`、`routes_me.py`、`main.create_app`；通过 → 提交。

### Task 3: `POST /api/plots`、`PATCH /api/plots/{id}`

- [ ] 测试：园主建地块（operatorPersonId = 自己、coopId、`pending`）→ 201；外勤不带 `memberId` → 422；外勤带别的合作社成员 → 403；PATCH 多边形：返回 `areaHaComputed`（4 位）、`centroid`，文档里 `polygonGeojson` 是字符串、`geometryRecordedAt` 有值；环没闭合 / 坐标越界 → 422 `geometry_invalid`；点模式面积 ≥4 或 ≤0 → 422 `point_area_invalid`；别人的地块 → 403；不存在 → 404。
- [ ] 实现（`core.geo.parse_polygon` / `check_point`；`GeometryError` → 422；超大面积兜底）；通过 → 提交。

### Task 4: `POST /api/plots/{id}/documents` + `Blobs` + 开发用 PUT

**Interfaces — Produces:** `Blobs.upload_url(path, content_type, expires_in) -> dict`；`Blobs.read_url(path, expires_in) -> str`；`Blobs.exists(path) -> bool`；`Blobs.read_bytes(path) -> bytes`。
- [ ] 测试：登记 → 201 `{documentId, upload:{method:"PUT", url, headers, expiresAt}}`；文档里没有 `extractionStatus`；同一 `docType` 重复登记旧的 `isCurrent=false`；`docType` 不认识 / `contentType` 不是 `image/jpeg` → 422；LocalBlobs 往开发 PUT 上传后 `exists` 为真；生产模式 `PUT /dev/blobs/*` 返回 404。
- [ ] 实现 `blobs.py`（LocalBlobs + GcsBlobs）、`routes_documents.py`、`routes_dev.py`；通过 → 提交。

### Task 5: 字段规范化与 `PlotFacts` 拼装（worker）

**Interfaces — Produces:**
```python
# fields.py
ALLOWED_KEYS: dict[str, tuple[str, ...]]   # docType -> 允许的字段键
def normalize_field(key: str, raw: str, value: str, confidence: float) -> dict  # {rawText, normalizedValue, confidence}
def effective(field: Mapping | None) -> str | None                              # confirmedValue ?? normalizedValue
# facts.py
def build_facts(store, plot_id, plot, operator_name, docs) -> tuple[PlotFacts, dict, dict]  # facts, critical, evidence
```
- [ ] 测试 `normalize_field`：日期 `05/12/2026` → `2026-12-05`，认不出的日期置信度降到 ≤0.3；面积 `3.04 Hektar` → `3.0400` + 单位 `ha`；`effective` 优先 confirmed。
- [ ] 测试 `build_facts`：用种子里的一块地（其 documents 当作输入）拼出的 `PlotFacts`/`critical` 经 `evaluate_plot` 的状态等于种子 `plots.status`（抽 10 块：绿 / 黄 / 红 / needs_review 各覆盖）。
- [ ] 实现；通过 → 提交。

### Task 6: Gemini 抽取、解释、森林（适配器）

- [ ] 测试（假客户端）：`GeminiExtractor` 把模型返回按 `ALLOWED_KEYS` 过滤、过规范化；模型返回乱 JSON / 抛错 → 抛 `ExtractionError`；`TemplateExplainer` 对每个缺口给 `description`/`suggestedAction`，不改 `gapCode`/`severity`；`PrecomputedForest` 返回固定结构。
- [ ] 实现 `gemini.py`（`google-genai`，`response_mime_type="application/json"` + Pydantic schema，超时与退避）、`explain.py`（Gemini 失败回退模板）、`forest.py`；通过 → 提交。

### Task 7: 流水线与 `POST /api/plots/{id}/assess`

- [ ] 测试（MemoryStore + 假 Extractor）：端到端——建地块 / 存多边形 / 登记三份文件并往 LocalBlobs 放字节 → assess → 202；等后台任务跑完后 `assessments/{aid}.runStatus == done`、`result` 与预期一致、`plots.status` 同步、`ruleResults[]`/`gaps[]` 形状与 `contract/examples/*.json` 同键；缺一份文件 → `missing_doc`；抽取抛错 → 该文件 `failed`、相关规则 `needs_review`、流程继续；流水线崩 → `failed` + `plots.status=needs_review`；已有 `queued` → 409 带 id；10 分钟残留被放行；`steps[]` 有记录。
- [ ] 实现 `pipeline.py` + 路由；通过 → 提交。

### Task 8: `PATCH /api/documents/{id}/fields`、`GET /api/documents/{id}/image`

- [ ] 测试：key 不存在 / 日期格式不对 / 面积 ≤0 → 400；写入 `confirmedValue`/`confirmedBy`/`confirmedAt`；别人的 → 403；不存在 → 404；image 返回 `{url, expiresAt}`。
- [ ] 实现；通过 → 提交。

### Task 9: FirestoreStore + 模拟器冒烟 + 启动入口

- [ ] 实现 `firestore_store.py`、`create_app_from_env`；`pytest -m emulator` 的少量测试（带点键局部更新、`list where in`、`find_in_group`）。
- [ ] 本地启动 + `scripts/e2e_local.py`：用模拟器 + 种子的 9 张仿真证件照跑一遍主线（有 `GEMINI_API_KEY` 用真的，没有用假 Extractor），打印结果。

### Task 10: 部署与共管文件

- [ ] `Dockerfile`（仓库根）、`infra/cloudbuild/{pr,deploy}.yaml` 后端步骤改 pytest / 构建上下文改仓库根、`contract/schema.sql` 的 `rule_results.doc_type`、README 与 `api/README.md` 同步、`.env.example`。
- [ ] 全套 `pytest` 通过 → 提交 → 推分支。

## Self-Review（对照 spec）

- §4 的 7 个接口：Task 2/3/4/7/8 全覆盖；`GET /api/documents/{id}/image` 在 Task 8。
- §5 流水线 ①–⑥：Task 5–7；降级与并发残留在 Task 7；森林用预先算好的数据（Task 6，视频里如实说明）。
- §7 测试：`core/` 已有；`api/` 每接口 401/403/404/409/422 在各任务的测试里；emulator 与 Gemini 冒烟在 Task 9。
- 范围外（与 spec §1 一致）：dashboard、export、report、voice、向量检索、Cloud Tasks、服务端 PDF；`titles`/`mpobLicences`/`mspoCertificates` 的回写本轮不做（前端读的是 `plots` 与 `documents.fields`）。
