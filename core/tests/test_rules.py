import pytest

from kebunsah_core.rules import (cc01, cc02, cc02_missing_licence, cc03, is_unconfirmed_low,
                                 to_needs_review)

AS_OF = "2026-10-09"


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


# ---- 读出置信度 ----
@pytest.mark.parametrize("field,expected", [
    ({"confidence": 0.64}, True),
    ({"confidence": 0.69}, True),
    ({"confidence": 0.70}, False),  # 恰好 0.7 不算低于
    ({"confidence": 0.95}, False),
    ({"confidence": 0.64, "confirmedValue": "2026-12-05"}, False),  # 用户确认过
    ({"normalizedValue": "x"}, True),  # 有字段但没有置信度，按低处理
    (None, False),
])
def test_is_unconfirmed_low(field, expected):
    assert is_unconfirmed_low(field) is expected


def test_to_needs_review_keeps_expected_value_and_records_the_doc_type():
    base = cc01(title_ha=3.04, plot_ha=3.05)
    r = to_needs_review(base, {"confidence": 0.59}, "land_title")
    assert (r.result, r.actual_value, r.expected_value) == ("needs_review", "keyakinan bacaan 0.59", "3.0400 ha")
    assert r.meta["kind"] == "low_confidence" and r.meta["doc_type"] == "land_title"
    assert base.result == "pass"  # 不改原对象


def test_rule_result_to_doc_uses_the_firestore_shape():
    doc = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-12-05").to_doc()
    assert set(doc) == {"ruleCode", "result", "expectedValue", "actualValue", "paramsUsed", "evidence", "detail", "docType"}
    assert doc["paramsUsed"] == {"warn_days": 90} and doc["evidence"] == []
    assert "docType" not in cc01(title_ha=3.0, plot_ha=3.0).to_doc()
