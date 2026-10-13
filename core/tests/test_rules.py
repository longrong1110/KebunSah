import pytest

from kebunsah_core.rules import (clean_name, cc01, cc02, cc02_missing_licence, cc03, is_unconfirmed_low,
                                 to_needs_review, valid_area_ha)

AS_OF = "2026-10-09"
NAN = float("nan")
INF = float("inf")


# ---- CC-01 面积 ----
def test_cc01_passes_within_tolerance():
    r = cc01(title_ha=4.2, plot_ha=4.23)
    assert (r.result, r.expected_value, r.actual_value) == ("pass", "4.2000 ha", "4.2300 ha")
    assert r.detail == "Beza 0.03 ha, dalam had yang dibenarkan"


def test_cc01_warns_above_tolerance():
    r = cc01(title_ha=3.04, plot_ha=3.49)
    assert (r.result, r.expected_value, r.actual_value) == ("warn", "3.0400 ha", "3.4900 ha")
    assert r.detail == "Lebih 0.45 ha (+14.8%), melebihi had 0.304 ha"


def test_cc01_fails_above_fifty_percent():
    r = cc01(title_ha=2.0, plot_ha=3.4)
    assert r.result == "fail"
    assert r.detail == "Lebih 70%, melebihi had 50%"


def test_cc01_tolerance_is_the_larger_of_ten_percent_and_a_tenth_of_a_hectare():
    assert cc01(title_ha=0.5, plot_ha=0.6).result == "pass"  # 10% = 0.05 < 0.1，容差取 0.1，刚好 0.1 通过
    assert cc01(title_ha=0.5, plot_ha=0.6001).result == "warn"


def test_cc01_does_not_judge_a_smaller_plot():
    assert cc01(title_ha=3.0, plot_ha=2.0).result == "pass"


def test_cc01_without_a_title_is_a_missing_document():
    r = cc01(title_ha=None, plot_ha=3.0)
    assert (r.result, r.doc_type, r.meta["kind"]) == ("fail", "land_title", "missing")


@pytest.mark.parametrize("title_ha", [0, 0.00001, -2.0])
def test_cc01_with_an_unusable_title_area_needs_review_instead_of_crashing(title_ha):
    r = cc01(title_ha=title_ha, plot_ha=1.0)
    assert r.result == "needs_review"
    assert (r.meta["kind"], r.meta["doc_type"]) == ("low_confidence", "land_title")


@pytest.mark.parametrize("title_ha", [NAN, INF, -INF, 1e9, 1e300, "3.0", True, False, 10**400, 2e9])
def test_cc01_with_a_title_area_that_is_not_a_usable_number_needs_review(title_ha):
    r = cc01(title_ha=title_ha, plot_ha=1.0)
    assert (r.result, r.doc_type, r.actual_value) == ("needs_review", None, "Luas geran tidak sah")
    assert (r.meta["kind"], r.meta["doc_type"]) == ("low_confidence", "land_title")
    assert cc01(title_ha=0, plot_ha=1.0) == r  # 和面积为 0 的那一行完全相同


def test_cc01_keeps_the_missing_row_for_none_and_accepts_the_largest_usable_area():
    assert cc01(title_ha=None, plot_ha=3.0).meta["kind"] == "missing"
    assert cc01(title_ha=999_999_999.0, plot_ha=3.0).result == "pass"
    assert cc01(title_ha=3, plot_ha=3.0).result == "pass"  # int 也行


@pytest.mark.parametrize("x,ok", [(3.0, True), (3, True), (0.0001, True), (0, False), (-1.0, False), (NAN, False),
                                  (INF, False), (1e9, False), (999_999_999.9, True), (True, False), ("3", False),
                                  (None, False), (10**400, False)])
def test_valid_area_ha(x, ok):
    assert valid_area_ha(x) is ok


# ---- CC-02 有效期 ----
def test_cc02_passes_with_plenty_of_time():
    r = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2027-03-31")
    assert (r.result, r.actual_value, r.expected_value, r.doc_type) == ("pass", "173 hari", ">= 90 hari", "mpob_licence")
    assert r.detail == "MPOB tamat pada 2027-03-31, 173 hari lagi"


def test_cc02_warns_when_under_ninety_days():
    r = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-12-05")
    assert (r.result, r.actual_value) == ("warn", "57 hari")


