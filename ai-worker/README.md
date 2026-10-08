# ai-worker：编排智能体（后端）

Gemini 抽取、规则引擎、Earth Engine 森林初筛、缺口清单与红黄绿定级。
部署到 Cloud Run 服务 `kebunsah-ai`。`assessments`、`rule_results`、`gaps` 和 `plots.status` 只由这里写。

降级预案（企划书 v3 第 11 章）：C# 调 Gemini 或 Earth Engine 卡住超过一天，就把这个目录换成 Node.js 或 Python 服务，接口不变。
