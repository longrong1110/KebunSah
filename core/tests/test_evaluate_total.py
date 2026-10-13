"""evaluate_plot 对"从文件读出来的值"是全函数：Gemini 读错、用户填错，也只会得到 needs_review 的行，不会抛错；
只有程序员传错（plot_ha、as_of、operator_name）才抛 ValueError。"""
from __future__ import annotations

import itertools
import json

import pytest

from kebunsah_core.evaluate import Evaluation, PlotFacts, evaluate_plot

AS_OF = "2026-10-09"
OK = {"confidence": 0.95}
NAN = float("nan")
INF = float("inf")
STATUSES = {"green", "yellow", "red", "needs_review"}

GOOD = dict(operator_name="TAN AH KOW", plot_ha=3.0, title_ha=3.0, title_names=("TAN AH KOW",),
            licence_valid_until="2027-03-31", licence_name="TAN AH KOW", cert_expiry="2029-02-28",
            member_name="TAN AH KOW", in_mspo=True)
ALL_OK = {"area": OK, "valid_until": OK, "name": OK}


def facts(**over) -> PlotFacts:
    return PlotFacts(**{**GOOD, **over})


def assert_writable(ev: Evaluation) -> None:
    """将要写进 Firestore 的内容里不能有 NaN / inf。"""
    assert ev.status in STATUSES
    json.dumps([r.to_doc() for r in ev.results] + [g.to_doc() for g in ev.gaps], allow_nan=False)


def gap_keys(ev: Evaluation):
    return [(g.gap_code, g.doc_type) for g in ev.gaps]


# ---- 从不抛错 ----
TITLE_HA = [None, 0, -1.0, NAN, INF, 1e300, "3.0", True, 3.0]
EXPIRY = [None, "", "31/12/2026", "2026-12-31T00:00:00Z", "2026-13-45", "2026-12-31"]
TITLE_NAMES = [(), (None,), ("",), ("  ",), ("TAN AH KOW",)]
NAME_FIELD = [None, {"confidence": None}, {"confidence": "0.9"}, {"confidence": NAN}, {"confidence": 0.5},
              {"confidence": 0.95}]


def test_evaluate_plot_never_raises_on_garbage_from_the_documents():
    n = 0
    for title_ha, expiry, names, name_field in itertools.product(TITLE_HA, EXPIRY, TITLE_NAMES, NAME_FIELD):
        f = facts(title_ha=title_ha, licence_valid_until=expiry, title_names=names)
        try:
            ev = evaluate_plot(f, {"name": name_field}, as_of=AS_OF)
            assert_writable(ev)
        except Exception as exc:  # noqa: BLE001 - 要把是哪一组输入打出来
            pytest.fail(f"title_ha={title_ha!r} expiry={expiry!r} names={names!r} name_field={name_field!r}: {exc!r}")
        n += 1
    assert n == len(TITLE_HA) * len(EXPIRY) * len(TITLE_NAMES) * len(NAME_FIELD)


GARBAGE_CONFIDENCE = [None, "0.9", NAN, INF, -INF, True, False, 1e308, -1e308, 10**400, -10**400, 0.5, 0.95]


@pytest.mark.parametrize("key", ["area", "valid_until", "name"])
def test_garbage_confidence_never_raises_for_any_critical_field(key):
    for conf, title_ha, expiry in itertools.product(GARBAGE_CONFIDENCE, [3.0, None, NAN], ["2026-12-31", None, "x"]):
        f = facts(title_ha=title_ha, licence_valid_until=expiry)
        try:
            assert_writable(evaluate_plot(f, {key: {"confidence": conf}}, as_of=AS_OF))
        except Exception as exc:  # noqa: BLE001
            pytest.fail(f"{key} confidence={conf!r} title_ha={title_ha!r} expiry={expiry!r}: {exc!r}")


@pytest.mark.parametrize("bad_expiry", ["31/12/2026", "", "2026-12-31T00:00:00Z", "2026-13-45", "20261231", 20261231])
@pytest.mark.parametrize("which,doc_type", [("licence_valid_until", "mpob_licence"), ("lease_expiry", "land_title"),
                                            ("cert_expiry", "mspo_cert")])
def test_every_expiry_field_survives_garbage(which, doc_type, bad_expiry):
    ev = evaluate_plot(facts(**{which: bad_expiry}), ALL_OK, as_of=AS_OF)
    assert_writable(ev)
    bad = [r for r in ev.results if r.rule_code == "CC-02" and r.result == "needs_review"]
    assert [r.doc_type for r in bad] == [doc_type]
    assert (doc_type, "low_confidence") in [(g.doc_type, g.gap_code) for g in ev.gaps]


# ---- 具体情形 ----
def test_invalid_expiry_string_is_one_needs_review_row_not_a_crash():
    ev = evaluate_plot(facts(licence_valid_until="31/12/2026"), ALL_OK, as_of=AS_OF)
    bad = [r for r in ev.results if r.rule_code == "CC-02" and r.result == "needs_review"]
    assert len(bad) == 1
    row = bad[0]
    assert (row.doc_type, row.actual_value, row.expected_value) == ("mpob_licence", "Tarikh tidak sah", ">= 90 hari")
    assert row.params_used == {"warn_days": 90}
    assert row.meta == {"kind": "low_confidence", "doc_type": "mpob_licence", "label": "MPOB"}
    assert ev.status == "needs_review"
    assert ("low_confidence", "mpob_licence") in gap_keys(ev)
    # 另一份文件（MSPO 证书）照常评估
    assert [r.result for r in ev.results if r.doc_type == "mspo_cert"] == ["pass"]


