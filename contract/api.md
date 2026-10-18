# 接口清单

路径取自企划书 v3 第 7 章。**2026-10-18 定稿**（乙拍板，后端已按本文实现并用真 Gemini 在本地模拟器上跑通，用法见 `api/README.md`；前端提议见 PR #14／#23，这里是合并后的最终形状，与提议不同的地方标了「与提议不同」）。

| 路径 | 方法 | 用途 | 状态 |
| --- | --- | --- | --- |
| `/api/me` | POST | 首次登录建档（只会建园主），已有档案返回并更新 `lastLoginAt` | 已实现（提议里没有，新增） |
| `/api/plots` | POST | 新建一块空地 | 已实现 |
| `/api/plots` | GET | 查询地块 | 本轮不做：前端直接订阅 Firestore |
| `/api/plots/{id}` | PATCH | 保存地块位置与面积（多边形，或一个点＋手填面积；面积由后端重算） | 已实现 |
| `/api/plots/{id}/documents` | POST | 取得签名上传网址并登记文件 | 已实现 |
| `/api/plots/{id}/assess` | POST | 触发 AI 合规评估 | 已实现 |
| `/api/documents/{id}/fields` | PATCH | 用户确认或修改读出的字段（屏 8） | 已实现 |
| `/api/documents/{id}/image` | GET | 15 分钟有效的原图读取网址（屏 8） | 已实现 |
| `/api/plots/{id}/report` | GET | 合规档案 | 本轮不做服务端：浏览器打印 |
| `/api/coop/dashboard`、`/api/coop/export` | GET | 合作社统计、导出 CSV | 本轮不做：前端在浏览器里算 |
| `/api/voice` | POST | 语音问答 | 本轮不做 |

评估结果不走接口返回：前端实时订阅 Firestore 的 `assessments` 和 `plots.status`（形状见 `firestore.md`）。

## 鉴权

- 前端用 Firebase Auth 登录（手机号 OTP），调用任何 `/api/*` 都带 `Authorization: Bearer <Firebase ID token>`。
- 后端用 Admin SDK 校验 token 取 `uid`，再读 `users/{uid}` 得到 `role`、`coopId`、`personId`。
- 没带或失效 → `401`；没有 `users/{uid}` 档案 → `403`（先调 `POST /api/me`）；角色不够，或不是自己（或自己合作社）的地块 → `403`。

### `POST /api/me`（首次登录建档）

- **请求**：`{ "fullName": "…", "language": "ms" | "en" }`，都可省略。`fullName` 就是之后评估里和地契、执照比对的「园主姓名」（CC-03），没给就用手机号（那样姓名比对一定不过）；请求里带的 `role`、`coopId` 一律忽略。
- **后端做**：没有档案就建 `persons/{id}` 和 `users/{uid}`，**只能建 `smallholder`**（外勤和管理员由种子或 Admin SDK 预建），`coopId` 为空；已有档案就更新 `lastLoginAt`。
- **响应**：新建 `201`、已有 `200`，body `{ "uid", "role", "language", "personId", "coopId" }`。

### `POST /api/plots/{id}/assess`

- **请求**：没有请求体（或 `{}`）。
- **响应**：`202 Accepted`，body `{ "assessmentId": "<uuid>" }`。后端**先**写 `plots/{id}/assessments/{assessmentId}`，`runStatus: "queued"`＋`createdAt`，再依次 `running`／`done`／`failed`；前端靠 Firestore 订阅看进度（屏 7），不轮询接口。
- **错误**：`404` 地块不存在；`409` 这块地已有 `queued`／`running` 的评估（body 同样带那一条的 `assessmentId`，前端据此直接进屏 7；超过 10 分钟没结束的当残留，改成 `failed` 再放行）；`422 geometry_missing` 还没有保存位置与面积。

### `PATCH /api/documents/{id}/fields`（屏 8 确认字段）

- **请求**：`{ "fields": { "<field_key>": "<用户确认的值>" } }`，一次可以带多个字段；`field_key` 取 `documents.fields` 里已有的 key，**或该证件允许的 key（与提议不同：模型没读到的字段，用户也可以补）**，值是字符串或数字（日期写 `YYYY-MM-DD` 或 `DD/MM/YYYY`，面积写数字）。
- **后端做**：先全部校验再写（有一个不合格就一个都不写）；把 `confirmedValue` 写成规范化后的值、`confirmedBy` 写成调用者的 `uid`、`confirmedAt` 写成当前时间（这三个字段只有后端写）；**不自动重新评估**。
- **响应**：`200`，body `{ "documentId": "<id>", "fields": { "<field_key>": { "confirmedValue": "…", "confirmedAt": "<ISO 时间>" } } }`。
- **错误**：`400` `no_fields`／`unknown_field`／`invalid_value`；`401`／`403`（不是自己的地块）；`404 document_not_found`。
- 用户确认完后，前端再调 `POST /api/plots/{id}/assess` 触发重新评估（屏 7 看进度）。

### `GET /api/documents/{id}/image`

- **响应**：`200 { "url": "<15 分钟有效的读取网址>", "expiresAt": "<ISO 时间>" }`；`404 image_not_found` 照片还没传上来（种子里的文件就没有照片）。Storage 规则不对前端开放读。

## 新建地块、保存位置与面积、登记文件