@pytest.mark.parametrize("expiry,result", [
    ("2027-01-07", "pass"),  # 刚好 90 天：不足 90 天才警告
    ("2027-01-06", "warn"),  # 89 天
    ("2026-10-09", "warn"),  # 到期当天算未过期
    ("2026-10-08", "fail"),  # 前一天已过期
])
def test_cc02_boundaries(expiry, result):
    assert cc02(as_of=AS_OF, doc_type="mspo_cert", label="MSPO", expiry_date=expiry).result == result


def test_cc02_expired_writes_a_date_prefixed_actual_value():
    r = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-04-30")
    assert (r.result, r.actual_value) == ("fail", "2026-04-30 telah tamat")
    assert r.meta["days"] == -162


@pytest.mark.parametrize("bad", ["31/12/2026", "", "2026-12-31T00:00:00Z", "2026-13-45", "2026-02-30", "20261231",
                                 "2026-W44-1", " 2026-12-31", None, 20261231])
def test_cc02_with_an_unreadable_expiry_date_needs_review_instead_of_crashing(bad):
    r = cc02(as_of=AS_OF, doc_type="land_title", label="sewaan", expiry_date=bad)
    assert (r.rule_code, r.result, r.expected_value, r.actual_value) == ("CC-02", "needs_review", ">= 90 hari",
                                                                        "Tarikh tidak sah")
    assert r.params_used == {"warn_days": 90}
    assert r.detail == "sewaan: tarikh tamat tidak sah, perlu disahkan"
    assert r.doc_type == "land_title"
    assert r.meta == {"kind": "low_confidence", "doc_type": "land_title", "label": "sewaan"}


def test_cc02_still_raises_for_an_invalid_as_of():
    # as_of 是调用方给的，写错是 bug，要响亮地报；不能被"日期读不准"那条路吞掉
    for bad in ("2026-13-45", "", "09/10/2026"):
        with pytest.raises(ValueError):
            cc02(as_of=bad, doc_type="mpob_licence", label="MPOB", expiry_date="2027-03-31")


def test_cc02_missing_licence_warns():
    r = cc02_missing_licence()
    assert (r.result, r.doc_type, r.actual_value) == ("warn", "mpob_licence", "Tiada lesen MPOB")


# ---- CC-03 姓名 ----
def test_cc03_passes_when_all_names_match():
    r = cc03(operator_name="TAN AH KOW", title_names=["TAN AH KOW"], licence_name="TAN AH KOW", member_name="TAN AH KOW")
    assert (r.result, r.actual_value, r.expected_value) == ("pass", "1.00", ">= 0.85")


def test_cc03_fails_when_the_title_is_in_the_late_father_name():
    r = cc03(operator_name="MUTHU A/L RAMAN", title_names=["RAMAN A/L SUBRAMANIAM"], licence_name="MUTHU A/L RAMAN")
    assert r.result == "fail"
    assert r.meta["label"] == "geran" and r.meta["name"] == "RAMAN A/L SUBRAMANIAM"


def test_cc03_picks_the_closest_of_several_proprietors():
    r = cc03(operator_name="AHMAD ZAKI BIN ROSLI", title_names=["SITI BINTI ALI", "AHMAD ZAKI BIN ROSLI"])
    assert r.result == "pass"


def test_cc03_takes_the_worst_of_title_licence_and_member_list():
    r = cc03(operator_name="TAN AH KOW", title_names=["TAN AH KOW"], licence_name="LIM MEI LING")
    assert (r.result, r.meta["label"]) == ("fail", "lesen MPOB")


def test_cc03_without_title_names_needs_review():
    r = cc03(operator_name="TAN AH KOW", title_names=[])
    assert (r.result, r.meta["kind"]) == ("needs_review", "missing")


@pytest.mark.parametrize("value,expected", [("TAN AH KOW", "TAN AH KOW"), ("  tan ah kow ", "  tan ah kow "),
                                            ("", None), ("   ", None), ("\t\n", None), (None, None), (5, None),
                                            (b"TAN", None), (["TAN"], None)])
def test_clean_name_returns_the_original_string_or_none(value, expected):
    assert clean_name(value) == expected


