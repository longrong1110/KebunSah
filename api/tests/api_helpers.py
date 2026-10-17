"""API 测试的共用小工具（不叫 conftest，免得和 ai-worker/tests 的同名模块冲突）。"""
from __future__ import annotations

from datetime import datetime, timezone

from app.auth import InvalidToken
from app.store import MemoryStore

COOP = "c0000000-0000-4000-8000-000000000001"
OTHER_COOP = "c0000000-0000-4000-8000-000000000002"


class FakeVerifier:
    """token 形如 "tok-<uid>"；其余一律无效。"""

    def __init__(self, claims_by_uid: dict[str, dict] | None = None):
        self.claims_by_uid = claims_by_uid or {}

    def verify(self, token: str) -> dict:
        if not token.startswith("tok-"):
            raise InvalidToken("bad token")
        uid = token[4:]
        return {"uid": uid, "phone_number": None, "name": None, **self.claims_by_uid.get(uid, {})}


def bearer(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer tok-{uid}"}


def seed_users(store: MemoryStore) -> None:
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    for uid, role, person, coop in [
        ("smallholder-1", "smallholder", "person-1", COOP),
        ("smallholder-2", "smallholder", "person-2", COOP),
        ("officer-1", "field_officer", None, COOP),
        ("officer-other", "field_officer", None, OTHER_COOP),
    ]:
        store.set(f"users/{uid}", {"phone": "+60100000000", "role": role, "language": "ms", "personId": person,
                                   "coopId": coop, "lastLoginAt": None, "isSynthetic": True, "createdAt": now})
    store.set("persons/person-1", {"fullName": "TAN AH KOW", "icHash": None, "icLast4": None, "isSynthetic": True})
    store.set("persons/person-2", {"fullName": "SITI BINTI AHMAD", "icHash": None, "icLast4": None, "isSynthetic": True})


class Clock:
    def __init__(self, start: datetime | None = None):
        self.t = start or datetime(2026, 10, 17, 4, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.t


class ScriptedExtractor:
    """按证件类型返回预设字段；值是异常实例就抛。calls 记录被调用的证件类型。"""

    def __init__(self, script: dict):
        self.script = script
        self.calls: list[str] = []

    def extract(self, doc_type: str, image: bytes, mime_type: str):
        from worker.gemini import ExtractionResult
        from worker.fields import normalize_field

        self.calls.append(doc_type)
        item = self.script.get(doc_type)
        if isinstance(item, Exception):
            raise item
        fields = {k: normalize_field(k, v[0], v[0], v[1]) for k, v in (item or {}).items()}
        return ExtractionResult(fields=fields, model="fake-extractor", seconds=0.01, usage={"promptTokens": 1, "outputTokens": 1})
