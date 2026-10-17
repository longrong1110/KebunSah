import pytest

from api_helpers import bearer
from test_api_assess import GOOD, assess, latest, make_plot, world  # noqa: F401  (world 是夹具)


def _doc(store, pid, doc_type):
    return next((i, d) for i, d in store.list(f"plots/{pid}/documents") if d["docType"] == doc_type)


def _patch(client, doc_id, fields, uid="smallholder-1"):
    return client.patch(f"/api/documents/{doc_id}/fields", headers=bearer(uid), json={"fields": fields})


def _low_licence_world(world):
    low = {**GOOD, "mpob_licence": {**GOOD["mpob_licence"], "mpob_licence.valid_until": ("31/03/2027", 0.5)}}
    return world(script=low)


def test_confirming_the_low_confidence_field_then_reassessing_turns_green(world, store, clock):
    client, _, _ = _low_licence_world(world)
    pid = make_plot(client)
    assess(client, pid)
    assert latest(store, pid)[1]["result"] == "needs_review"
    doc_id, _ = _doc(store, pid, "mpob_licence")
    r = _patch(client, doc_id, {"mpob_licence.valid_until": "2027-03-31"})
    assert r.status_code == 200
    body = r.json()
    assert body["documentId"] == doc_id
    assert body["fields"]["mpob_licence.valid_until"] == {"confirmedValue": "2027-03-31", "confirmedAt": "2026-10-17T04:00:00Z"}
    field = store.get(f"plots/{pid}/documents/{doc_id}")["fields"]["mpob_licence.valid_until"]
    assert field["confirmedValue"] == "2027-03-31" and field["confirmedBy"] == "smallholder-1" and field["confirmedAt"] == clock.t
    assert field["normalizedValue"] == "2027-03-31" and field["confidence"] == 0.5  # 读出的值原样保留
    assert store.get(f"plots/{pid}/documents/{doc_id}")["extractionStatus"] == "extracted"
    assert len(store.list(f"plots/{pid}/assessments")) == 1  # 不自动重评估
    assert assess(client, pid).status_code == 202
    assert latest(store, pid)[1]["result"] == "green"


def test_confirmed_value_overrides_the_read_value(world, store):
    client, _, _ = world()
    pid = make_plot(client)
    assess(client, pid)
    doc_id, _ = _doc(store, pid, "mpob_licence")
    assert _patch(client, doc_id, {"mpob_licence.valid_until": "2026-01-01"}).status_code == 200  # 已过期
    assess(client, pid)
    a = latest(store, pid)[1]
    assert a["result"] == "red" and "expired" in [g["gapCode"] for g in a["gaps"]]


def test_values_are_normalised_like_read_values(world, store):
    client, _, _ = world()
    pid = make_plot(client)
    assess(client, pid)
    lt, _ = _doc(store, pid, "land_title")
    r = _patch(client, lt, {"land_title.area_value": "4,2", "land_title.proprietor_1_name": " tan  ah kow "})
    assert r.status_code == 200
    assert r.json()["fields"]["land_title.area_value"]["confirmedValue"] == "4.2000"
    assert r.json()["fields"]["land_title.proprietor_1_name"]["confirmedValue"] == "TAN AH KOW"
    lic, _ = _doc(store, pid, "mpob_licence")
    assert _patch(client, lic, {"mpob_licence.valid_until": "31/03/2027"}).json()["fields"][
        "mpob_licence.valid_until"]["confirmedValue"] == "2027-03-31"


def test_a_field_the_model_missed_can_be_filled_in(world, store):
    client, _, _ = world(script={**GOOD, "mpob_licence": {"mpob_licence.holder_name": ("TAN AH KOW", 0.9)}})
    pid = make_plot(client)
    assess(client, pid)
    assert latest(store, pid)[1]["result"] == "needs_review"
    lic, _ = _doc(store, pid, "mpob_licence")
    assert _patch(client, lic, {"mpob_licence.valid_until": "2027-03-31"}).status_code == 200
    assess(client, pid)
    assert latest(store, pid)[1]["result"] == "green"


@pytest.mark.parametrize("fields,code", [
    ({}, "no_fields"),
    ({"mpob_licence.nonsense": "x"}, "unknown_field"),
    ({"land_title.lot_no": "1"}, "unknown_field"),  # 别的证件的键
    ({"mpob_licence.valid_until": "next week"}, "invalid_value"),
    ({"mpob_licence.valid_until": "2027-02-30"}, "invalid_value"),
    ({"mpob_licence.holder_name": "   "}, "invalid_value"),
])
def test_bad_requests_are_400_and_change_nothing(world, store, fields, code):
    client, _, _ = world()
    pid = make_plot(client)
    assess(client, pid)
    lic, before = _doc(store, pid, "mpob_licence")
    r = _patch(client, lic, fields)
    assert r.status_code == 400 and r.json()["error"]["code"] == code
    assert store.get(f"plots/{pid}/documents/{lic}") == before


def test_all_or_nothing(world, store):
    client, _, _ = world()
    pid = make_plot(client)
    assess(client, pid)
    lic, before = _doc(store, pid, "mpob_licence")
    r = _patch(client, lic, {"mpob_licence.holder_name": "OK NAME", "mpob_licence.valid_until": "garbage"})
    assert r.status_code == 400
    assert store.get(f"plots/{pid}/documents/{lic}") == before


def test_access_and_missing(world, store):
    client, _, _ = world()
    pid = make_plot(client)
    assess(client, pid)
    lic, _ = _doc(store, pid, "mpob_licence")
    body = {"mpob_licence.holder_name": "TAN AH KOW"}
    assert _patch(client, lic, body, "smallholder-2").status_code == 403
    assert _patch(client, lic, body, "officer-other").status_code == 403
    assert _patch(client, lic, body, "officer-1").status_code == 200
    r = _patch(client, "nope", body)
    assert r.status_code == 404 and r.json()["error"]["code"] == "document_not_found"
    assert client.patch(f"/api/documents/{lic}/fields", json={"fields": body}).status_code == 401


def test_image_url(world, store):
    client, _, _ = world()
    pid = make_plot(client)
    lic, _ = _doc(store, pid, "mpob_licence")
    r = client.get(f"/api/documents/{lic}/image", headers=bearer("smallholder-1"))
    assert r.status_code == 200 and r.json()["url"].startswith("http://test/dev/blobs/plots/")
    assert r.json()["expiresAt"] == "2026-10-17T04:15:00Z"
    assert client.get(f"/api/documents/{lic}/image", headers=bearer("smallholder-2")).status_code == 403
    assert client.get("/api/documents/nope/image", headers=bearer("smallholder-1")).status_code == 404


def test_image_404_when_photo_never_arrived(world, store):
    client, _, _ = world()
    pid = make_plot(client, upload=())
    r = client.post(f"/api/plots/{pid}/documents", headers=bearer("smallholder-1"),
                    json={"docType": "land_title", "contentType": "image/jpeg", "source": "camera"}).json()
    resp = client.get(f"/api/documents/{r['documentId']}/image", headers=bearer("smallholder-1"))
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "image_not_found"
