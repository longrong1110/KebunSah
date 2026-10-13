"""姓名相似度：归一化后的编辑距离比，范围 0–1。算法与 seed/src/similarity.mjs 相同（1 - 编辑距离 / 较长长度）。"""
from __future__ import annotations

from rapidfuzz.distance import Levenshtein


def normalize_name(s: str) -> str:
    return " ".join(s.upper().split())


def similarity(a: str, b: str) -> float:
    x, y = normalize_name(a), normalize_name(b)
    if max(len(x), len(y)) == 0:
        return 1.0
    return Levenshtein.normalized_similarity(x, y)
