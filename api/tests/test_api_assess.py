"""POST /api/plots/{id}/assess 端到端：建地块 → 存多边形 → 登记并上传 → 评估 → 读 Firestore 里的结果。"""
import json
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api_helpers import ScriptedExtractor, bearer
from app.main import create_app
from worker.explain import GeminiExplainer, TemplateExplainer
from worker.forest import PrecomputedForest, UnavailableForest
from worker.gemini import ExtractionError

SQUARE = {"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895],
                                                [101.149037, 4.310895], [101.149037, 4.309105]]]}  # ≈ 4.2 ha
# 种子里前 3 个评估是演示用的绿 / 黄 / 红，形状就是前端实际按它解析的那个（contract/examples 在待合并的合同分支里）
SEED_ASSESSMENTS = Path(__file__).resolve().parents[2] / "seed" / "data" / "assessments.json"

GOOD = {
    "land_title": {"land_title.area_value": ("4.20", 0.95), "land_title.area_unit": ("Hektar", 0.95),
                   "land_title.proprietor_1_name": ("TAN AH KOW", 0.95), "land_title.lot_no": ("1052", 0.9)},
    "mpob_licence": {"mpob_licence.valid_until": ("31/03/2027", 0.93), "mpob_licence.holder_name": ("TAN AH KOW", 0.92)},
    "mspo_cert": {"mspo_cert.cert_no": ("MSPO 900001", 0.9), "mspo_cert.expiry_date": ("28/02/2029", 0.9)},
}


@pytest.fixture
def world(store, make_deps):
    """一个有 MSPO 团体证书（含成员 TAN AH KOW）的世界，和一个造 client 的函数。"""
    store.set("mspoCertificates/cert1", {"certNo": "MSPO 900001", "expiryDate": "2029-02-28"})
    store.set("mspoCertificates/cert1/members/m1", {"memberName": "TAN AH KOW"})

    def build(script=None, **over):
        extractor = ScriptedExtractor(GOOD if script is None else script)
        deps = make_deps(**{"extractor": extractor, "explainer": TemplateExplainer(), "forest": PrecomputedForest(), **over})
        return TestClient(create_app(deps)), deps, extractor

    return build


def make_plot(client, uid="smallholder-1", polygon=SQUARE, upload=("land_title", "mpob_licence", "mspo_cert")):
    h = bearer(uid)
    pid = client.post("/api/plots", headers=h, json={"memberId": "person-1"} if uid.startswith("officer") else {}).json()["plotId"]
    if polygon:
        assert client.patch(f"/api/plots/{pid}", headers=h, json={"geometryType": "polygon", "polygon": polygon}).status_code == 200
    for doc_type in upload:
        r = client.post(f"/api/plots/{pid}/documents", headers=h,
                        json={"docType": doc_type, "contentType": "image/jpeg", "source": "camera"}).json()
        assert client.put(r["upload"]["url"].removeprefix("http://test"), content=b"\xff\xd8" + doc_type.encode()).status_code == 200
    return pid


def assess(client, pid, uid="smallholder-1"):
    return client.post(f"/api/plots/{pid}/assess", headers=bearer(uid))


def latest(store, pid):
    rows = store.list(f"plots/{pid}/assessments")
    return rows[-1][0], rows[-1][1]


