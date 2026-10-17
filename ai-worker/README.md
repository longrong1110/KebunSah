# ai-worker：评估流水线（后端）

Gemini 抽取、规则引擎（在 `core/`）、森林初筛、缺口说明与红黄绿定级。
`assessments` 和 `plots.status` 只由这里写。目前与 `api/` 合在一个 Cloud Run 服务里跑（`POST …/assess` 之后用 FastAPI 后台任务，进程内异步），
将来要拆成独立服务只改 Dockerfile 和 `infra/cloudbuild/deploy.yaml`，接口不变。设计见 `docs/superpowers/specs/2026-10-13-backend-design.md`。

```
worker/
  pipeline.py   run_assessment：确认文件到了 → 抽取 → 规则 → 森林 → 说明 → 一次写回；每步一条日志进 steps[]
  gemini.py     Extractor 协议 + GeminiExtractor（证件照 → 逐字段 {rawText, normalizedValue, confidence}）
  fields.py     字段键白名单、日期／面积／单位规范化（认不出的压低置信度，交给屏 8）、confirmedValue 优先
  facts.py      从 documents.fields + MSPO 名单拼出 core.evaluate_plot 要的 PlotFacts
  explain.py    Explainer 协议 + GeminiExplainer（Gemini 写说明）+ TemplateExplainer（回退）
  forest.py     Forest 协议 + PrecomputedForest（预先算好的演示数据）+ UnavailableForest
tests/          假抽取器／假客户端；对种子 200 个地块验证拼出的事实与种子红黄绿一致
```

降级：任何一步的异常只降级那一项（文件 `failed`、相关规则 `needs_review`、森林 `unknown`、说明回退模板），流程继续；整条流水线崩了才把评估标 `failed`、地块标 `needs_review`。

**森林初筛现在用的是预先算好的演示数据**（`forestDataset: "precomputed-demo"`，固定低风险），Earth Engine 还没接。视频里要如实说明。查询失败时 `forestRisk: "unknown"`，评估降级为 `needs_review`，不会当作没有毁林。
