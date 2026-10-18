"""配置全部来自环境变量：本地与线上用同一份代码，只换变量（Firestore / Auth 模拟器的变量由各自的 SDK 直接读）。"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    return default if raw is None else raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    project_id: str = "demo-kebunsah"
    blobs_mode: str = "local"  # local | gcs
    blobs_dir: str = ".local-blobs"
    bucket: str | None = None
    public_base_url: str = "http://127.0.0.1:8000"  # local 模式下，上传网址指向本服务
    gemini_api_key: str | None = None
    # 模型 id，可以用逗号写一串备选：第一个额度用完或不可用时自动换下一个（免费档每个模型每天只许约 20 次请求）
    gemini_extract_model: str = "gemini-3.5-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.1-flash-lite"
    gemini_explain_model: str = "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite"
    gemini_timeout_s: float = 40.0
    cors_origins: tuple[str, ...] = ("http://localhost:4200", "http://127.0.0.1:4200")
    stale_after_s: int = 600  # 超过这么久没结束的 queued / running 当残留
    dev_endpoints: bool = True  # PUT /dev/blobs/*，只在 local 模式开
    forest_backend: str = "demo"  # demo = 固定的演示数据；earthengine = 真的查 Google Earth Engine
    assess_as_of: str | None = None  # 演示时钉死评估日期（YYYY-MM-DD）；默认取当天（马来西亚时间）

    @classmethod
    def from_env(cls) -> "Settings":
        mode = os.environ.get("BLOBS_MODE", "local")
        origins = os.environ.get("CORS_ORIGINS")
        return cls(
            project_id=os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT") or "demo-kebunsah",
            blobs_mode=mode,
            blobs_dir=os.environ.get("BLOBS_DIR", ".local-blobs"),
            bucket=os.environ.get("STORAGE_BUCKET"),
            public_base_url=os.environ.get("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/"),
            gemini_api_key=os.environ.get("GEMINI_API_KEY") or None,
            gemini_extract_model=os.environ.get("GEMINI_EXTRACT_MODEL", cls.gemini_extract_model),
            gemini_explain_model=os.environ.get("GEMINI_EXPLAIN_MODEL", cls.gemini_explain_model),
            gemini_timeout_s=float(os.environ.get("GEMINI_TIMEOUT_S", "40")),
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()) if origins else cls.cors_origins,
            stale_after_s=int(os.environ.get("ASSESS_STALE_S", "600")),
            dev_endpoints=_bool("DEV_ENDPOINTS", mode == "local"),
            forest_backend=os.environ.get("FOREST_BACKEND", "demo").strip().lower(),
            assess_as_of=os.environ.get("ASSESS_AS_OF") or None,
        )