def test_expiry_with_a_time_part_is_not_accepted():
    ev = evaluate_plot(facts(licence_valid_until="2026-12-31T00:00:00Z"), ALL_OK, as_of=AS_OF)
    assert [r.actual_value for r in ev.results if r.doc_type == "mpob_licence"] == ["Tarikh tidak sah"]


def test_nan_title_area_needs_review_with_a_land_title_gap():
    ev = evaluate_plot(facts(title_ha=NAN), ALL_OK, as_of=AS_OF)
    cc01 = next(r for r in ev.results if r.rule_code == "CC-01")
    assert cc01.result == "needs_review"
    assert ev.status == "needs_review"
    assert gap_keys(ev) == [("low_confidence", "land_title")]


def test_a_string_confidence_counts_as_low_unless_the_user_confirmed():
    ev = evaluate_plot(facts(), {**ALL_OK, "area": {"confidence": "0.9"}}, as_of=AS_OF)
    assert next(r for r in ev.results if r.rule_code == "CC-01").result == "needs_review"
    assert gap_keys(ev) == [("low_confidence", "land_title")]

    ev = evaluate_plot(facts(), {**ALL_OK, "area": {"confidence": "0.9", "confirmedValue": "x"}}, as_of=AS_OF)
    assert next(r for r in ev.results if r.rule_code == "CC-01").result == "pass"
    assert ev.gaps == [] and ev.status == "green"


def test_a_nan_confidence_counts_as_low():
    ev = evaluate_plot(facts(), {**ALL_OK, "name": {"confidence": NAN}}, as_of=AS_OF)
    row = next(r for r in ev.results if r.rule_code == "CC-03")
    assert (row.result, row.actual_value) == ("needs_review", "keyakinan bacaan ?")


def test_a_title_name_of_none_behaves_like_no_names():
    for critical in (ALL_OK, {**ALL_OK, "name": {"confidence": 0.3}}, {}):
        a = evaluate_plot(facts(title_names=(None,)), critical, as_of=AS_OF)
        b = evaluate_plot(facts(title_names=()), critical, as_of=AS_OF)
        assert a.status == b.status
        assert [g.to_doc() for g in a.gaps] == [g.to_doc() for g in b.gaps]
        assert [r.to_doc() for r in a.results] == [r.to_doc() for r in b.results]
    # 低置信度的"姓名"字段不会因为 (None,) 被误当成"有名字"而去降级一条 missing 行
    ev = evaluate_plot(facts(title_names=(None,)), {**ALL_OK, "name": {"confidence": 0.3}}, as_of=AS_OF)
    assert gap_keys(ev) == [("missing_doc", "land_title")]


def test_blank_title_names_are_dropped_but_real_ones_still_count():
    ev = evaluate_plot(facts(title_names=(None, "", "  ", "TAN AH KOW")), ALL_OK, as_of=AS_OF)
    assert next(r for r in ev.results if r.rule_code == "CC-03").result == "pass"
    assert ev.status == "green"


def test_blank_licence_and_member_names_are_skipped():
    ev = evaluate_plot(facts(licence_name="  ", member_name=None), ALL_OK, as_of=AS_OF)
    assert next(r for r in ev.results if r.rule_code == "CC-03").result == "pass"


# ---- 程序员传错 → 明确的 ValueError ----
@pytest.mark.parametrize("plot_ha", [0, -1.0, NAN, INF, -INF, True, "3", None, 1e9, 1e300, 10**400])
def test_a_bad_plot_ha_is_a_caller_bug(plot_ha):
    with pytest.raises(ValueError, match="plot_ha must be a finite number > 0"):
        evaluate_plot(facts(plot_ha=plot_ha), ALL_OK, as_of=AS_OF)


@pytest.mark.parametrize("as_of", ["2026-13-45", "", "09/10/2026", None])
def test_an_invalid_as_of_is_a_caller_bug(as_of):
    with pytest.raises(ValueError, match="as_of"):
        evaluate_plot(facts(), ALL_OK, as_of=as_of)


def test_an_invalid_as_of_is_caught_even_when_no_dated_document_is_given():
    bare = PlotFacts(operator_name="TAN AH KOW", plot_ha=3.0)
    with pytest.raises(ValueError, match="as_of"):
        evaluate_plot(bare, {}, as_of="2026-13-45")


@pytest.mark.parametrize("operator_name", ["", "   ", None, 7])
def test_an_unusable_operator_name_is_a_caller_bug(operator_name):
    with pytest.raises(ValueError, match="operator_name must be a non-empty string"):
        evaluate_plot(facts(operator_name=operator_name), ALL_OK, as_of=AS_OF)


def test_valid_input_still_evaluates_normally():
    ev = evaluate_plot(facts(), ALL_OK, as_of=AS_OF)
    assert ev.status == "green" and ev.gaps == []
