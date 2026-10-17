import math

import pytest

from worker.fields import (ALLOWED_KEYS, effective, normalize_field, parse_date, parse_number, parse_unit)


@pytest.mark.parametrize("text,iso", [
    ("2026-12-05", "2026-12-05"), ("05/12/2026", "2026-12-05"), ("5-12-2026", "2026-12-05"),
    ("05.12.2026", "2026-12-05"), ("5 Disember 2026", "2026-12-05"), ("05 DEC 2026", "2026-12-05"),
    ("31 Mac 2027", "2027-03-31"), (" 2027-03-31 ", "2027-03-31"),
])
def test_parse_date(text, iso):
    assert parse_date(text) == iso


@pytest.mark.parametrize("text", ["", "besok", "31/02/2026", "2026-13-01", "12/2026", None, 20261205])
def test_parse_date_rejects_garbage(text):
    assert parse_date(text) is None


@pytest.mark.parametrize("text,value", [
    ("3.04", 3.04), ("3,04", 3.04), ("1,234.50", 1234.5), ("3.04 Hektar", 3.04), ("12,000", 12000.0), (2.5, 2.5),
])
def test_parse_number(text, value):
    assert parse_number(text) == pytest.approx(value)


@pytest.mark.parametrize("text", ["", "abc", "0", "-3", None, True, float("nan"), float("inf")])
def test_parse_number_rejects_garbage(text):
    assert parse_number(text) is None


@pytest.mark.parametrize("text,unit", [("Hektar", "ha"), ("HA", "ha"), ("ekar", "acre"), ("Acres", "acre"),
                                       ("m²", "sqm"), ("meter persegi", "sqm"), ("kps", "sqft"), ("km", None)])
def test_parse_unit(text, unit):
    assert parse_unit(text) == unit


def test_normalize_date_field():
    out = normalize_field("mpob_licence.valid_until", "05/12/2026", "05/12/2026", 0.91)
    assert out == {"rawText": "05/12/2026", "normalizedValue": "2026-12-05", "confidence": 0.91}


def test_unreadable_date_keeps_text_and_drops_confidence():
    out = normalize_field("mpob_licence.valid_until", "0?/12/2O26", "0?/12/2O26", 0.95)
    assert out["normalizedValue"] == "0?/12/2O26" and out["confidence"] <= 0.3


def test_normalize_area_and_unit():
    assert normalize_field("land_title.area_value", "3.04 Hektar", "3.04", 0.93)["normalizedValue"] == "3.0400"
    assert normalize_field("land_title.area_unit", "Hektar", "Hektar", 0.9)["normalizedValue"] == "ha"
    bad = normalize_field("land_title.area_value", "???", "???", 0.9)
    assert bad["confidence"] <= 0.3


def test_normalize_name_uppercases_and_squeezes():
    out = normalize_field("land_title.proprietor_1_name", "Tan  Ah Kow", "Tan  Ah   Kow", 0.9)
    assert out["normalizedValue"] == "TAN AH KOW"


def test_confidence_is_clamped_and_garbage_becomes_zero():
    assert normalize_field("land_title.lot_no", "12", "12", 7)["confidence"] == 1.0
    assert normalize_field("land_title.lot_no", "12", "12", "high")["confidence"] == 0.0
    assert normalize_field("land_title.lot_no", "12", "12", math.nan)["confidence"] == 0.0


def test_ic_numbers_in_raw_text_are_masked():
    out = normalize_field("land_title.proprietor_1_name", "TAN AH KOW 640101-08-5117", "TAN AH KOW", 0.9)
    assert "640101" not in out["rawText"] and "5117" in out["rawText"]


def test_effective_prefers_confirmed_value():
    assert effective({"normalizedValue": "2026-12-05", "confirmedValue": "2026-12-06"}) == "2026-12-06"
    assert effective({"normalizedValue": "2026-12-05"}) == "2026-12-05"
    assert effective({"normalizedValue": "  "}) is None
    assert effective(None) is None


def test_allowed_keys_are_prefixed_by_their_doc_type():
    for doc_type, keys in ALLOWED_KEYS.items():
        assert keys and all(k.startswith(doc_type + ".") for k in keys)
