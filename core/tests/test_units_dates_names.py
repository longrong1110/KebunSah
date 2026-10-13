import pytest

from kebunsah_core.dates import diff_days
from kebunsah_core.names import normalize_name, similarity
from kebunsah_core.units import fmt_fixed, fmt_num, to_ha, to_ten_thousandths


def test_to_ha_converts_every_unit():
    assert to_ha(4.2, "ha") == 4.2
    assert to_ha(40000, "sqm") == 4.0
    assert to_ha(10, "acre") == 4.0469
    assert to_ha(1000, "sqft") == 0.0093


def test_to_ha_rejects_unknown_unit():
    with pytest.raises(ValueError):
        to_ha(1, "ruai")


def test_to_ten_thousandths_is_an_integer():
    assert to_ten_thousandths(3.04) == 30400
    assert to_ten_thousandths(4.23) == 42300


def test_fmt_fixed_rounds_half_away_from_zero_like_javascript():
    assert fmt_fixed(0.125, 2) == "0.13"  # Python 的 format 会给 0.12
    assert fmt_fixed(2.5, 0) == "3"
    assert fmt_fixed(3.04, 4) == "3.0400"
    assert fmt_fixed(14.8148, 1) == "14.8"


def test_fmt_num_drops_trailing_zero():
    assert fmt_num(50.0) == "50"
    assert fmt_num(0.5) == "0.5"


def test_diff_days_counts_calendar_days():
    assert diff_days("2026-10-09", "2026-12-05") == 57
    assert diff_days("2026-10-09", "2026-10-09") == 0
    assert diff_days("2026-10-09", "2026-04-30") == -162
    assert diff_days("2028-02-28", "2028-03-01") == 2  # 闰年


def test_normalize_name_uppercases_and_collapses_spaces():
    assert normalize_name("  tan   ah kow ") == "TAN AH KOW"


def test_similarity_is_edit_distance_over_longer_length():
    assert similarity("TAN AH KOW", "tan ah  kow") == 1.0
    assert similarity("AHMAD ZAKI BIN ROSLI", "AHMAD ZAKI B ROSLI") == pytest.approx(0.9)
    assert similarity("TAN AH KOW", "TAN AH KAU") == pytest.approx(0.8)  # 低于 0.85，会被判不通过
    assert similarity("", "") == 1.0
