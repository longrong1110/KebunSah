"""FastAPI 应用。create_app(deps) 供测试注入假依赖；create_app_from_env() 按环境变量组装线上 / 本地真实依赖。"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import routes_assess, routes_dev, routes_documents, routes_me, routes_plots
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
    app.include_router(routes_assess.router)
    if deps.settings.dev_endpoints:
        app.include_router(routes_dev.router)
    return app


def load_dotenv(path: str | Path = ".env") -> None:
    """读 KEY=VALUE 的 .env（不进仓库）；已经在环境里的变量不覆盖。"""
    file = Path(path)
    if not file.is_file():
        return
    for line in file.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def _models(spec: str) -> list[str]:
    """GEMINI_*_MODEL 可以写成逗号分隔的一串备选模型"""
    return [m.strip() for m in spec.split(",") if m.strip()]


def _load_params(store):
    """规则阈值：库里有 config/ruleParams 就用它，没有或读不到就用默认值（读不到不应该拦住服务启动）。"""
    from kebunsah_core.params import DEFAULT_PARAMS, params_from_config

    try:
        return params_from_config(store.get("config/ruleParams"))
    except Exception:
        logging.getLogger("kebunsah").warning("could not read config/ruleParams; using default thresholds", exc_info=True)
        return DEFAULT_PARAMS


def create_app_from_env() -> FastAPI:
    """uvicorn app.main:create_app_from_env --factory。本地连模拟器，线上连真服务，只靠环境变量切换。"""
    load_dotenv()
    from worker.explain import GeminiExplainer, TemplateExplainer
    from worker.forest import PrecomputedForest
    from worker.gemini import GeminiExtractor

    from .auth import FirebaseTokenVerifier
    from .blobs import GcsBlobs, LocalBlobs
    from .config import Settings
    from .firestore_store import FirestoreStore
    from .store import MemoryStore

    settings = Settings.from_env()
    store = MemoryStore() if os.environ.get("STORE_BACKEND") == "memory" else FirestoreStore(settings.project_id)
    if settings.blobs_mode == "gcs":
        if not settings.bucket:
            raise RuntimeError("BLOBS_MODE=gcs needs STORAGE_BUCKET")
        blobs = GcsBlobs(settings.bucket)
    else:
        blobs = LocalBlobs(settings.blobs_dir, settings.public_base_url)
    explainer = (GeminiExplainer(settings.gemini_api_key, _models(settings.gemini_explain_model), settings.gemini_timeout_s)
                 if settings.gemini_api_key else TemplateExplainer())
    deps = Deps(
        settings=settings, store=store, blobs=blobs, verifier=FirebaseTokenVerifier(settings.project_id),
        extractor=GeminiExtractor(settings.gemini_api_key, _models(settings.gemini_extract_model), settings.gemini_timeout_s),
        explainer=explainer, forest=PrecomputedForest(), params=_load_params(store))
    return create_app(deps)
