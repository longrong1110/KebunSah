import json

import pytest

from api_helpers import COOP, OTHER_COOP, bearer

SQUARE = {"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895],
                                                [101.149037, 4.310895], [101.149037, 4.309105]]]}


def _create(client, uid="smallholder-1", **body):
    r = client.post("/api/plots", headers=bearer(uid), json=body)
    return r


def test_smallholder_creates_own_pending_plot(client, store):
    r = _create(client)
    assert r.status_code == 201
    plot = store.get(f"plots/{r.json()['plotId']}")
    assert plot["operatorPersonId"] == "person-1" and plot["coopId"] == COOP
    assert plot["status"] == "pending" and plot["isSynthetic"] is False


def test_smallholder_cannot_create_for_someone_else(client):
    assert _create(client, memberId="person-2").status_code == 403


def test_officer_needs_member_id(client):
    r = _create(client, "officer-1")
    assert r.status_code == 422 and r.json()["error"]["code"] == "member_id_required"


def test_officer_creates_for_member_of_own_coop(client, store):
    store.set("plots/existing", {"operatorPersonId": "person-2", "coopId": COOP, "status": "green"})
    r = _create(client, "officer-1", memberId="person-2")
    assert r.status_code == 201
    assert store.get(f"plots/{r.json()['plotId']}")["operatorPersonId"] == "person-2"


def test_officer_cannot_create_for_other_coops_member(client, store):
    store.set("plots/existing", {"operatorPersonId": "person-2", "coopId": COOP, "status": "green"})
    assert _create(client, "officer-other", memberId="person-2").status_code == 403
    assert _create(client, "officer-1", memberId="nobody").status_code == 403


def test_requires_login_profile(client):
    r = client.post("/api/plots", headers=bearer("ghost"), json={})
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"


def _plot(client):
    return _create(client).json()["plotId"]


def test_patch_polygon_recomputes_area_and_centroid(client, store):
    pid = _plot(client)
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"),
                     json={"geometryType": "polygon", "polygon": SQUARE})
    assert r.status_code == 200
    body = r.json()
    assert 4.1 < body["areaHaComputed"] < 4.3 and body["areaHaDeclared"] is None
    assert round(body["areaHaComputed"], 4) == body["areaHaComputed"]
    assert body["centroid"] == {"lat": pytest.approx(4.31, abs=1e-4), "lng": pytest.approx(101.15, abs=1e-4)}
    plot = store.get(f"plots/{pid}")
    assert isinstance(plot["polygonGeojson"], str) and json.loads(plot["polygonGeojson"])["type"] == "Polygon"
    assert plot["geometryRecordedAt"] is not None and plot["status"] == "pending"


def test_patch_ignores_client_supplied_area(client):
    pid = _plot(client)
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"),
                     json={"geometryType": "polygon", "polygon": SQUARE, "areaHaComputed": 99, "areaHaDeclared": 1})
    assert r.json()["areaHaComputed"] < 5 and r.json()["areaHaDeclared"] is None


def test_patch_point_mode(client, store):
    pid = _plot(client)
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"),
                     json={"geometryType": "point", "point": {"lng": 101.15, "lat": 4.31}, "areaHaDeclared": 2.5})
    assert r.status_code == 200
    assert r.json()["areaHaComputed"] is None and r.json()["areaHaDeclared"] == 2.5
    assert store.get(f"plots/{pid}")["polygonGeojson"] is None


@pytest.mark.parametrize("area", [4, 4.5, 0, -1])
def test_patch_point_area_out_of_range_is_422(client, area):
    pid = _plot(client)
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"),
                     json={"geometryType": "point", "point": {"lng": 101.15, "lat": 4.31}, "areaHaDeclared": area})
    assert r.status_code == 422


def test_patch_point_without_area_is_422(client):
    pid = _plot(client)
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"),
                     json={"geometryType": "point", "point": {"lng": 101.15, "lat": 4.31}})
    assert r.status_code == 422


def test_patch_unclosed_ring_is_422(client):
    pid = _plot(client)
    bad = {"type": "Polygon", "coordinates": [SQUARE["coordinates"][0][:-1]]}
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"), json={"geometryType": "polygon", "polygon": bad})
    assert r.status_code == 422 and r.json()["error"]["code"] == "geometry_invalid"


def test_patch_out_of_range_coordinates_is_422(client):
    pid = _plot(client)
    ring = [[200, 4], [201, 4], [201, 5], [200, 5], [200, 4]]
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"),
                     json={"geometryType": "polygon", "polygon": {"type": "Polygon", "coordinates": [ring]}})
    assert r.status_code == 422


def test_patch_polygon_mode_without_polygon_is_422(client):
    pid = _plot(client)
    r = client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-1"), json={"geometryType": "polygon"})
    assert r.status_code == 422


def test_patch_other_peoples_plot_is_403_and_missing_is_404(client):
    pid = _plot(client)
    body = {"geometryType": "polygon", "polygon": SQUARE}
    assert client.patch(f"/api/plots/{pid}", headers=bearer("smallholder-2"), json=body).status_code == 403
    assert client.patch(f"/api/plots/{pid}", headers=bearer("officer-other"), json=body).status_code == 403
    assert client.patch(f"/api/plots/{pid}", headers=bearer("officer-1"), json=body).status_code == 200
    r = client.patch("/api/plots/nope", headers=bearer("smallholder-1"), json=body)
    assert r.status_code == 404 and r.json()["error"]["code"] == "plot_not_found"


def test_patch_requires_login(client):
    assert client.patch("/api/plots/x", json={"geometryType": "polygon"}).status_code == 401
