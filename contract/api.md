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

> **2026-10-17：后端已按 PR #14／#23 的提议实现**，请求、响应、错误码、鉴权（`Authorization: Bearer <Firebase ID token>`）的实际形状以 `api/README.md` 和 `api/tests/` 为准；与提议的差别：`POST /api/me`（首次登录建档）是新增的，`POST …/documents` 多了可选的 `pageNo`（默认 1），`PATCH …/fields` 的格式错误返回 400。`GET /api/plots` 和 `/api/coop/*` 没做。
