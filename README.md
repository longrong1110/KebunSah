# KebunSah

帮马来西亚小园主备齐 EUDR 合规材料的 App：拍地契和证照、圈出地块，AI 核对并做毁林初筛，给出红黄绿结果和缺口清单；合作社在电脑看板上看全部地块。

Google Cloud AI Builder Cup 2026 参赛项目。原型提交截止 **2026-10-18**，内部功能冻结 **10/16**。

## 目录与负责人

| 目录 | 内容 | 负责 |
| --- | --- | --- |
| `web/` | Angular PWA：手机端屏 1–10、合作社看板 → Firebase Hosting | 前端 |
| `seed/` | 200 个模拟地块、仿真证件照 | 前端 |
| `api/` | Python FastAPI → Cloud Run `kebunsah-api` | 后端 |
| `ai-worker/` | Gemini 抽取、规则引擎、Earth Engine → Cloud Run `kebunsah-ai` | 后端 |
| `contract/` | 字段、状态值、接口、示例 JSON | 两人共管 |
| `infra/` | Firestore 规则、Cloud Build 流水线 | 两人共管 |

## 怎么协作

完整的前后端分工和逐日分支计划见 [`docs/PLAN.md`](docs/PLAN.md)。

- `main` 永远能跑。不直接推 main，一律走 PR。
- 每人从 main 拉短分支，前端 `fe/…`，后端 `be/…`，合同 `contract/…`，冻结后修 bug `fix/…`。
- 一个 PR 一件事，当天开当天合；用 Squash merge，合并后删分支。
- PR 必须通过 Cloud Build 检查（`infra/cloudbuild/pr.yaml`）。
- 改 `contract/` 或 `infra/` 要对方 Approve；只改自己目录的 PR 检查绿了就自己合。
- 合同先改、代码后改：动字段或接口，先开只改 `contract/` 的 PR。
- 密钥不进仓库：Gemini 走 Cloud Run 服务账号，其他密钥放 Secret Manager。
- 里程碑打标签：`v0.1-e2e`（第一次端到端）、`v0.9-freeze`（10/16）、`v1.0-submit`（10/18）。

```bash
git switch main && git pull
git switch -c fe/screens-1-3
# …改代码…
git add . && git commit -m "web: 屏 1 手机号 OTP 登录"
git push -u origin fe/screens-1-3
gh pr create --fill
```

## 发布流水线

PR → Cloud Build 检查（`dotnet test`、`ng build`）→ 合并 main → Cloud Build 部署（`infra/cloudbuild/deploy.yaml`）：
镜像推 Artifact Registry，部署两个 Cloud Run 服务，前端发布到 Firebase Hosting。区域 `asia-southeast1`。
