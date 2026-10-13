from kebunsah_core.evaluate import PlotFacts, evaluate_plot
from kebunsah_core.grading import Gap, aggregate, derive_gaps, summarize
from kebunsah_core.rules import RuleResult, cc01, cc02, cc02_missing_licence, cc03

AS_OF = "2026-10-09"
OK = {"confidence": 0.95}


def rr(code, result, **meta):
    return RuleResult(code, result, "", "", {}, "", meta=meta)


# ---- aggregate ----
def test_aggregate_orders_red_over_review_over_yellow_over_green():
    assert aggregate([rr("CC-01", "pass"), rr("CC-02", "pass")], []) == "green"
    assert aggregate([rr("CC-01", "warn")], []) == "yellow"
    assert aggregate([rr("CC-01", "pass")], [Gap("not_in_mspo", "medium", None, "", "")]) == "yellow"
    assert aggregate([rr("CC-01", "warn"), rr("CC-03", "needs_review")], []) == "needs_review"
    assert aggregate([rr("CC-03", "needs_review"), rr("CC-02", "fail")], []) == "red"


def test_aggregate_ignores_resolved_gaps():
    assert aggregate([rr("CC-01", "pass")], [Gap("x", "low", None, "", "", status="resolved")]) == "green"


# ---- derive_gaps ----
def test_derive_gaps_for_each_failing_rule():
    results = [
        cc01(title_ha=2.0, plot_ha=3.4),
        cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-04-30"),
        cc03(operator_name="MUTHU A/L RAMAN", title_names=["RAMAN A/L SUBRAMANIAM"]),
    ]
    gaps = derive_gaps(results, not_in_mspo=True)
    assert [(g.gap_code, g.severity, g.doc_type) for g in gaps] == [
        ("area_mismatch", "high", None),
        ("expired", "high", "mpob_licence"),
        ("name_mismatch", "high", "land_title"),
        ("not_in_mspo", "medium", "mspo_member_list"),
    ]


def test_expiring_gap_points_at_the_document_that_expires():
    gaps = derive_gaps([cc02(as_of=AS_OF, doc_type="mspo_cert", label="MSPO", expiry_date="2026-12-05")], not_in_mspo=False)
    assert [(g.gap_code, g.doc_type) for g in gaps] == [("expiring", "mspo_cert")]
    assert "Sijil MSPO" in gaps[0].description


def test_missing_licence_and_missing_title_become_missing_doc_gaps():
    gaps = derive_gaps([cc01(title_ha=None, plot_ha=3.0), cc02_missing_licence(),
                        cc03(operator_name="A", title_names=[])], not_in_mspo=False)
    assert [(g.gap_code, g.severity, g.doc_type) for g in gaps] == [
        ("missing_doc", "high", "land_title"), ("missing_doc", "medium", "mpob_licence")]  # CC-03 缺地契不重复报


def test_gap_to_doc_uses_the_firestore_shape():
    doc = Gap("expired", "high", "mpob_licence", "d", "a").to_doc()
    assert doc == {"gapCode": "expired", "severity": "high", "docType": "mpob_licence", "description": "d",
                   "suggestedAction": "a", "citation": None, "status": "open"}


def test_summarize():
    assert summarize("green", []) == "Semua semakan lulus."
    gaps = [Gap("a", "low", None, "Satu", ""), Gap("b", "low", None, "Dua", "")]
    assert summarize("yellow", gaps) == "Satu. Dua."


# ---- evaluate_plot ----
GREEN = PlotFacts(operator_name="TAN AH KOW", plot_ha=4.23, title_ha=4.2, title_names=("TAN AH KOW",),
                  licence_valid_until="2027-03-31", licence_name="TAN AH KOW", cert_expiry="2029-02-28",
                  member_name="TAN AH KOW", in_mspo=True)


def test_evaluate_green():
    ev = evaluate_plot(GREEN, {"area": OK, "valid_until": OK, "name": OK}, as_of=AS_OF)
    assert ev.status == "green" and ev.gaps == []
    assert [(r.rule_code, r.doc_type) for r in ev.results] == [
        ("CC-01", None), ("CC-02", "mpob_licence"), ("CC-02", "mspo_cert"), ("CC-03", None)]


def test_evaluate_yellow_area_and_expiring_licence():
    facts = PlotFacts(operator_name="AHMAD ZAKI BIN ROSLI", plot_ha=3.49, title_ha=3.04,
                      title_names=("AHMAD ZAKI BIN ROSLI",), licence_valid_until="2026-12-05",
                      licence_name="AHMAD ZAKI BIN ROSLI", cert_expiry="2029-02-28",
                      member_name="AHMAD ZAKI BIN ROSLI", in_mspo=True)
    ev = evaluate_plot(facts, {"area": OK, "valid_until": {"confidence": 0.64, "confirmedValue": "2026-12-05"}, "name": OK},
                       as_of=AS_OF)
    assert ev.status == "yellow"
    assert sorted(g.gap_code for g in ev.gaps) == ["area_mismatch", "expiring"]


def test_evaluate_red_for_the_deceased_father_title():
    facts = PlotFacts(operator_name="MUTHU A/L RAMAN", plot_ha=3.4, title_ha=2.0, title_names=("RAMAN A/L SUBRAMANIAM",),
                      licence_valid_until="2026-04-30", licence_name="MUTHU A/L RAMAN", in_mspo=False)
    ev = evaluate_plot(facts, {"area": OK, "valid_until": OK, "name": OK}, as_of=AS_OF)
    assert ev.status == "red"
    assert sorted(g.gap_code for g in ev.gaps) == ["area_mismatch", "expired", "name_mismatch", "not_in_mspo"]


def test_evaluate_unconfirmed_low_confidence_needs_review():
    ev = evaluate_plot(GREEN, {"area": OK, "valid_until": OK, "name": {"confidence": 0.59}}, as_of=AS_OF)
    assert ev.status == "needs_review"
    assert [(g.gap_code, g.doc_type) for g in ev.gaps] == [("low_confidence", "land_title")]


def test_evaluate_without_documents_is_red_not_a_crash():
    facts = PlotFacts(operator_name="TAN AH KOW", plot_ha=3.0)
    ev = evaluate_plot(facts, {}, as_of=AS_OF)
    assert ev.status == "red"
    assert [(g.gap_code, g.doc_type) for g in ev.gaps] == [
        ("missing_doc", "land_title"), ("missing_doc", "mpob_licence"), ("not_in_mspo", "mspo_member_list")]


def test_evaluate_lease_expiry_gets_its_own_row():
    facts = PlotFacts(operator_name="TAN AH KOW", plot_ha=4.2, title_ha=4.2, title_names=("TAN AH KOW",),
                      lease_expiry="2026-11-01", licence_valid_until="2027-06-01", licence_name="TAN AH KOW",
                      cert_expiry="2029-02-28", member_name="TAN AH KOW", in_mspo=True)
    ev = evaluate_plot(facts, {"area": OK, "valid_until": OK, "name": OK}, as_of=AS_OF)
    assert ev.status == "yellow"
    assert [(g.gap_code, g.doc_type) for g in ev.gaps] == [("expiring", "land_title")]
