# seed/db：本地 PostgreSQL 数据库

把 [`contract/schema.sql`](../../contract/schema.sql)（企划书 v3 第 8 章的 17 张表）建成一个真的 PostgreSQL 16 数据库，一条命令起、一条命令重建。

> **它和 App 实际读写的库不是一回事。** 架构里的数据层是 **Firestore**（企划书第 6–7 章、8.9 节）：前端订阅、后端写。这个 PostgreSQL 库是「设计图落地」：看每张表每一列的依据、用 SQL 约束验证规则（例如「4 公顷以上必须是多边形」）、后端写校验时对照、以后若改用 Cloud SQL 可以直接用。App 本地演示跑的是 Firebase 模拟器（`web/` 里 `npm run emulators`，灌数据 `seed/` 里 `npm run load`）。

## 起、停、连接

前置：Docker（Docker Desktop 或 Linux 上的 Docker Engine，要有 `docker compose`）。在 `seed/` 目录下：

| 命令 | 作用 |
| --- | --- |
| `npm run db:up` | 起库并等它建好表（第一次会自动执行 `contract/schema.sql`） |
| `npm run db:psql` | 进 `psql` 交互终端 |
| `npm run db:check` | 自检：7 项「不该写进去的数据」是否真的被约束拦下（跑完回滚，不留改动） |
| `npm run db:down` | 停库，**数据保留**在 Docker 数据卷里 |
| `npm run db:reset` | **清空数据卷**并从 `contract/schema.sql` 重建（改了 schema.sql 以后用它） |

连接串（只在本机监听）：

```
postgresql://kebunsah:kebunsah-local-only@127.0.0.1:5433/kebunsah
```

端口是 **5433**，不是 5432：本机常有别的项目占着 5432。账号密码是本地开发专用，不连任何线上环境，不是密钥。

## 里面有什么

- **17 张表**：`persons`、`cooperatives`、`users`、`land_titles`、`title_proprietors`、`title_endorsements`、`mpob_licences`、`mspo_certificates`、`mspo_members`、`plots`、`documents`、`document_fields`、`assessments`、`rule_results`、`gaps`、`rule_params`、`audit_log`。
- **212 条列注释**：每一列都写了现实依据（`[证]` 纸面原文、`[册]` 官方系统、`[规]` 法规、`[约]` 团队约定、`[系]` 系统需要、`[待]` 待核实）。`\d+ plots` 或 `SELECT col_description('plots'::regclass, 4);` 就能看到。
- **规则阈值**：`rule_params` 8 条（面积容差、到期预警天数等）。
- **3 个虚构的演示地块**（绿、黄、红，`is_synthetic = true`），与 `seed/` 的三个演示地块同源。身份证号只存 SHA-256 哈希；上线前要给哈希加服务端秘密值（pepper），见 `schema.sql` 开头的说明。

## 没做

- **200 个模拟地块没有灌进这个库。** 它们是 Firestore 形状的 JSON（`seed/data/`），用 `npm run load` 灌 Firebase 模拟器；要灌 PostgreSQL 需要另写一份映射。
- **线上数据库没建**：线上 Firestore 与（若采用）Cloud SQL 都要 GCP／Firebase 项目与账单，由负责人在控制台创建，见仓库根 `README.md` 的「队友处理须知」。
