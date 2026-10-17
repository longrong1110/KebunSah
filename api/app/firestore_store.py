"""Store 的 Firestore 实现（Admin / 服务端 SDK）。设了 FIRESTORE_EMULATOR_HOST 就连本机模拟器（SDK 自己读这个变量）。"""
from __future__ import annotations

from typing import Any

from .store import NotFoundError, Where


class FirestoreStore:
    def __init__(self, project_id: str):
        from google.cloud import firestore

        self._firestore = firestore
        self.db = firestore.Client(project=project_id)

    def get(self, path: str) -> dict | None:
        snap = self.db.document(path).get()
        return snap.to_dict() if snap.exists else None

    def set(self, path: str, data: dict) -> None:
        self.db.document(path).set(data)

    def update(self, path: str, data: dict) -> None:
        from google.api_core.exceptions import NotFound

        try:
            self.db.document(path).update(data)
        except NotFound as exc:
            raise NotFoundError(path) from exc

    def update_nested(self, path: str, field_path: tuple[str, ...], value: Any) -> None:
        from google.api_core.exceptions import NotFound
        from google.cloud.firestore_v1.field_path import FieldPath

        try:
            # FieldPath 把含点的键（land_title.lot_no）整体转义成一段，不会被拆成嵌套的两层
            self.db.document(path).update({FieldPath(*field_path).to_api_repr(): value})
        except NotFound as exc:
            raise NotFoundError(path) from exc

    def list(self, collection: str, where: Where = ()) -> list[tuple[str, dict]]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        query: Any = self.db.collection(collection)
        for field, op, value in where:
            if op not in {"==", "!=", "in"}:
                raise ValueError(f"unsupported operator {op!r}")
            query = query.where(filter=FieldFilter(field, op, value))
        return [(snap.id, snap.to_dict()) for snap in query.stream()]

    def find_in_group(self, group: str, doc_id: str) -> tuple[str, dict] | None:
        # 按文档 id 查集合组需要完整路径，所以扫一遍（只取引用、不取字段），原型规模（约一千份文件）够用
        for ref in self.db.collection_group(group).select([]).stream():
            if ref.id == doc_id:
                data = self.get(ref.reference.path)
                return (ref.reference.path, data) if data is not None else None
        return None