def test_cc03_drops_names_that_are_not_usable_strings():
    r = cc03(operator_name="TAN AH KOW", title_names=[None, "", "  ", "TAN AH KOW", 5])
    assert (r.result, r.actual_value) == ("pass", "1.00")
    only_junk = cc03(operator_name="TAN AH KOW", title_names=[None, "", "  "])
    assert (only_junk.result, only_junk.meta["kind"], only_junk.actual_value) == ("needs_review", "missing", "Tiada geran")


@pytest.mark.parametrize("licence,member", [("", None), ("  ", "   "), (None, None), (5, 7)])
def test_cc03_skips_licence_and_member_names_that_are_blank_or_not_strings(licence, member):
    r = cc03(operator_name="TAN AH KOW", title_names=["TAN AH KOW"], licence_name=licence, member_name=member)
    assert (r.result, r.actual_value) == ("pass", "1.00")


@pytest.mark.parametrize("operator", ["", "   ", None, 5])
def test_cc03_refuses_an_unusable_operator_name(operator):
    with pytest.raises(ValueError, match="operator_name must be a non-empty string"):
        cc03(operator_name=operator, title_names=["TAN AH KOW"])


# ---- 读出置信度 ----
@pytest.mark.parametrize("field,expected", [
    ({"confidence": 0.64}, True),
    ({"confidence": 0.69}, True),
    ({"confidence": 0.70}, False),  # 恰好 0.7 不算低于
    ({"confidence": 0.95}, False),
    ({"confidence": 0.64, "confirmedValue": "2026-12-05"}, False),  # 用户确认过
    ({"normalizedValue": "x"}, True),  # 有字段但没有置信度，按低处理
    (None, False),
    # 置信度不是正常的有限数（模型输出乱了）：按低处理，且不能抛错
    ({"confidence": "0.9"}, True),
    ({"confidence": True}, True),
    ({"confidence": False}, True),
    ({"confidence": NAN}, True),
    ({"confidence": INF}, True),
    ({"confidence": -INF}, True),
    ({"confidence": 1e308}, True),  # *100 会溢出
    ({"confidence": 10**400}, True),
    ({"confidence": [0.9]}, True),
    # 用户确认过就不算低，这一条先判
    ({"confidence": "0.9", "confirmedValue": "x"}, False),
    ({"confidence": NAN, "confirmedValue": "x"}, False),
    ({"confidence": None, "confirmedValue": "x"}, False),
])
def test_is_unconfirmed_low(field, expected):
    assert is_unconfirmed_low(field) is expected


def test_to_needs_review_keeps_expected_value_and_records_the_doc_type():
    base = cc01(title_ha=3.04, plot_ha=3.05)
    r = to_needs_review(base, {"confidence": 0.59}, "land_title")
    assert (r.result, r.actual_value, r.expected_value) == ("needs_review", "keyakinan bacaan 0.59", "3.0400 ha")
    assert r.meta["kind"] == "low_confidence" and r.meta["doc_type"] == "land_title"
    assert base.result == "pass"  # 不改原对象


@pytest.mark.parametrize("confidence", [None, "0.9", NAN, INF, -INF, True, 1e308, -1e308, 10**400, [0.5]])
def test_to_needs_review_shows_a_question_mark_for_a_confidence_that_is_not_a_finite_number(confidence):
    r = to_needs_review(cc01(title_ha=3.04, plot_ha=3.05), {"confidence": confidence}, "land_title")
    assert (r.result, r.actual_value) == ("needs_review", "keyakinan bacaan ?")


def test_to_needs_review_still_shows_ordinary_confidences():
    base = cc01(title_ha=3.04, plot_ha=3.05)
    assert to_needs_review(base, {"confidence": 0.5}, "land_title").actual_value == "keyakinan bacaan 0.50"
    assert to_needs_review(base, {"confidence": 0}, "land_title").actual_value == "keyakinan bacaan 0.00"


def test_rule_result_to_doc_uses_the_firestore_shape():
    doc = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-12-05").to_doc()
    assert set(doc) == {"ruleCode", "result", "expectedValue", "actualValue", "paramsUsed", "evidence", "detail", "docType"}
    assert doc["paramsUsed"] == {"warn_days": 90} and doc["evidence"] == []
    assert "docType" not in cc01(title_ha=3.0, plot_ha=3.0).to_doc()
