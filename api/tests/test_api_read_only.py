"""合作社管理员只能看，不能改：所有会改数据的接口对他回 403 read_only_role；看（地块、照片地址、语音问答）仍然可以。"""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from api_helpers import COOP, bearer
from app.main import create_app
from worker.voice import VoiceAnswer


class OkVoice:
    def answer(self, audio, mime_type, lang, facts):
        return VoiceAnswer(transcript="t", answer="a", model="m")


@pytest.fixture
def admin_client(store, make_deps):
    store.set("users/admin-1", {"phone": None, "role": "coop_admin", "language": "en", "personId": None, "coopId": COOP,
                                "lastLoginAt": None, "isSynthetic": True, "createdAt": datetime(2026, 10, 1, tzinfo=timezone.utc)})
    return TestClient(create_app(make_deps(voice=OkVoice())))


def _owner_plot(client):
    return client.post("/api/plots", headers=bearer("smallholder-1"), json={}).json()["plotId"]


def _doc(client, pid):
    r = client.post(f"/api/plots/{pid}/documents", headers=bearer("smallholder-1"),
                    json={"docType": "land_title", "contentType": "image/jpeg", "source": "camera"}).json()
    client.put(r["upload"]["url"].removeprefix("http://test"), content=b"\xff\xd8x")
    return r["documentId"]


def test_admin_cannot_create_or_change_anything(admin_client, store):
    pid = _owner_plot(admin_client)
    doc_id = _doc(admin_client, pid)
    h = bearer("admin-1")
    forbidden = [
        admin_client.post("/api/plots", headers=h, json={"memberId": "person-1"}),
        admin_client.patch(f"/api/plots/{pid}", headers=h, json={"geometryType": "point", "point": {"lng": 101.1, "lat": 4.3},
                                                                 "areaHaDeclared": 2}),
        admin_client.post(f"/api/plots/{pid}/documents", headers=h,
                          json={"docType": "land_title", "contentType": "image/jpeg", "source": "camera"}),
        admin_client.patch(f"/api/documents/{doc_id}/fields", headers=h, json={"fields": {"land_title.lot_no": "1"}}),
        admin_client.post(f"/api/plots/{pid}/assess", headers=h),
        admin_client.delete(f"/api/documents/{doc_id}", headers=h),
        admin_client.delete(f"/api/plots/{pid}", headers=h),
    ]
    for r in forbidden:
        assert r.status_code == 403 and r.json()["error"]["code"] == "read_only_role", r.request.url
    # 什么都没被改
    assert store.get(f"plots/{pid}") is not None and store.get(f"plots/{pid}/documents/{doc_id}") is not None


def test_admin_can_still_look(admin_client):
    pid = _owner_plot(admin_client)
    doc_id = _doc(admin_client, pid)
    h = bearer("admin-1")
    image = admin_client.get(f"/api/documents/{doc_id}/image", headers=h)
    assert image.status_code == 200 and image.json()["url"]
    voice = admin_client.post(f"/api/plots/{pid}/voice", headers=h,
                              json={"audio": "AAAA" * 2000, "mimeType": "audio/wav", "lang": "en"})
    assert voice.status_code == 200


def test_officers_and_owners_can_still_change(admin_client):
    # 外勤替成员建地块、园主自己改，都不受影响
    assert admin_client.post("/api/plots", headers=bearer("officer-1"), json={"memberId": "person-1"}).status_code == 201
    pid = _owner_plot(admin_client)
    assert admin_client.delete(f"/api/plots/{pid}", headers=bearer("smallholder-1")).status_code == 204
