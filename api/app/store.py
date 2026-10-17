"""文档存储适配器。流水线和接口只依赖 Store；线上是 Firestore（firestore_store.py），测试用内存实现。

路径是 Firestore 风格的 "集合/文档/集合/文档"。含点的字段键（land_title.lot_no）只能用 update_nested 局部更新。
"""
from __future__ import annotations

import copy
import threading
from collections.abc import Sequence
from typing import Any, Protocol

Where = Sequence[tuple[str, str, Any]]  # (字段, "==" | "!=" | "in", 值)


class NotFoundError(KeyError):
    pass


class Store(Protocol):
    def get(self, path: str) -> dict | None: ...

    def set(self, path: str, data: dict) -> None:
        """整篇替换（不存在就创建）。"""

    def update(self, path: str, data: dict) -> None:
        """合并顶层字段；文档不存在抛 NotFoundError。"""

    def update_nested(self, path: str, field_path: tuple[str, ...], value: Any) -> None:
        """只改 field_path 指向的那一项，路径各段原样当键（含点的键不拆）；文档不存在抛 NotFoundError。"""

    def list(self, collection: str, where: Where = ()) -> list[tuple[str, dict]]:
        """返回 [(文档 id, 数据)]。"""

    def find_in_group(self, group: str, doc_id: str) -> tuple[str, dict] | None:
        """在所有叫 group 的子集合里按文档 id 找，返回 (完整路径, 数据)。"""


def matches(data: dict, where: Where) -> bool:
    for field, op, value in where:
        actual = data.get(field)
        if op == "==":
            if actual != value:
                return False
        elif op == "!=":
            if actual == value:
                return False
        elif op == "in":
            if actual not in value:
                return False
        else:
            raise ValueError(f"unsupported operator {op!r}")
    return True


class MemoryStore:
    def __init__(self) -> None:
        self._docs: dict[str, dict] = {}
        self._lock = threading.RLock()

    def get(self, path: str) -> dict | None:
        with self._lock:
            doc = self._docs.get(path)
            return copy.deepcopy(doc) if doc is not None else None

    def set(self, path: str, data: dict) -> None:
        with self._lock:
            self._docs[path] = copy.deepcopy(data)

    def update(self, path: str, data: dict) -> None:
        with self._lock:
            if path not in self._docs:
                raise NotFoundError(path)
            self._docs[path].update(copy.deepcopy(data))

    def update_nested(self, path: str, field_path: tuple[str, ...], value: Any) -> None:
        if not field_path:
            raise ValueError("field_path must not be empty")
        with self._lock:
            if path not in self._docs:
                raise NotFoundError(path)
            node = self._docs[path]
            for part in field_path[:-1]:
                nxt = node.get(part)
                if not isinstance(nxt, dict):
                    nxt = node[part] = {}
                node = nxt
            node[field_path[-1]] = copy.deepcopy(value)

    def list(self, collection: str, where: Where = ()) -> list[tuple[str, dict]]:
        prefix = collection.rstrip("/") + "/"
        with self._lock:
            rows = [(p[len(prefix):], d) for p, d in self._docs.items()
                    if p.startswith(prefix) and "/" not in p[len(prefix):] and matches(d, where)]
            return [(i, copy.deepcopy(d)) for i, d in sorted(rows, key=lambda r: r[0])]

    def find_in_group(self, group: str, doc_id: str) -> tuple[str, dict] | None:
        with self._lock:
            for path, doc in self._docs.items():
                parts = path.split("/")
                if len(parts) >= 2 and parts[-2] == group and parts[-1] == doc_id:
                    return path, copy.deepcopy(doc)
        return None
