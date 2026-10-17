"""POST /api/me：首次登录建档。只能建 smallholder；外勤和管理员由种子或 Admin SDK 预建，角色不能自己申请。"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .auth import get_claims
from .deps import Deps, get_deps

router = APIRouter()


class MeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")  # 请求里带 role 之类的字段一律忽略
    fullName: str | None = None
    language: Literal["ms", "en"] = "ms"


def _view(uid: str, doc: dict) -> dict[str, Any]:
    return {"uid": uid, "role": doc["role"], "language": doc.get("language") or "ms",
            "personId": doc.get("personId"), "coopId": doc.get("coopId")}


@router.post("/api/me")
def post_me(body: MeRequest | None = None, claims: dict = Depends(get_claims), deps: Deps = Depends(get_deps)):
    body = body or MeRequest()
    uid = claims["uid"]
    now = deps.now()
    existing = deps.store.get(f"users/{uid}")
    if existing is not None:
        deps.store.update(f"users/{uid}", {"lastLoginAt": now})
        return _view(uid, existing)

    name = (body.fullName or claims.get("name") or claims.get("phone_number") or "").strip()
    person_id = deps.new_id()
    deps.store.set(f"persons/{person_id}", {"fullName": name, "icHash": None, "icLast4": None,
                                            "isSynthetic": False, "createdAt": now})
    doc = {"phone": claims.get("phone_number"), "role": "smallholder", "language": body.language,
           "personId": person_id, "coopId": None, "lastLoginAt": now, "isSynthetic": False, "createdAt": now}
    deps.store.set(f"users/{uid}", doc)
    return JSONResponse(status_code=201, content=_view(uid, doc))
