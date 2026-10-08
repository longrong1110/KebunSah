# api：Python FastAPI（后端）

部署到 Cloud Run 服务 `kebunsah-api`（asia-southeast1）。接口清单见 `contract/api.md`。

起步：`dotnet new webapi -n KebunSah.Api -o .`，加一个 `Dockerfile`，
再加测试项目（`dotnet new xunit`），PR 检查会跑 `dotnet test`。