def test_green_end_to_end(world, store):
    client, deps, extractor = world()
    pid = make_plot(client)
    r = assess(client, pid)
    assert r.status_code == 202
    aid, a = latest(store, pid)
    assert r.json() == {"assessmentId": aid}
    assert a["runStatus"] == "done" and a["result"] == "green" and a["errorMessage"] is None
    assert a["gaps"] == [] and a["summaryText"] == "Semua semakan lulus."
    plot = store.get(f"plots/{pid}")
    assert plot["status"] == "green" and plot["lastAssessedAt"] == a["finishedAt"]
    assert [r["ruleCode"] for r in a["ruleResults"]] == ["CC-01", "CC-02", "CC-02", "CC-03"]
    assert {r["docType"] for r in a["ruleResults"] if r["ruleCode"] == "CC-02"} == {"mpob_licence", "mspo_cert"}
    assert all(rr["evidence"] for rr in a["ruleResults"])
    assert a["forestRisk"] == "low" and a["forestDataset"] == "precomputed-demo"
    assert a["coopId"] == "c0000000-0000-4000-8000-000000000001"
    assert [s["step"] for s in a["steps"]] == ["read", "check", "forest", "actions"]
    assert a["progress"] == {"read": "done", "check": "done", "forest": "done", "actions": "done"}
    assert sorted(extractor.calls) == ["land_title", "mpob_licence", "mspo_cert"]
    docs = store.list(f"plots/{pid}/documents")
    assert {d["extractionStatus"] for _, d in docs} == {"extracted"} and all(d["sha256"] for _, d in docs)
    licence = next(d for _, d in docs if d["docType"] == "mpob_licence")
    assert licence["fields"]["mpob_licence.valid_until"]["normalizedValue"] == "2027-03-31"


def test_document_shape_matches_the_seed_assessments(world, store):
    client, _, _ = world()
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    for row in json.loads(SEED_ASSESSMENTS.read_text(encoding="utf8"))[:3]:
        example = row["data"]
        assert set(example) <= set(a), set(example) - set(a)
        assert set(example["ruleResults"][0]) <= set(a["ruleResults"][0])
    assert a["isSynthetic"] is False


def test_assessment_is_queued_first_and_visible_in_progress(world, store, make_deps):
    client, deps, _ = world()
    pid = make_plot(client)
    seen = []
    original = deps.extractor.extract

    def spy(doc_type, image, mime):
        _, a = latest(store, pid)
        seen.append((a["runStatus"], a["progress"]["read"]))
        return original(doc_type, image, mime)

    deps.extractor.extract = spy
    assess(client, pid)
    assert seen and all(s == ("running", "running") for s in seen)


def test_missing_licence_and_unfinished_upload_become_gaps(world, store):
    client, _, extractor = world()
    pid = make_plot(client, upload=("land_title", "mspo_cert"))
    # 登记了执照但照片一直没传上来：和没有这份文件一样处理
    client.post(f"/api/plots/{pid}/documents", headers=bearer("smallholder-1"),
                json={"docType": "mpob_licence", "contentType": "image/jpeg", "source": "gallery"})
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["runStatus"] == "done" and a["result"] == "yellow"
    assert ("missing_doc", "mpob_licence") in [(g["gapCode"], g["docType"]) for g in a["gaps"]]
    assert "mpob_licence" not in extractor.calls


def test_not_in_mspo_makes_yellow(world, store):
    client, _, _ = world(script={**GOOD, "mspo_cert": {"mspo_cert.cert_no": ("MSPO 000000", 0.9),
                                                       "mspo_cert.expiry_date": ("28/02/2029", 0.9)}})
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["result"] == "yellow" and [g["gapCode"] for g in a["gaps"]] == ["not_in_mspo"]


def test_area_mismatch_name_mismatch_is_red(world, store):
    bad = {**GOOD, "land_title": {**GOOD["land_title"], "land_title.area_value": ("2.0", 0.95),
                                  "land_title.proprietor_1_name": ("RAMAN A/L SUBRAMANIAM", 0.95)}}
    client, _, _ = world(script=bad)
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["result"] == "red" and store.get(f"plots/{pid}")["status"] == "red"
    assert {"area_mismatch", "name_mismatch"} <= {g["gapCode"] for g in a["gaps"]}


def test_extraction_failure_degrades_only_that_document(world, store):
    client, _, _ = world(script={**GOOD, "mpob_licence": ExtractionError("quota")})
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["runStatus"] == "done" and a["result"] == "needs_review"
    docs = {d["docType"]: d for _, d in store.list(f"plots/{pid}/documents")}
    assert docs["mpob_licence"]["extractionStatus"] == "failed" and docs["land_title"]["extractionStatus"] == "extracted"
    licence_rule = next(r for r in a["ruleResults"] if r["ruleCode"] == "CC-02" and r["docType"] == "mpob_licence")
    assert licence_rule["result"] == "needs_review"
    assert a["steps"][0]["status"] == "degraded"


