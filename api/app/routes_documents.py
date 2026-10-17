"""POST /api/plots/{id}/documents：登记一份证件并给 15 分钟有效的上传网址。
extractionStatus 不在这里写——照片真的传上去（流水线在 Storage 里看到对象）才设为 uploaded。"""
from __future__ import annotations

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from kebunsah_core.units import fmt_fixed
from worker.fields import ALLOWED_KEYS, DATE_KEYS, NAME_KEYS, clean_name, parse_date, parse_number, parse_unit

from .access import load_document, load_plot
from .auth import User, get_user
from .deps import Deps, get_deps
from .errors import ApiError, not_found

router = APIRouter()

UPLOAD_TTL_S = 900


class RegisterDocument(BaseModel):
    model_config = ConfigDict(extra="ignore")
    docType: Literal["land_title", "mpob_licence", "mspo_cert"]
    contentType: Literal["image/jpeg"]
    source: Literal["camera", "gallery"]
    pageNo: int = Field(default=1, ge=1, le=4)  # 一份证件多页（地契正面、背面）；不传就是第 1 页


@router.post("/api/plots/{plot_id}/documents", status_code=201)
def register_document(plot_id: str, body: RegisterDocument, user: User = Depends(get_user),
                      deps: Deps = Depends(get_deps)):
    load_plot(deps.store, user, plot_id)
    now = deps.now()
    # 同一块地同一种证件的同一页重拍：旧的作废（不删），新的接替
    for old_id, old in deps.store.list(f"plots/{plot_id}/documents", [("docType", "==", body.docType)]):
        if old.get("isCurrent") is not False and (old.get("pageNo") or 1) == body.pageNo:
            deps.store.update(f"plots/{plot_id}/documents/{old_id}", {"isCurrent": False})
    doc_id = deps.new_id()
    storage_path = f"plots/{plot_id}/documents/{doc_id}.jpg"
    deps.store.set(f"plots/{plot_id}/documents/{doc_id}", {
        "documentId": doc_id, "plotId": plot_id, "docType": body.docType, "pageNo": body.pageNo, "isCurrent": True,
        "storagePath": storage_path, "mimeType": body.contentType, "sha256": None, "source": body.source,
        "uploadedBy": user.uid, "capturedAt": now, "extractedAt": None, "modelVersion": None, "fields": {},
        "isSynthetic": False, "createdAt": now,
    })
    url = deps.blobs.upload_url(storage_path, body.contentType, UPLOAD_TTL_S)
    expires = (now + timedelta(seconds=UPLOAD_TTL_S)).isoformat().replace("+00:00", "Z")
    return JSONResponse(status_code=201, content={
        "documentId": doc_id,
        "upload": {"method": "PUT", "url": url, "headers": {"Content-Type": body.contentType}, "expiresAt": expires}})


class ConfirmFields(BaseModel):
    model_config = ConfigDict(extra="ignore")
    fields: dict[str, str | int | float]


def _clean_confirmed(key: str, value: Any) -> str:
    """用户确认的值再校验一遍并规范成和读出值同样的格式；不合格抛 400。"""
    if isinstance(value, bool):
        raise ApiError(400, "invalid_value", f"{key}: value must be text or a number")
    text = str(value).strip()
    if key in DATE_KEYS:
        cleaned = parse_date(text)
    elif key == "land_title.area_value":
        number = parse_number(text)
        cleaned = fmt_fixed(number, 4) if number is not None else None
    elif key == "land_title.area_unit":
        cleaned = parse_unit(text)
    elif key in NAME_KEYS:
        cleaned = clean_name(text) or None
    else:
        cleaned = text if 0 < len(text) <= 200 else None
    if cleaned is None:
        raise ApiError(400, "invalid_value", f"{key}: value is not in the expected format")
    return cleaned


@router.patch("/api/documents/{document_id}/fields")
def confirm_fields(document_id: str, body: ConfirmFields, user: User = Depends(get_user), deps: Deps = Depends(get_deps)):
    path, doc, _ = load_document(deps.store, user, document_id)
    if not body.fields:
        raise ApiError(400, "no_fields", "fields must not be empty")
    known = set(doc.get("fields") or {}) | set(ALLOWED_KEYS.get(doc.get("docType"), ()))
    cleaned: dict[str, str] = {}
    for key, value in body.fields.items():  # 先全部校验，再写，免得写一半
        if key not in known:
            raise ApiError(400, "unknown_field", f"{key} is not a field of this document")
        cleaned[key] = _clean_confirmed(key, value)
    now = deps.now()
    existing = doc.get("fields") or {}
    for key, value in cleaned.items():
        if key not in existing:  # 模型没读到、用户补上的字段
            deps.store.update_nested(path, ("fields", key), {"rawText": "", "normalizedValue": "", "confidence": 0.0})
        deps.store.update_nested(path, ("fields", key, "confirmedValue"), value)
        deps.store.update_nested(path, ("fields", key, "confirmedBy"), user.uid)
        deps.store.update_nested(path, ("fields", key, "confirmedAt"), now)
    fresh = deps.store.get(path) or {}
    if fresh.get("extractionStatus") == "needs_review":
        from kebunsah_core.rules import is_unconfirmed_low

        still_low = any(is_unconfirmed_low(f, deps.params) for f in (fresh.get("fields") or {}).values())
        if fresh.get("fields") and not still_low:
            deps.store.update(path, {"extractionStatus": "extracted"})
    return {"documentId": document_id,
            "fields": {k: {"confirmedValue": v, "confirmedAt": now.isoformat().replace("+00:00", "Z")} for k, v in cleaned.items()}}


@router.get("/api/documents/{document_id}/image")
def document_image(document_id: str, user: User = Depends(get_user), deps: Deps = Depends(get_deps)):
    _, doc, _ = load_document(deps.store, user, document_id)
    storage_path = doc.get("storagePath")
    if not storage_path or not deps.blobs.exists(storage_path):
        raise not_found("image_not_found", "no photo has been uploaded for this document")
    now = deps.now()
    return {"url": deps.blobs.read_url(storage_path, UPLOAD_TTL_S),
            "expiresAt": (now + timedelta(seconds=UPLOAD_TTL_S)).isoformat().replace("+00:00", "Z")}
