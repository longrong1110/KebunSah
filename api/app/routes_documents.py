"""POST /api/plots/{id}/documents：登记一份证件并给 15 分钟有效的上传网址。
extractionStatus 不在这里写——照片真的传上去（流水线在 Storage 里看到对象）才设为 uploaded。"""
from __future__ import annotations

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .access import load_plot
from .auth import User, get_user
from .deps import Deps, get_deps

router = APIRouter()

UPLOAD_TTL_S = 900


class RegisterDocument(BaseModel):
    model_config = ConfigDict(extra="ignore")
    docType: Literal["land_title", "mpob_licence", "mspo_cert"]
    contentType: Literal["image/jpeg"]
    source: Literal["camera", "gallery"]


@router.post("/api/plots/{plot_id}/documents", status_code=201)
def register_document(plot_id: str, body: RegisterDocument, user: User = Depends(get_user),
                      deps: Deps = Depends(get_deps)):
    load_plot(deps.store, user, plot_id)
    now = deps.now()
    # 同一块地同一种证件重拍：旧的作废（不删），新的接替
    for old_id, old in deps.store.list(f"plots/{plot_id}/documents", [("docType", "==", body.docType)]):
        if old.get("isCurrent") is not False:
            deps.store.update(f"plots/{plot_id}/documents/{old_id}", {"isCurrent": False})
    doc_id = deps.new_id()
    storage_path = f"plots/{plot_id}/documents/{doc_id}.jpg"
    deps.store.set(f"plots/{plot_id}/documents/{doc_id}", {
        "documentId": doc_id, "plotId": plot_id, "docType": body.docType, "pageNo": 1, "isCurrent": True,
        "storagePath": storage_path, "mimeType": body.contentType, "sha256": None, "source": body.source,
        "uploadedBy": user.uid, "capturedAt": now, "extractedAt": None, "modelVersion": None, "fields": {},
        "isSynthetic": False, "createdAt": now,
    })
    url = deps.blobs.upload_url(storage_path, body.contentType, UPLOAD_TTL_S)
    expires = (now + timedelta(seconds=UPLOAD_TTL_S)).isoformat().replace("+00:00", "Z")
    return JSONResponse(status_code=201, content={
        "documentId": doc_id,
        "upload": {"method": "PUT", "url": url, "headers": {"Content-Type": body.contentType}, "expiresAt": expires}})
