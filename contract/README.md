# contract：前端与后端之间的合同（两人共管）

前端做界面、后端做评估，两边只通过这里的约定交接，所以谁也不用等谁。

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| `schema.sql` | 企划书 v3 第 8 章的 17 张表，每列带现实依据；Firestore 集合按它建（对应关系见企划书 8.9 节） | 已定 |
| `status.md` | 地块、文件、评估的状态值 | 已定（取自 schema） |
| `api.md` | 接口清单：路径、请求、响应、错误码、鉴权 | 已定（2026-10-18，后端已实现；与前端提议不同之处在文中标出） |
| `firestore.md` | 前端实际按它解析的 Firestore 文档形状（评估、文件）、取值表、已定的几条 | 已定（2026-10-18） |
| `examples/` | `green.json`、`yellow.json`、`red.json` 三份示例评估（取自 seed 的演示地块；`CC-02` 只有一条、没有 `docType`，是老形状，后端实际每份文件写一条） | 已定 |

## 改合同的规矩

1. 先开一个**只改 `contract/`** 的 PR，标题以 `contract:` 开头。
2. 对方 Approve 后再合并。
3. 合并之后两边各自改代码。

`schema.sql` 可以直接在 PostgreSQL 16 里跑：`createdb kebunsah && psql kebunsah -v ON_ERROR_STOP=1 -f contract/schema.sql`。
