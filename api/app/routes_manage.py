"""DELETE /api/plots/{id}（删掉整块地和它的文件、评估）、DELETE /api/documents/{id}（删掉其中一张照片）。

演示用的模拟数据（isSynthetic）不让删：评委登录后点删除，不能把后面的人要看的演示地块删光。
评估正在跑时也不让删，免得流水线往一块已经没有的地里写。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response

from .access import conflict, load_document, load_plot
from .auth import User, get_editor
from .deps import Deps, get_deps
from .errors import ApiError

router = APIRouter()
log = logging.getLogger(__name__)


def _assessment_running(deps: Deps, plot_id: str) -> str | None:
    """正在跑（且没过期）的评估 id；过期的残留不算。"""
    from .routes_assess import _is_stale

    now = deps.now()
    for assessment_id, row in deps.store.list(f"plots/{plot_id}/assessments", [("runStatus", "in", ["queued", "running"])]):
        if not _is_stale(row, now, deps.settings.stale_after_s):
            return assessment_id
    return None


def _drop_blob(deps: Deps, doc: dict) -> None:
    path = doc.get("storagePath")
    if not path:
        return
    try:
        deps.blobs.delete(path)
    except Exception:  # 照片删不掉不拦着用户删数据：库里的记录没了，孤儿对象由存储桶的生命周期规则清理
        log.warning("could not delete blob %s", path, exc_info=True)


@router.delete("/api/plots/{plot_id}", status_code=204)
def delete_plot(plot_id: str, user: User = Depends(get_editor), deps: Deps = Depends(get_deps)):
    plot = load_plot(deps.store, user, plot_id)
    if plot.get("isSynthetic"):
        raise ApiError(403, "demo_data_protected", "demo plots cannot be deleted")
    running = _assessment_running(deps, plot_id)
    if running:
        raise conflict("assessment_in_progress", "wait for the running check to finish before deleting", assessmentId=running)
    for _, doc in deps.store.list(f"plots/{plot_id}/documents"):
        _drop_blob(deps, doc)
    deps.store.delete_tree(f"plots/{plot_id}")
    return Response(status_code=204)


@router.delete("/api/documents/{document_id}", status_code=204)
def delete_document(document_id: str, user: User = Depends(get_editor), deps: Deps = Depends(get_deps)):
    path, doc, plot = load_document(deps.store, user, document_id)
    if plot.get("isSynthetic") or doc.get("isSynthetic"):
        raise ApiError(403, "demo_data_protected", "demo documents cannot be deleted")
    plot_id = doc.get("plotId") or path.split("/")[1]
    running = _assessment_running(deps, plot_id)
    if running:
        raise conflict("assessment_in_progress", "wait for the running check to finish before deleting", assessmentId=running)
    _drop_blob(deps, doc)
    deps.store.delete(path)
    return Response(status_code=204)
