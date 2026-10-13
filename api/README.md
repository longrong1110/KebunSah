# api：Python FastAPI（后端）

部署到 Cloud Run 服务 `kebunsah-api`（asia-southeast1）。接口清单见 `contract/api.md`。

本地起步：仓库根目录 `py -3.11 -m venv .venv`，激活后 `python -m pip install -r requirements-dev.txt`，`python -m pytest` 跑测试。
共用的规则与几何在 `core/`；整体设计见 `docs/superpowers/specs/2026-10-13-backend-design.md`。
