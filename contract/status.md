# 状态值

取自 `schema.sql` 的 CHECK 约束，前后端和 AI 服务都用这些字符串，不要另起别名。

## plots.status（地块红黄绿，只由 AI 服务写）

| 值 | 意思 |
| --- | --- |
| `pending` | 还没评估 |
| `green` | 通过 |
| `yellow` | 有缺口，补材料即可 |
| `red` | 有高风险问题 |
| `needs_review` | AI 拿不准或评估失败，需要人工复核 |

## assessments.run_status（一次评估的进度）

`queued` → `running` → `done` 或 `failed`。`done` 时 `result` 必填，取值 `green` / `yellow` / `red` / `needs_review`。

## documents.extraction_status（文件读取进度）

`uploaded` → `extracting` → `extracted`，或 `failed` / `needs_review`。

## documents.doc_type

`land_title`（地契）、`mpob_licence`（MPOB 执照）、`mspo_cert`（MSPO 证书）、`mspo_member_list`（MSPO 团体成员名单）。
