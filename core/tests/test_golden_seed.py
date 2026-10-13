"""黄金测试：用 seed/data 里 200 个地块的原始事实重算，结果必须和种子生成器存下来的评估一致。

种子里的评估由 seed/src/rules.mjs 生成，前端按它解析；这里证明 Python 规则与它逐项对得上
（结果、期望值、实际值、缺口、红黄绿）。演示用的 3 个地块是手写评估（日期按 10/8 算），只比结果和状态。
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from kebunsah_core.evaluate import PlotFacts, evaluate_plot
from kebunsah_core.params import params_from_config

SEED = Path(__file__).resolve().parents[2] / "seed" / "data"
AS_OF = json.loads((SEED / "_manifest.json").read_text(encoding="utf8"))["asOf"]
DEMO_PLOT_IDS = {f"90000000-0000-4000-8000-00000000000{n}" for n in (1, 2, 3)}


def _load(name: str) -> list[dict]:
    return json.loads((SEED / f"{name}.json").read_text(encoding="utf8"))


def _by_id(name: str) -> dict[str, dict]:
    return {d["path"].rsplit("/", 1)[1]: d["data"] for d in _load(name)}


PERSONS = _by_id("persons")
TITLES = _by_id("titles")
LICENCES = _by_id("mpobLicences")
CERTS = _by_id("mspoCertificates")
MEMBERS = _by_id("mspoMembers")
PARAMS = params_from_config(_load("config")[0]["data"])

DOCS: dict[str, list[dict]] = {}
for _d in _load("documents"):
    DOCS.setdefault(_d["path"].split("/")[1], []).append(_d["data"])

ASSESSMENTS = {a["data"]["plotId"]: a["data"] for a in _load("assessments")}
PLOTS = [(p["path"].split("/")[1], p["data"]) for p in _load("plots")]


def _facts_and_critical(plot_id: str, plot: dict):
    operator = PERSONS[plot["operatorPersonId"]]
    title = TITLES[plot["landTitleId"]]
    licence = LICENCES.get(plot["mpobLicenceId"]) if plot.get("mpobLicenceId") else None
    cert = CERTS.get(plot["mspoCertificateId"]) if plot.get("mspoCertificateId") else None
    member = MEMBERS.get(plot["mspoMemberId"]) if plot.get("mspoMemberId") else None
    plot_ha = plot["areaHaComputed"] if plot["geometryType"] == "polygon" else plot["areaHaDeclared"]
    facts = PlotFacts(
        operator_name=operator["fullName"],
        plot_ha=plot_ha,
        title_ha=title["areaHa"],
        title_names=tuple(p["nameAsPrinted"] for p in title["proprietors"]),
        lease_expiry=title.get("leaseExpiry"),
        licence_valid_until=licence["validUntil"] if licence else None,
        licence_name=licence["holderName"] if licence else None,
        cert_expiry=cert["expiryDate"] if cert else None,
        member_name=member["memberName"] if member else None,
        in_mspo=member is not None,
    )
    docs = DOCS[plot_id]
    p1 = next(d for d in docs if d["docType"] == "land_title" and d["pageNo"] == 1)
    p2 = next(d for d in docs if d["docType"] == "land_title" and d["pageNo"] == 2)
    lic_doc = next((d for d in docs if d["docType"] == "mpob_licence"), None)
    operator_prop = next((p for p in title["proprietors"] if p["personId"] == plot["operatorPersonId"]), title["proprietors"][0])
    critical = {
        "area": p1["fields"]["land_title.area_value"],
        "valid_until": lic_doc["fields"]["mpob_licence.valid_until"] if lic_doc else None,
        "name": p2["fields"][f"land_title.proprietor_{operator_prop['seq']}_name"],
    }
    return facts, critical


def test_seed_is_the_expected_size():
    assert len(PLOTS) == 200
    assert len(ASSESSMENTS) == 200


@pytest.mark.parametrize("plot_id,plot", PLOTS, ids=[p[0][:8] for p in PLOTS])
def test_plot_matches_seed_assessment(plot_id, plot):
    facts, critical = _facts_and_critical(plot_id, plot)
    ev = evaluate_plot(facts, critical, as_of=AS_OF, params=PARAMS)
    stored = ASSESSMENTS[plot_id]

    assert ev.status == plot["status"] == stored["result"]

    for want in stored["ruleResults"]:
        code = want["ruleCode"]
        if code == "CC-02":
            # 种子只留"最差的一份"（始终是 MPOB 执照，或缺执照那一行）；我们每份文件一条
            got = next(r for r in ev.results if r.rule_code == "CC-02" and r.doc_type == "mpob_licence")
        else:
            got = next(r for r in ev.results if r.rule_code == code)
        assert got.result == want["result"], code
        if plot_id not in DEMO_PLOT_IDS:
            assert got.expected_value == want["expectedValue"], code
            assert got.actual_value == want["actualValue"], code

    got_gaps = Counter((g.gap_code, g.severity, g.doc_type) for g in ev.gaps)
    want_gaps = Counter((g["gapCode"], g["severity"], g["docType"]) for g in stored["gaps"])
    assert got_gaps == want_gaps
