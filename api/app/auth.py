"""鉴权：Authorization: Bearer <Firebase ID token> → uid → users/{uid}（role、coopId、personId）。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import Depends, Request

from .deps import Deps, get_deps
from .errors import ApiError, forbidden


class InvalidToken(Exception):
    pass


class TokenVerifier(Protocol):
    def verify(self, token: str) -> dict[str, Any]:
        """成功返回 {"uid": ..., "phone_number": ..., "name": ...}；无效 / 过期抛 InvalidToken。"""


class FirebaseTokenVerifier:
    """Firebase Admin SDK。设了 FIREBASE_AUTH_EMULATOR_HOST 就连 Auth 模拟器（SDK 自己读这个变量）。"""

    def __init__(self, project_id: str):
        import firebase_admin

        try:
            firebase_admin.get_app()
        except ValueError:
            firebase_admin.initialize_app(options={"projectId": project_id})

    def verify(self, token: str) -> dict[str, Any]:
        from firebase_admin import auth

        try:
            decoded = auth.verify_id_token(token)
        except Exception as exc:  # 过期、签名不对、证书取不到……对调用者都是 401
            raise InvalidToken(str(exc)) from exc
        return {"uid": decoded["uid"], "phone_number": decoded.get("phone_number"), "name": decoded.get("name")}


@dataclass(frozen=True)
class User:
    uid: str
    role: str  # smallholder | field_officer | coop_admin
    coop_id: str | None
    person_id: str | None
    language: str = "ms"

    @property
    def is_staff(self) -> bool:
        return self.role in {"field_officer", "coop_admin"}


def get_claims(request: Request, deps: Deps = Depends(get_deps)) -> dict[str, Any]:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "unauthenticated", "missing bearer token")
    try:
        return deps.verifier.verify(token.strip())
    except InvalidToken:
        raise ApiError(401, "invalid_token", "token is invalid or expired") from None


def get_user(claims: dict[str, Any] = Depends(get_claims), deps: Deps = Depends(get_deps)) -> User:
    doc = deps.store.get(f"users/{claims['uid']}")
    if doc is None:
        raise forbidden("profile has not been created; call POST /api/me first")
    return User(uid=claims["uid"], role=doc.get("role", "smallholder"), coop_id=doc.get("coopId"),
                person_id=doc.get("personId"), language=doc.get("language") or "ms")


def can_access_plot(user: User, plot: dict) -> bool:
    """园主只能碰自己的地块；外勤和合作社管理员只能碰自己合作社的。"""
    if user.is_staff:
        return user.coop_id is not None and plot.get("coopId") == user.coop_id
    return user.person_id is not None and plot.get("operatorPersonId") == user.person_id
