"""证件字段的键、规范化与取值。Gemini 读出来的东西进规则之前先过这里：日期、面积、单位都再校验一遍。

约定（与 contract/firestore.md 一致）：fields 的键是 "<docType>.<字段名>"，值是 {rawText, normalizedValue, confidence}，
用户在屏 8 确认过的另有 confirmedValue / confirmedBy / confirmedAt；取值时 confirmedValue 优先。
格式认不出来的字段不丢：原样存下并把置信度压到 0.3 以下，这样它会落进"请用户确认"（置信度 < 0.7）而不是悄悄变成别的值。
"""
from __future__ import annotations

import math
import re
from collections.abc import Mapping
from datetime import date
from typing import Any

from kebunsah_core.masking import mask_ic_in_text
from kebunsah_core.units import fmt_fixed

MAX_PROPRIETORS = 4

ALLOWED_KEYS: dict[str, tuple[str, ...]] = {
    "land_title": ("land_title.lot_no", "land_title.title_no", "land_title.area_value", "land_title.area_unit",
                   "land_title.tenure", "land_title.lease_expiry",
                   *(f"land_title.proprietor_{n}_name" for n in range(1, MAX_PROPRIETORS + 1))),
    "mpob_licence": ("mpob_licence.licence_no", "mpob_licence.holder_name", "mpob_licence.valid_until"),
    "mspo_cert": ("mspo_cert.cert_no", "mspo_cert.certificate_holder", "mspo_cert.expiry_date"),
}

DATE_KEYS = frozenset({"land_title.lease_expiry", "mpob_licence.valid_until", "mspo_cert.expiry_date"})
NAME_KEYS = frozenset({*(f"land_title.proprietor_{n}_name" for n in range(1, MAX_PROPRIETORS + 1)),
                       "mpob_licence.holder_name", "mspo_cert.certificate_holder"})
LOW_CONFIDENCE_CAP = 0.3

_MONTHS = {
    "jan": 1, "januari": 1, "january": 1, "feb": 2, "februari": 2, "february": 2, "mac": 3, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "mei": 5, "may": 5, "jun": 6, "june": 6, "julai": 7, "jul": 7, "july": 7,
    "ogos": 8, "ogo": 8, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "okt": 10, "oktober": 10,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dis": 12, "disember": 12, "dec": 12, "december": 12,
}
_UNITS = {
    "ha": "ha", "hektar": "ha", "hek": "ha", "hectare": "ha", "hectares": "ha",
    "ekar": "acre", "acre": "acre", "acres": "acre", "ac": "acre",
    "sqm": "sqm", "m2": "sqm", "m²": "sqm", "mps": "sqm", "meterpersegi": "sqm", "sqmeter": "sqm",
    "sqft": "sqft", "ft2": "sqft", "ft²": "sqft", "kps": "sqft", "kakipersegi": "sqft", "sqfeet": "sqft",
}


def _valid_date(y: int, m: int, d: int) -> str | None:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def parse_date(text: Any) -> str | None:
    """YYYY-MM-DD；也认 DD/MM/YYYY、DD-MM-YYYY、DD.MM.YYYY、"5 Disember 2026"。认不出返回 None。马来西亚是日在前。"""
    if not isinstance(text, str):
        return None
    s = text.strip()
    if m := re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s):
        return _valid_date(int(m[1]), int(m[2]), int(m[3]))
    if m := re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", s):
        return _valid_date(int(m[3]), int(m[2]), int(m[1]))
    if m := re.fullmatch(r"(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})", s):
        month = _MONTHS.get(m[2].lower())
        return _valid_date(int(m[3]), month, int(m[1])) if month else None
    return None


def parse_number(text: Any) -> float | None:
    """"3.04"、"3,04"、"1,234.50"、"3.04 Hektar" → 数值。认不出、非有限、非正返回 None。"""
    if isinstance(text, bool):
        return None
    if isinstance(text, (int, float)):
        value = float(text)
        return value if math.isfinite(value) and value > 0 else None
    if not isinstance(text, str):
        return None
    if re.match(r"\s*-", text):  # 负数不是面积
        return None
    m = re.search(r"\d[\d.,]*", text.strip())
    if not m:
        return None
    raw = m[0].rstrip(".,")
    if "," in raw and "." in raw:
        raw = raw.replace(",", "")
    elif "," in raw:
        head, _, tail = raw.rpartition(",")
        raw = f"{head.replace(',', '')}.{tail}" if len(tail) <= 2 else raw.replace(",", "")
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if math.isfinite(value) and value > 0 else None


def parse_unit(text: Any) -> str | None:
    if not isinstance(text, str):
        return None
    return _UNITS.get(re.sub(r"[\s.\-_]", "", text.lower()))


def clean_name(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().upper()


def _confidence(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return 0.0
    return min(1.0, max(0.0, float(value)))


def normalize_field(key: str, raw: Any, value: Any, confidence: Any) -> dict[str, Any]:
    """Gemini 给的 (原文, 值, 置信度) → 存进 documents.fields 的 {rawText, normalizedValue, confidence}。"""
    conf = _confidence(confidence)
    raw_text = mask_ic_in_text(str(raw if raw is not None else value or "").strip())[:200]
    shown = "" if value is None else str(value).strip()
    normalized: str | None = None
    if key in DATE_KEYS:
        normalized = parse_date(shown) or parse_date(raw_text)
    elif key == "land_title.area_value":
        number = parse_number(shown) or parse_number(raw_text)
        normalized = fmt_fixed(number, 4) if number is not None else None
    elif key == "land_title.area_unit":
        normalized = parse_unit(shown) or parse_unit(raw_text)
    elif key in NAME_KEYS:
        normalized = clean_name(shown) or None
    else:
        normalized = shown or None
    if normalized is None:
        # 认不出：原样存、置信度压低，交给屏 8 请用户确认
        normalized = shown or raw_text
        conf = min(conf, LOW_CONFIDENCE_CAP)
    return {"rawText": raw_text, "normalizedValue": normalized, "confidence": round(conf, 2)}


def effective(field: Mapping[str, Any] | None) -> str | None:
    """用户确认过的值优先于读出的值。没有或是空串返回 None。"""
    if not isinstance(field, Mapping):
        return None
    for name in ("confirmedValue", "normalizedValue"):
        v = field.get(name)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return None
