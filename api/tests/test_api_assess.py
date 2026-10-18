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


def test_plot_gets_its_lot_number_and_district_from_the_title_photo(world, store):
    """新建的地块没有登记地契，屏 2 的卡片靠评估时复制到 plots 上的这几项起标题（不含人名）。"""
    script = {**GOOD, "land_title": {**GOOD["land_title"], "land_title.district": ("Kampar", 0.9),
                                      "land_title.state": ("Perak", 0.9), "land_title.title_no": ("HSM 145/78", 0.8)}}
    client, _, _ = world(script)
    pid = make_plot(client)
    assess(client, pid)
    plot = store.get(f"plots/{pid}")
    assert (plot["lotNo"], plot["district"], plot["state"], plot["titleNo"]) == ("1052", "Kampar", "Perak", "HSM 145/78")
    assert plot["status"] == "green"
    assert not any(isinstance(v, str) and "TAN AH KOW" in v for v in plot.values())


def test_plot_identity_is_left_alone_when_the_title_is_not_read(world, store):
    client, _, _ = world({"mpob_licence": GOOD["mpob_licence"]})
    pid = make_plot(client, upload=("mpob_licence",))
    assess(client, pid)
    plot = store.get(f"plots/{pid}")
    assert "lotNo" not in plot and "district" not in plot


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


def _cjk_in(value, path=""):
    import re

    cjk = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]")
    if isinstance(value, str):
        if cjk.search(value):
            yield path, value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from _cjk_in(v, f"{path}.{k}")
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _cjk_in(v, f"{path}[]")


@pytest.mark.parametrize("script", [GOOD, {**GOOD, "mpob_licence": ExtractionError("quota exceeded")}, {}])
def test_nothing_the_pipeline_stores_contains_chinese(world, store, script):
    """评估跑完（正常、有一份抽取失败、什么都读不出）之后，库里没有任何中文：文案一律马来语／英语。"""
    client, _, _ = world(script=script)
    pid = make_plot(client)
    assess(client, pid)
    offenders = [(p, v) for path, doc in store._docs.items() for p, v in _cjk_in(doc, path)]
    assert offenders == [], offenders[:5]


class _FixedForest:
    def __init__(self, risk, loss, cover=100.0):
        from worker.forest import ForestResult

        self.result = ForestResult(cover_2020_pct=cover, loss_after_2020_ha=loss, risk=risk, dataset="JRC/GFC2020/V4 + hansen")
        self.seen = None

    def screen(self, lat, lng, ring, area_ha=None):
        self.seen = (lat, lng, ring, area_ha)
        return self.result


def test_the_plot_geometry_and_area_reach_the_forest_screen(world, store):
    forest = _FixedForest("low", 0.0)
    client, _, _ = world(forest=forest)
    pid = make_plot(client)
    assess(client, pid)
    lat, lng, ring, area = forest.seen
    assert ring and ring[0] == ring[-1] and 4.1 < area < 4.3 and 4.3 < lat < 4.32 and 101.14 < lng < 101.16


@pytest.mark.parametrize("risk,loss", [("medium", 0.05), ("high", 3.56)])
def test_forest_loss_after_2020_sends_a_green_plot_to_a_person(world, store, risk, loss):
    client, _, _ = world(forest=_FixedForest(risk, loss))
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["result"] == "needs_review" and store.get(f"plots/{pid}")["status"] == "needs_review"
    assert a["forestRisk"] == risk and a["forestLossAfter2020Ha"] == loss and a["forestDataset"] == "JRC/GFC2020/V4 + hansen"


def test_forest_loss_does_not_soften_a_red_plot(world, store):
    bad = {**GOOD, "land_title": {**GOOD["land_title"], "land_title.area_value": ("2.0", 0.95)}}
    client, _, _ = world(script=bad, forest=_FixedForest("high", 3.0))
    pid = make_plot(client)
    assess(client, pid)
    assert latest(store, pid)[1]["result"] == "red"


def test_clean_real_forest_data_keeps_the_result(world, store):
    client, _, _ = world(forest=_FixedForest("low", 0.0, cover=0.0))
    pid = make_plot(client)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["result"] == "green" and a["forestRisk"] == "low" and a["forestCover2020Pct"] == 0.0


