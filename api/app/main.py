"""FastAPI 应用。create_app(deps) 供测试注入假依赖；create_app_from_env() 按环境变量组装线上 / 本地真实依赖。"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import routes_dev, routes_documents, routes_me, routes_plots
from .deps import Deps
from .errors import install_error_handlers


def create_app(deps: Deps) -> FastAPI:
    app = FastAPI(title="KebunSah API", version="0.1.0", docs_url="/docs" if deps.settings.dev_endpoints else None,
                  redoc_url=None, openapi_url="/openapi.json" if deps.settings.dev_endpoints else None)
    app.state.deps = deps
    install_error_handlers(app)
    app.add_middleware(CORSMiddleware, allow_origins=list(deps.settings.cors_origins), allow_methods=["*"],
                       allow_headers=["Authorization", "Content-Type"], max_age=600)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True}

    app.include_router(routes_me.router)
    app.include_router(routes_plots.router)
    app.include_router(routes_documents.router)
    if deps.settings.dev_endpoints:
        app.include_router(routes_dev.router)
    return app
