# contract：前端与后端之间的合同（两人共管）

前端做界面、后端做评估，两边只通过这里的约定交接，所以谁也不用等谁。

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| `schema.sql` | 企划书 v3 第 8 章的 17 张表，每列带现实依据；Firestore 集合按它建（对应关系见企划书 8.9 节） | 已定 |
| `status.md` | 地块、文件、评估的状态值 | 已定（取自 schema） |
| `api.md` | 接口清单 | 路径已定，请求与响应待两人一起写；末尾有鉴权与 assess 的提议 |
| `firestore.md` | 前端实际按它解析的 Firestore 文档形状（评估、文件）、取值表、几条提议 | 提议，待队友确认 |
| `examples/` | `green.json`、`yellow.json`、`red.json` 三份示例评估（取自 seed 的演示地块） | 已写，待队友确认 |

## 改合同的规矩

1. 先开一个**只改 `contract/`** 的 PR，标题以 `contract:` 开头。
2. 对方 Approve 后再合并。
3. 合并之后两边各自改代码。

`schema.sql` 可以直接在 PostgreSQL 16 里跑：`createdb kebunsah && psql kebunsah -v ON_ERROR_STOP=1 -f contract/schema.sql`。
