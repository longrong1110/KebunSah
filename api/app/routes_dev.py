"""仅本地开发开启：收证件照的上传（PUT /dev/blobs/*）、给读取。线上用 GCS 签名网址，这些路由不挂。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from .blobs import LocalBlobs
from .deps import Deps, get_deps
from .errors import ApiError, not_found

router = APIRouter()

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def _local(deps: Deps) -> LocalBlobs:
    if not isinstance(deps.blobs, LocalBlobs):
        raise not_found("not_found", "not available")
    return deps.blobs


@router.put("/dev/blobs/{path:path}", status_code=200)
async def put_blob(path: str, request: Request, deps: Deps = Depends(get_deps)):
    blobs = _local(deps)
    data = await request.body()
    if not data:
        raise ApiError(422, "empty_upload", "upload body is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "upload_too_large", "upload is larger than 15 MB")
    try:
        blobs.write(path, data)
    except ValueError:
        raise not_found("not_found", "not available") from None
    return Response(status_code=200)


@router.get("/dev/blobs/{path:path}")
def get_blob(path: str, deps: Deps = Depends(get_deps)):
    blobs = _local(deps)
    try:
        if not blobs.exists(path):
            raise not_found("not_found", "no such blob")
        data = blobs.read_bytes(path)
    except ValueError:
        raise not_found("not_found", "not available") from None
    suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return Response(content=data, media_type=MEDIA_TYPES.get(suffix, "application/octet-stream"))
