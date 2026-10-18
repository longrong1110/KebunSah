"""依赖容器：create_app(deps) 把所有外部依赖一次性传进来，测试里换成假的。"""
from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import Request

from kebunsah_core.params import DEFAULT_PARAMS, Params

from .config import Settings
from .store import Store

if TYPE_CHECKING:  # 只为类型提示，避免循环 import
    from .auth import TokenVerifier
    from .blobs import Blobs
    from worker.explain import Explainer
    from worker.forest import Forest
    from worker.gemini import Extractor
    from worker.voice import Voice


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


@dataclass
class Deps:
    settings: Settings
    store: Store
    blobs: "Blobs"
    verifier: "TokenVerifier"
    extractor: "Extractor"
    explainer: "Explainer"
    forest: "Forest"
    params: Params = DEFAULT_PARAMS
    now: Callable[[], datetime] = field(default=utcnow)
    new_id: Callable[[], str] = field(default=new_id)
    voice: "Voice | None" = None  # 语音问答；没配 Gemini 密钥时是 None，接口回 503


def get_deps(request: Request) -> Deps:
    return request.app.state.deps