屏 5（圈地块）已按下面的形状在前端存好了草稿，屏 6「开始检查」依次调：`POST /api/plots` → `PATCH /api/plots/{id}` → 对每份文件 `POST /api/plots/{id}/documents` 并直传 → `POST /api/plots/{id}/assess`。鉴权同上。

### `POST /api/plots`（新建一块空地）

- **请求**：`{ "memberId": "<persons.id>" }`。`memberId` 只有外勤（`field_officer`）替成员新建时才带，必须是本人合作社的成员（本合作社有地块以他为园主，或有绑定他的账号）；园主自己新建不带，后端用 `users/{uid}.personId`。
- **后端做**：建 `plots/{plotId}`：`operatorPersonId`＝成员（或自己）的 `persons.id`，`coopId`＝调用者的 `coopId`，`status: "pending"`，`isSynthetic: false`，没有几何。
- **响应**：`201`，body `{ "plotId": "<uuid>" }`。
- **错误**：`403` 不是自己的成员；`422` 外勤没带 `memberId`。

### `PATCH /api/plots/{id}`（保存位置与面积；屏 10「重画」同一个接口）

- **请求**（二选一）：
  - 多边形：`{ "geometryType": "polygon", "polygon": { "type": "Polygon", "coordinates": [[[lng, lat], …, [lng, lat]]] } }`。GeoJSON 对象，`[经度, 纬度]`，WGS84，环首尾闭合。前端已校验：≥3 个不同的顶点、边不交叉、面积 ≥0.005 公顷；后端同样校验，并拒绝超出范围的坐标和大得离谱的面积。
  - 一个点：`{ "geometryType": "point", "point": { "lng": …, "lat": … }, "areaHaDeclared": 2.5 }`。`areaHaDeclared` 是园主手填的公顷数，必须 `> 0` 且 `< 4`（`schema.sql` 的 `plots_geometry_ck`）。
- **前端不传 `area_ha_computed`**：面积由后端按多边形算（WGS84 椭球面积，公顷，4 位小数）。前端屏 5 显示的「≈ N ha」只是预览（`@turf/area`，球面算法），在半岛纬度比后端算的大约小 0.7%。
- **后端做**：写 `geometryType`、`polygonGeojson`（**存成 JSON 字符串**，Firestore 拒绝嵌套数组）、`centroidLat`／`centroidLng`、`areaHaComputed`（多边形）或 `areaHaDeclared`（点）、`geometryRecordedAt`。**不自动重新评估**；重画之后前端再调 `POST /api/plots/{id}/assess`。
- **响应**：`200`，body `{ "plotId": "<id>", "geometryType": "polygon", "areaHaComputed": 4.4812, "areaHaDeclared": null, "centroid": { "lat": 4.3251, "lng": 101.1622 } }`（点模式 `areaHaComputed` 为 `null`），前端用它显示后端算出的最终面积。
- **错误**：`403` 不是自己（或自己合作社）的地块；`404`；`422` 几何不合法（`geometry_invalid`：环没闭合、坐标越界；点模式 `point_area_too_large`／面积 ≤0）。

### `POST /api/plots/{id}/documents`（取得签名上传网址并登记文件）

- **请求**：`{ "docType": "land_title" | "mpob_licence" | "mspo_cert", "contentType": "image/jpeg", "source": "camera" | "gallery", "pageNo": 1 }`。屏 3 一份文件一张照片（前端已压成 JPEG，长边 ≤2000 px），`source` 对应 `documents.source`。**与提议不同：多了可选的 `pageNo`（1–4，默认 1）**，一份证件可以有多页（地契的面积和持有人常在不同页），前端暂时不传。
- **后端做**：建 `plots/{plotId}/documents/{documentId}`（`docType`、`pageNo`、`source`、`mimeType`、`uploadedBy`；`storagePath` 由后端定，前端不决定路径）；返回 15 分钟有效、限定 `Content-Type` 的 PUT 网址。建文档时不写 `extractionStatus`。
- **响应**：`201`，body `{ "documentId": "<uuid>", "upload": { "method": "PUT", "url": "<签名网址>", "headers": { "Content-Type": "image/jpeg" }, "expiresAt": "<ISO 时间>" } }`。前端用 `fetch(url, { method: "PUT", headers, body: 照片 })` 直传，不经过 API，**也不带 `Authorization`**。
- **上传完成不用通知后端（已定，与提议里的 `object.finalize` 不同）**：不加触发器，也不加确认接口——`assess` 时流水线直接到 Storage 看对象在不在，不在就按「缺文件」处理（`missing_doc`）。
- **错误**：`403`／`404`；`422` `docType` 不认识、`contentType` 不是 `image/jpeg`、`pageNo` 越界。
- 同一份 `docType` 的同一页在同一块地上重复登记：后端**替换**成新的一份（屏 3 允许重拍），旧的 `isCurrent=false`；前端不关心旧的。
- 没有这份文件（屏 3 点了「Langkau」）：前端**不调**这个接口，评估时后端按「缺文件」处理。

### 错误响应的统一格式

所有 `4xx` 返回 `{ "error": { "code": "<snake_case>", "message": "<给开发者看的英文一句话>" } }`；`message` 前端**不显示**（界面文案由前端按 `code` 自己生成，马来语／英语），`code` 取值各接口自己列（如 `plot_not_found`、`geometry_invalid`、`point_area_too_large`、`assessment_in_progress`）。参数格式不对（缺字段、类型错）统一 `422 invalid_request`。
