# 接口清单

路径取自企划书 v3 第 7 章。今晚两人一起把「请求」「响应」两栏写完，写好再开工。

| 路径 | 方法 | 用途 | 级别 | 请求 | 响应 |
| --- | --- | --- | --- | --- | --- |
| `/api/plots` | GET / POST | 查询、新建地块 | 必做 | 待定 | 待定 |
| `/api/plots/{id}` | PATCH | 保存地块多边形与面积（`polygon_geojson`、`area_ha_computed`） | 必做 | 待定 | 待定 |
| `/api/plots/{id}/documents` | POST | 取得签名上传网址并登记文件 | 必做 | 待定 | 待定 |
| `/api/plots/{id}/assess` | POST | 触发 AI 合规评估 | 必做 | 待定 | 待定 |
| `/api/documents/{id}/fields` | PATCH | 用户确认或修改读出的字段（屏 8） | 尽量做 | 待定 | 待定 |
| `/api/plots/{id}/report` | GET | 合规档案（本轮先用浏览器打印） | 本轮不做服务端 | — | — |
| `/api/coop/dashboard` | GET | 合作社统计数据 | 必做 | 待定 | 待定 |
| `/api/coop/export` | GET | 导出地块汇总表 CSV | 尽量做 | 待定 | 待定 |
| `/api/voice` | POST | 语音问答 | 本轮不做 | — | — |

评估结果不走接口返回：前端实时订阅 Firestore 的 `assessments` 和 `plots.status`。

## 提议（待队友确认）：鉴权与评估触发

> 前端要接 `POST /api/plots/{id}/assess` 之前，下面两件事需要先定。**以下是前端的提议，不是已定的合同**；队友改了就以改后的为准。前端对 Firestore 只读，所以评估的进度和结果都不走接口返回，靠订阅 Firestore（见 `firestore.md`）。

### 鉴权

- 前端用 Firebase Auth 登录（手机号 OTP），调用任何 `/api/*` 都带 `Authorization: Bearer <Firebase ID token>`。
- 后端用 Admin SDK 校验 token 取 `uid`，再读 `users/{uid}` 得到 `role`、`coopId`、`personId`。
- 没带或失效 → `401`；角色不够，或不是自己（或自己合作社）的地块 → `403`。

### `POST /api/plots/{id}/assess`

- **请求**：没有请求体（或 `{}`）。
- **响应**：`202 Accepted`，body `{ "assessmentId": "<uuid>" }`。后端**先**写 `plots/{id}/assessments/{assessmentId}`，`runStatus: "queued"`＋`createdAt`，再依次 `running`／`done`／`failed`；前端靠 Firestore 订阅看进度（屏 7），不轮询接口。
- **错误**：`404` 地块不存在；`409` 这块地已有 `queued`／`running` 的评估（body 同样带那一条的 `assessmentId`，前端据此直接进屏 7）。

### `PATCH /api/documents/{id}/fields`（屏 8 确认字段，提议）

- **请求**：`{ "fields": { "<field_key>": "<用户确认的值>" } }`，一次可以带多个字段；`field_key` 取 `documents.fields` 里已有的 key（如 `mspo_cert.expiry_date`），值是字符串（日期用 `YYYY-MM-DD`，面积用数字字符串）。
- **后端做**：校验 key 与值的格式；把 `confirmedValue` 写成该值、`confirmedBy` 写成调用者的 `uid`、`confirmedAt` 写成当前时间（这三个字段只有后端写）；**不自动重新评估**。
- **响应**：`200`，body `{ "documentId": "<id>", "fields": { "<field_key>": { "confirmedValue": "…", "confirmedAt": "<ISO 时间>" } } }`。
- **错误**：`400` key 不存在或值格式不对；`401`／`403`（不是自己的地块）；`404` 文件不存在。
- 用户确认完后，前端再调 `POST /api/plots/{id}/assess` 触发重新评估（屏 7 看进度）。
