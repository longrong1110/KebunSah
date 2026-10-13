"""规则阈值。默认值取自 contract/schema.sql 的 rule_params；线上从 config/ruleParams 文档读。"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any


@dataclass(frozen=True)
class Params:
    area_tolerance_pct: float = 10
    area_tolerance_min_ha: float = 0.1
    area_fail_over_pct: float = 50
    expiry_warn_days: float = 90
    name_similarity_min: float = 0.85
    confidence_min: float = 0.7
    point_max_ha: float = 4
    smallholder_max_ha: float = 40.46


DEFAULT_PARAMS = Params()

# (规则编号, 参数名) → Params 字段名
_KEYS = {
    ("CC-01", "area_tolerance_pct"): "area_tolerance_pct",
    ("CC-01", "area_tolerance_min_ha"): "area_tolerance_min_ha",
    ("CC-01", "area_fail_over_pct"): "area_fail_over_pct",
    ("CC-02", "expiry_warn_days"): "expiry_warn_days",
    ("CC-03", "name_similarity_min"): "name_similarity_min",
    ("EXTRACT", "confidence_min"): "confidence_min",
    ("PLOT", "point_max_ha"): "point_max_ha",
    ("PLOT", "smallholder_max_ha"): "smallholder_max_ha",
}


def params_from_config(doc: Mapping[str, Any] | None) -> Params:
    """config/ruleParams 文档 → Params。文档形如 {"CC-01": {"area_tolerance_pct": {"value": 10, ...}}, ...}。
    缺的键用默认值，不认识的键忽略。"""
    if not doc:
        return DEFAULT_PARAMS
    updates: dict[str, Any] = {}
    for (rule_code, key), field_name in _KEYS.items():
        entry = (doc.get(rule_code) or {}).get(key)
        if isinstance(entry, Mapping) and isinstance(entry.get("value"), (int, float)):
            updates[field_name] = entry["value"]
    return replace(DEFAULT_PARAMS, **updates)