def test_the_summary_records_which_model_wrote_it(world, store):
    client, _, _ = world()  # TemplateExplainer
    pid = make_plot(client)
    assess(client, pid)
    assert latest(store, pid)[1]["summaryModel"] == "template"


def test_summary_model_is_the_gemini_model_when_gemini_wrote_it(store, make_deps):
    import json as _json
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    reply = _json.dumps({"summary_text": "Lesen anda hampir tamat.",
                         "gaps": [{"index": 0, "description": "d", "suggested_action": "a"}]})
    client_stub = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kw: SimpleNamespace(text=reply)))
    store.set("mspoCertificates/cert1", {"certNo": "MSPO 900001", "expiryDate": "2029-02-28"})
    store.set("mspoCertificates/cert1/members/m1", {"memberName": "TAN AH KOW"})
    expiring = {**GOOD, "mpob_licence": {**GOOD["mpob_licence"], "mpob_licence.valid_until": ("05/12/2026", 0.93)}}
    deps = make_deps(extractor=ScriptedExtractor(expiring), explainer=GeminiExplainer(model="gemini-test", client=client_stub),
                     forest=PrecomputedForest())
    client = TestClient(create_app(deps))
    pid = make_plot(client)
    assess(client, pid)
    a = latest(store, pid)[1]
    assert a["summaryModel"] == "gemini-test" and a["result"] == "yellow"  # 执照临期的缺口让 Gemini 写了说明
    assert a["summaryText"] == "Lesen anda hampir tamat."


class _PagedExtractor:
    """按图片内容区分页：第 1 页只有面积和 Lot，第 2 页只有持有人（像 seed/photos 里分两页的地契）；别的证件照常"""

    def __init__(self):
        self.calls = []

    def extract(self, doc_type, image, mime_type):
        from worker.fields import normalize_field
        from worker.gemini import ExtractionResult

        self.calls.append((doc_type, image))
        if doc_type == "land_title" and image.endswith(b"PAGE1"):
            raw = {"land_title.area_value": ("4.20", 0.95), "land_title.area_unit": ("Hektar", 0.95), "land_title.lot_no": ("1052", 0.9)}
        elif doc_type == "land_title" and image.endswith(b"PAGE2"):
            raw = {"land_title.proprietor_1_name": ("TAN AH KOW", 0.95)}
        else:
            raw = GOOD[doc_type]
        return ExtractionResult(fields={k: normalize_field(k, v[0], v[0], v[1]) for k, v in raw.items()}, model="fake")


def _register_and_upload(client, pid, doc_type, content, page=None):
    body = {"docType": doc_type, "contentType": "image/jpeg", "source": "camera", **({"pageNo": page} if page else {})}
    r = client.post(f"/api/plots/{pid}/documents", headers=bearer("smallholder-1"), json=body)
    assert r.status_code == 201, r.text
    assert client.put(r.json()["upload"]["url"].removeprefix("http://test"), content=content).status_code == 200
    return r.json()["documentId"]


def test_a_two_page_land_title_is_read_as_one_document(world, store):
    extractor = _PagedExtractor()
    client, _, _ = world(extractor=extractor)
    pid = make_plot(client, upload=("mpob_licence", "mspo_cert"))
    _register_and_upload(client, pid, "land_title", b"\xff\xd8PAGE1")
    _register_and_upload(client, pid, "land_title", b"\xff\xd8PAGE2", page=2)
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["runStatus"] == "done" and a["result"] == "green", a["gaps"]  # 面积在第 1 页、持有人在第 2 页，合起来才都通过
    docs = [d for _, d in store.list(f"plots/{pid}/documents") if d["docType"] == "land_title"]
    assert sorted(d["pageNo"] for d in docs) == [1, 2] and all(d["isCurrent"] for d in docs)
    assert sum(1 for t, _ in extractor.calls if t == "land_title") == 2


def test_page_one_alone_asks_for_the_owner_page(world, store):
    client, _, _ = world(extractor=_PagedExtractor())
    pid = make_plot(client, upload=("mpob_licence", "mspo_cert"))
    _register_and_upload(client, pid, "land_title", b"\xff\xd8PAGE1")
    assess(client, pid)
    _, a = latest(store, pid)
    assert a["result"] == "needs_review" and ("missing_doc", "land_title") in [(g["gapCode"], g["docType"]) for g in a["gaps"]]
