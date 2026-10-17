"""对本机 Firestore + Auth 模拟器的集成测试：pytest -m emulator（默认不跑，PR 检查里也不跑）。
先起模拟器：cd web && npm run emulators（Firestore 8080、Auth 9099，项目 demo-kebunsah）。"""
import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from api_helpers import ScriptedExtractor, bearer
from app.auth import FirebaseTokenVerifier
from app.blobs import LocalBlobs
from app.config import Settings
from app.deps import Deps
from app.firestore_store import FirestoreStore
from app.main import create_app
from app.store import NotFoundError
from test_api_assess import GOOD
from worker.explain import TemplateExplainer
from worker.forest import PrecomputedForest

pytestmark = pytest.mark.emulator

PROJECT = "demo-kebunsah"
FIRESTORE_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
AUTH_HOST = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")


@pytest.fixture(scope="module")
def fs():
    os.environ["FIRESTORE_EMULATOR_HOST"] = FIRESTORE_HOST
    os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = AUTH_HOST
    try:
        httpx.get(f"http://{FIRESTORE_HOST}/", timeout=2)
    except httpx.HTTPError:
        pytest.skip("Firestore emulator is not running")
    return FirestoreStore(PROJECT)


@pytest.fixture
def root():
    return f"emutest-{uuid.uuid4().hex[:8]}"


def test_get_set_update_and_not_found(fs, root):
    fs.set(f"{root}/a", {"x": 1, "y": {"z": 2}})
    assert fs.get(f"{root}/a") == {"x": 1, "y": {"z": 2}}
    fs.update(f"{root}/a", {"x": 5})
    assert fs.get(f"{root}/a")["x"] == 5 and fs.get(f"{root}/a")["y"] == {"z": 2}
    assert fs.get(f"{root}/nope") is None
    with pytest.raises(NotFoundError):
        fs.update(f"{root}/nope", {"x": 1})
    with pytest.raises(NotFoundError):
        fs.update_nested(f"{root}/nope", ("fields", "k"), 1)


def test_dotted_keys_update_in_place_without_creating_a_nested_twin(fs, root):
    path = f"{root}/p1/documents/d1"
    fs.set(path, {"fields": {"land_title.lot_no": {"rawText": "12", "confidence": 0.5}}})
    fs.update_nested(path, ("fields", "land_title.lot_no", "confidence"), 0.9)
    fs.update_nested(path, ("fields", "land_title.lot_no", "confirmedValue"), "13")
    fs.update_nested(path, ("fields", "mpob_licence.valid_until"), {"rawText": "x", "confidence": 0.1})
    doc = fs.get(path)
    assert set(doc["fields"]) == {"land_title.lot_no", "mpob_licence.valid_until"}  # 没有并存的嵌套键
    assert doc["fields"]["land_title.lot_no"] == {"rawText": "12", "confidence": 0.9, "confirmedValue": "13"}


def test_list_where_and_find_in_group(fs, root):
    fs.set(f"{root}/p1", {"coopId": "c1", "n": 1})
    fs.set(f"{root}/p2", {"coopId": "c2", "n": 2})
    fs.set(f"{root}/p1/assessments/a1", {"runStatus": "running"})
    fs.set(f"{root}/p1/assessments/a2", {"runStatus": "done"})
    assert sorted(i for i, _ in fs.list(root, [("coopId", "==", "c2")])) == ["p2"]
    assert sorted(i for i, _ in fs.list(f"{root}/p1/assessments", [("runStatus", "in", ["queued", "running"])])) == ["a1"]
    path, doc = fs.find_in_group("assessments", "a2")
    assert path == f"{root}/p1/assessments/a2" and doc["runStatus"] == "done"
    assert fs.find_in_group("assessments", "zzz") is None


def test_whole_flow_against_the_emulators(fs, tmp_path):
    sign_up = httpx.post(f"http://{AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake",
                         json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": "secret123", "returnSecureToken": True})
    sign_up.raise_for_status()
    token = sign_up.json()["idToken"]
    fs.set("mspoCertificates/emu-cert", {"certNo": "MSPO 900001", "expiryDate": "2029-02-28"})
    fs.set("mspoCertificates/emu-cert/members/m1", {"memberName": "TAN AH KOW"})
    deps = Deps(settings=Settings(blobs_dir=str(tmp_path), public_base_url="http://test", assess_as_of="2026-10-17"),
                store=fs, blobs=LocalBlobs(tmp_path, "http://test"), verifier=FirebaseTokenVerifier(PROJECT),
                extractor=ScriptedExtractor(GOOD), explainer=TemplateExplainer(), forest=PrecomputedForest())
    client = TestClient(create_app(deps))
    h = {"Authorization": f"Bearer {token}"}

    assert client.post("/api/plots", headers=h, json={}).status_code == 403  # 还没建档
    me = client.post("/api/me", headers=h, json={"fullName": "Tan Ah Kow"})
    assert me.status_code == 201 and me.json()["role"] == "smallholder"
    pid = client.post("/api/plots", headers=h, json={}).json()["plotId"]
    square = {"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895],
                                                    [101.149037, 4.310895], [101.149037, 4.309105]]]}
    assert client.patch(f"/api/plots/{pid}", headers=h, json={"geometryType": "polygon", "polygon": square}).status_code == 200
    for doc_type in ("land_title", "mpob_licence", "mspo_cert"):
        r = client.post(f"/api/plots/{pid}/documents", headers=h,
                        json={"docType": doc_type, "contentType": "image/jpeg", "source": "camera"}).json()
        assert client.put(r["upload"]["url"].removeprefix("http://test"), content=b"\xff\xd8x").status_code == 200
    assert client.post(f"/api/plots/{pid}/assess", headers=h).status_code == 202

    rows = fs.list(f"plots/{pid}/assessments")
    assert len(rows) == 1 and rows[0][1]["runStatus"] == "done" and rows[0][1]["result"] == "green"
    assert fs.get(f"plots/{pid}")["status"] == "green"
    docs = fs.list(f"plots/{pid}/documents")
    licence = next(d for _, d in docs if d["docType"] == "mpob_licence")
    assert "mpob_licence" not in licence["fields"]  # 没有被拆成嵌套键
    assert licence["fields"]["mpob_licence.valid_until"]["normalizedValue"] == "2027-03-31"
    doc_id = next(i for i, d in docs if d["docType"] == "mpob_licence")
    r = client.patch(f"/api/documents/{doc_id}/fields", headers=h, json={"fields": {"mpob_licence.valid_until": "2027-04-01"}})
    assert r.status_code == 200
    assert fs.get(f"plots/{pid}/documents/{doc_id}")["fields"]["mpob_licence.valid_until"]["confirmedValue"] == "2027-04-01"
