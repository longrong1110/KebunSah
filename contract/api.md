# 接口清单

路径取自企划书 v3 第 7 章。今晚两人一起把「请求」「响应」两栏写完，写好再开工。

| 路径 | 方法 | 用途 | 级别 | 请求 | 响应 |
| --- | --- | --- | --- | --- | --- |
| `/api/plots` | GET / POST | 查询、新建地块 | 必做 | POST 见下方提议；GET 待定 | POST 见下方提议；GET 待定 |
| `/api/plots/{id}` | PATCH | 保存地块位置与面积（多边形，或一个点＋手填面积；面积由后端重算） | 必做 | 见下方提议 | 见下方提议 |
| `/api/plots/{id}/documents` | POST | 取得签名上传网址并登记文件 | 必做 | 见下方提议 | 见下方提议 |
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

## 提议（待队友确认）：新建地块、保存位置与面积、登记文件

> 屏 5（圈地块）已按下面的形状在前端存好了草稿，屏 6「开始检查」要依次调：`POST /api/plots` → `PATCH /api/plots/{id}` → 对每份文件 `POST /api/plots/{id}/documents` 并直传 → `POST /api/plots/{id}/assess`（见上）。前三个现在合同里「请求／响应」都是待定，前端对 Firestore 只读、不能自己发明接口，所以先写成提议。**不是已定的合同**，队友改了就以改后的为准。鉴权同上一节（`Authorization: Bearer <Firebase ID token>`，`401`／`403`）。

### `POST /api/plots`（新建一块空地）

- **请求**：`{ "memberId": "<persons.id>" }`。`memberId` 只有外勤（`field_officer`）替成员新建时才带，必须是本人合作社的成员；园主自己新建不带，后端用 `users/{uid}.personId`。
- **后端做**：建 `plots/{plotId}`：`operatorPersonId`＝成员（或自己）的 `persons.id`，`coopId`＝调用者的 `coopId`，`status: "pending"`，`isSynthetic: false`，没有几何。
- **响应**：`201`，body `{ "plotId": "<uuid>" }`。
- **错误**：`403` 不是自己的成员；`422` 外勤没带 `memberId`。

### `PATCH /api/plots/{id}`（保存位置与面积；屏 10「重画」同一个接口）

- **请求**（二选一）：
  - 多边形：`{ "geometryType": "polygon", "polygon": { "type": "Polygon", "coordinates": [[[lng, lat], …, [lng, lat]]] } }`。GeoJSON 对象，`[经度, 纬度]`，WGS84，环首尾闭合，坐标保留 6 位小数。前端已校验：≥3 个不同的顶点、边不交叉、面积 ≥0.005 公顷；**面积没有上限**。
  - 一个点：`{ "geometryType": "point", "point": { "lng": …, "lat": … }, "areaHaDeclared": 2.5 }`。`areaHaDeclared` 是园主手填的公顷数，必须 `> 0` 且 `< 4`（`schema.sql` 的 `plots_geometry_ck`）。
- **前端不传 `area_ha_computed`**：`schema.sql` 的注释写明「面积由后端重算，不信前端传的数」，所以由后端按多边形算（球面面积，公顷，4 位小数）。前端屏 5 显示的「≈ N ha」只是预览（`@turf/area`，球面算法），与后端算的可能有细微出入。
- **后端做**：校验（多边形环必须闭合、坐标范围、点模式面积 `< 4`）；写 `geometryType`、`polygonGeojson`（**存成 JSON 字符串**，Firestore 拒绝嵌套数组，见 `seed/README.md` 缺口 2）、`centroidLat`／`centroidLng`（多边形的质心由后端算）、`areaHaComputed`（多边形）或 `areaHaDeclared`（点）、`geometryRecordedAt`＝当前时间。**不自动重新评估**；重画之后前端再调 `POST /api/plots/{id}/assess`。
- **响应**：`200`，body `{ "plotId": "<id>", "geometryType": "polygon", "areaHaComputed": 4.4812, "areaHaDeclared": null, "centroid": { "lat": 4.3251, "lng": 101.1622 } }`（点模式 `areaHaComputed` 为 `null`），前端用它显示后端算出的最终面积。
- **错误**：`403` 不是自己（或自己合作社）的地块；`404`；`422` 几何不合法（环没闭合、点模式面积 ≥4 或 ≤0）。

### `POST /api/plots/{id}/documents`（取得签名上传网址并登记文件）

- **请求**：`{ "docType": "land_title" | "mpob_licence" | "mspo_cert", "contentType": "image/jpeg", "source": "camera" | "gallery" }`。屏 3 一份文件一张照片（前端已压成 JPEG，长边 ≤2000 px），`source` 对应 `documents.source`。一份文件多页以后再说，本轮不做（`page_no` 固定 1）。
- **后端做**：建 `plots/{plotId}/documents/{documentId}`（`docType`、`source`、`mimeType`、`uploadedBy`；`storagePath` 由后端定，前端不决定路径）；返回 15 分钟有效、限定 `Content-Type` 的 PUT 签名网址。**`extractionStatus` 要等照片真的传上去才设为 `uploaded` 并排队抽取**，所以建文档时先不写它；建议用 Storage 的 `object.finalize` 事件触发。
- **响应**：`201`，body `{ "documentId": "<uuid>", "upload": { "method": "PUT", "url": "<签名网址>", "headers": { "Content-Type": "image/jpeg" }, "expiresAt": "<ISO 时间>" } }`。前端用 `fetch(url, { method: "PUT", headers, body: 照片 })` 直传，不经过 API。
- **请队友定**：上传完成后谁通知后端？前端不想再多一个「上传完了」的接口（也不能写 Firestore），所以建议用 Storage 的 `object.finalize` 触发；如果队友更想要一个确认接口（`POST /api/documents/{id}/uploaded`），请直接在评论里写。
- **错误**：`403`／`404`；`422` `docType` 不认识、`contentType` 不是 `image/jpeg`。
- 同一份 `docType` 在同一块地上重复登记：建议后端**替换**成新的一份（屏 3 允许重拍），旧的标记为作废；前端不关心旧的。
- 没有这份文件（屏 3 点了「Langkau」）：前端**不调**这个接口，评估时后端按「缺文件」处理。

### 错误响应的统一格式（提议）

所有 `4xx` 返回 `{ "error": { "code": "<snake_case>", "message": "<给开发者看的英文一句话>" } }`；`message` 前端**不显示**（界面文案由前端按 `code` 自己生成，马来语／英语），`code` 取值各接口自己列（如 `plot_not_found`、`geometry_invalid`、`point_area_too_large`）。
