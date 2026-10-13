# ai-worker：评估流水线（后端）

Gemini 抽取、规则引擎（在 `core/`）、Earth Engine 森林初筛、缺口清单与红黄绿定级。
`assessments`、`rule_results`、`gaps` 和 `plots.status` 只由这里写。目前与 `api/` 合在一个 Cloud Run 服务里跑（进程内异步），
将来要拆成 `kebunsah-ai` 只改 Dockerfile 和 `infra/cloudbuild/deploy.yaml`，接口不变。设计见 `docs/superpowers/specs/2026-10-13-backend-design.md`。
