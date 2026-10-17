import pytest
from fastapi.testclient import TestClient

from api_helpers import bearer
from app.config import Settings
from app.main import create_app


def _plot(client, uid="smallholder-1"):
    return client.post("/api/plots", headers=bearer(uid), json={}).json()["plotId"]


def _register(client, pid, uid="smallholder-1", **over):
    body = {"docType": "land_title", "contentType": "image/jpeg", "source": "camera", **over}
    return client.post(f"/api/plots/{pid}/documents", headers=bearer(uid), json=body)


def test_register_returns_put_url_and_creates_document(client, store, clock):
    pid = _plot(client)
    r = _register(client, pid)
    assert r.status_code == 201
    body = r.json()
    assert body["upload"]["method"] == "PUT" and body["upload"]["headers"] == {"Content-Type": "image/jpeg"}
    assert body["upload"]["url"].startswith("http://test/dev/blobs/plots/")
    assert body["upload"]["expiresAt"] == "2026-10-17T04:15:00Z"
    doc = store.get(f"plots/{pid}/documents/{body['documentId']}")
    assert doc["docType"] == "land_title" and doc["isCurrent"] is True and doc["pageNo"] == 1
    assert doc["uploadedBy"] == "smallholder-1" and doc["source"] == "camera" and doc["fields"] == {}
    assert "extractionStatus" not in doc  # 照片真的传上去之前不写
    assert doc["storagePath"].startswith(f"plots/{pid}/documents/") and doc["storagePath"].endswith(".jpg")


def test_browser_can_put_to_the_returned_url(client, make_deps):
    pid = _plot(client)
    r = _register(client, pid).json()
    path = r["upload"]["url"].removeprefix("http://test")
    put = client.put(path, content=b"\xff\xd8fake-jpeg", headers=r["upload"]["headers"])
    assert put.status_code == 200
    got = client.get(path)
    assert got.status_code == 200 and got.content == b"\xff\xd8fake-jpeg" and got.headers["content-type"] == "image/jpeg"


def test_dev_put_rejects_empty_body_and_path_escape(client):
    assert client.put("/dev/blobs/plots/x/y.jpg", content=b"").status_code == 422
    assert client.put("/dev/blobs/%2e%2e/%2e%2e/evil.txt", content=b"x").status_code in {404, 422}
    assert client.get("/dev/blobs/plots/nothing.jpg").status_code == 404


def test_dev_routes_absent_in_production_mode(make_deps):
    deps = make_deps(settings=Settings(blobs_mode="gcs", dev_endpoints=False))
    c = TestClient(create_app(deps))
    assert c.put("/dev/blobs/plots/x.jpg", content=b"x").status_code == 404
    assert c.get("/docs").status_code == 404


def test_registering_again_supersedes_the_old_one(client, store):
    pid = _plot(client)
    first = _register(client, pid).json()["documentId"]
    other = _register(client, pid, docType="mpob_licence").json()["documentId"]
    second = _register(client, pid).json()["documentId"]
    assert store.get(f"plots/{pid}/documents/{first}")["isCurrent"] is False
    assert store.get(f"plots/{pid}/documents/{second}")["isCurrent"] is True
    assert store.get(f"plots/{pid}/documents/{other}")["isCurrent"] is True


@pytest.mark.parametrize("over", [{"docType": "passport"}, {"docType": "mspo_member_list"},
                                  {"contentType": "image/png"}, {"source": "fax"}])
def test_bad_values_are_422(client, over):
    pid = _plot(client)
    r = _register(client, pid, **over)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_access_rules(client):
    pid = _plot(client)
    assert _register(client, pid, uid="smallholder-2").status_code == 403
    assert _register(client, pid, uid="officer-other").status_code == 403
    assert _register(client, pid, uid="officer-1").status_code == 201
    assert _register(client, "nope").status_code == 404
    assert client.post(f"/api/plots/{pid}/documents", json={}).status_code == 401


def test_pages_of_one_document_coexist_and_only_the_same_page_is_superseded(client, store):
    pid = _plot(client)
    p1 = _register(client, pid).json()["documentId"]
    p2 = _register(client, pid, pageNo=2).json()["documentId"]
    assert store.get(f"plots/{pid}/documents/{p1}")["isCurrent"] is True
    assert store.get(f"plots/{pid}/documents/{p2}")["pageNo"] == 2
    p2b = _register(client, pid, pageNo=2).json()["documentId"]
    assert store.get(f"plots/{pid}/documents/{p1}")["isCurrent"] is True
    assert store.get(f"plots/{pid}/documents/{p2}")["isCurrent"] is False
    assert store.get(f"plots/{pid}/documents/{p2b}")["isCurrent"] is True


@pytest.mark.parametrize("page", [0, 5, -1])
def test_page_number_out_of_range_is_422(client, page):
    assert _register(client, _plot(client), pageNo=page).status_code == 422
