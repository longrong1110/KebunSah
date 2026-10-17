"""按地块 / 文件取数据并做访问控制，接口之间共用。"""
from __future__ import annotations

from .auth import User, can_access_plot
from .errors import ApiError, forbidden, not_found
from .store import Store


def load_plot(store: Store, user: User, plot_id: str) -> dict:
    plot = store.get(f"plots/{plot_id}")
    if plot is None:
        raise not_found("plot_not_found", "plot does not exist")
    if not can_access_plot(user, plot):
        raise forbidden("this plot belongs to someone else")
    return plot


def load_document(store: Store, user: User, document_id: str) -> tuple[str, dict, dict]:
    """返回 (文档路径, 文档, 所属地块)。"""
    found = store.find_in_group("documents", document_id)
    if found is None:
        raise not_found("document_not_found", "document does not exist")
    path, doc = found
    plot = load_plot(store, user, doc.get("plotId") or path.split("/")[1])
    return path, doc, plot


def conflict(code: str, message: str, **extra) -> ApiError:
    return ApiError(409, code, message, extra)