def test_low_confidence_field_needs_review_and_is_listed(world, store):
    low = {**GOOD, "mpob_licence": {**GOOD["mpob_licence"], "mpob_licence.valid_until": ("31/03/2027", 0.5)}}
    client, _, _ = world(script=low)
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["result"] == "needs_review" and "low_confidence" in [g["gapCode"] for g in a["gaps"]]
    assert next(d for _, d in store.list(f"plots/{pid}/documents") if d["docType"] == "mpob_licence")["extractionStatus"] == "needs_review"


def test_forest_unknown_downgrades_green(world, store):
    client, _, _ = world(forest=UnavailableForest())
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["forestRisk"] == "unknown" and a["forestCover2020Pct"] is None and a["result"] == "needs_review"
    assert a["steps"][2]["status"] == "degraded"


def test_forest_exception_degrades_not_crashes(world, store):
    class Boom:
        def screen(self, *a):
            raise RuntimeError("earth engine down")

    client, _, _ = world(forest=Boom())
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["runStatus"] == "done" and a["forestRisk"] == "unknown" and a["result"] == "needs_review"


def test_explainer_failure_falls_back_to_template(world, store):
    class Boom:
        def explain(self, *a):
            raise RuntimeError("gemini down")

    client, _, _ = world(script={**GOOD, "mspo_cert": {}}, explainer=Boom())
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["runStatus"] == "done" and a["summaryText"] and a["steps"][3]["status"] == "degraded"


def test_pipeline_crash_marks_failed_and_plot_needs_review(world, store, make_deps):
    client, deps, _ = world()
    pid = make_plot(client)
    store.set("persons/person-1", {})  # 园主档案坏了：缺姓名
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["runStatus"] == "failed" and a["result"] is None and "fullName" in a["errorMessage"]
    assert store.get(f"plots/{pid}")["status"] == "needs_review"
    assert a["steps"][-1]["step"] == "pipeline"


def test_second_assess_does_not_reread_documents(world, store):
    client, _, extractor = world()
    pid = make_plot(client)
    assess(client, pid)
    assert len(extractor.calls) == 3
    assess(client, pid)
    assert len(extractor.calls) == 3 and len(store.list(f"plots/{pid}/assessments")) == 2


def test_409_when_one_is_in_flight_and_stale_is_released(world, store, clock):
    client, _, _ = world()
    pid = make_plot(client)
    store.set(f"plots/{pid}/assessments/busy", {"plotId": pid, "runStatus": "running", "createdAt": clock.t})
    r = assess(client, pid)
    assert r.status_code == 409 and r.json()["assessmentId"] == "busy"
    assert r.json()["error"]["code"] == "assessment_in_progress"
    clock.t += timedelta(minutes=11)
    assert assess(client, pid).status_code == 202
    assert store.get(f"plots/{pid}/assessments/busy")["runStatus"] == "failed"


def test_needs_geometry_and_access(world, store):
    client, _, _ = world()
    no_geo = make_plot(client, polygon=None, upload=())
    r = assess(client, no_geo)
    assert r.status_code == 422 and r.json()["error"]["code"] == "geometry_missing"
    pid = make_plot(client)
    assert assess(client, pid, "smallholder-2").status_code == 403
    assert assess(client, pid, "officer-other").status_code == 403
    assert assess(client, "nope").status_code == 404
    assert client.post(f"/api/plots/{pid}/assess").status_code == 401


def test_officer_can_assess_members_plot(world, store):
    client, _, _ = world()
    pid = make_plot(client, uid="officer-1")
    assert assess(client, pid, "officer-1").status_code == 202
    assert latest(store, pid)[1]["result"] == "green"
