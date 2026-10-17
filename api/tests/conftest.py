"""API 测试共用夹具：内存 Store、假 token 校验、假外部服务。"""
from __future__ import annotations

import itertools

import pytest
from fastapi.testclient import TestClient

from api_helpers import Clock, FakeVerifier, seed_users
from app.blobs import LocalBlobs
from app.config import Settings
from app.deps import Deps
from app.main import create_app
from app.store import MemoryStore


@pytest.fixture
def store() -> MemoryStore:
    s = MemoryStore()
    seed_users(s)
    return s


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def make_deps(store, clock, tmp_path):
    """返回一个函数：make_deps(**覆盖) → Deps。外部服务默认是占位对象，用到的测试自己覆盖。"""

    def _make(**overrides) -> Deps:
        ids = itertools.count(1)
        base = dict(
            settings=Settings(blobs_mode="local", blobs_dir=str(tmp_path / "blobs"), public_base_url="http://test",
                              dev_endpoints=True, assess_as_of="2026-10-17"),
            store=store, blobs=LocalBlobs(tmp_path / "blobs", "http://test"), verifier=FakeVerifier(), extractor=None, explainer=None, forest=None,
            now=clock, new_id=lambda: f"id-{next(ids):04d}",
        )
        base.update(overrides)
        return Deps(**base)

    return _make


@pytest.fixture
def client(make_deps) -> TestClient:
    return TestClient(create_app(make_deps()))
