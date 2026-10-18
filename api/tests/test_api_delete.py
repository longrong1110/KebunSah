"""DELETE /api/plots/{id}、DELETE /api/documents/{id}：删得掉自己的、别人的不行、演示数据不行、评估在跑不行。"""
from datetime import timedelta

from api_helpers import bearer


def _plot(client, uid="smallholder-1"):
    return client.post("/api/plots", headers=bearer(uid), json={}).json()["plotId"]


def _upload(client, pid, uid="smallholder-1"):
    """登记一份文件并把照片传上去，返回 (documentId, 照片路径)。"""
    r = client.post(f"/api/plots/{pid}/documents", headers=bearer(uid),
                    json={"docType": "land_title", "contentType": "image/jpeg", "source": "camera"}).json()
    assert client.put(r["upload"]["url"].removeprefix("http://test"), content=b"\xff\xd8x").status_code == 200
    return r["documentId"], f"plots/{pid}/documents/{r['documentId']}.jpg"


def _assessment(store, pid, status, created):
    store.set(f"plots/{pid}/assessments/a1", {"plotId": pid, "runStatus": status, "createdAt": created, "ruleResults": [], "gaps": []})


def test_owner_deletes_plot_with_documents_assessments_and_photos(client, store, make_deps, clock):
    pid = _plot(client)
    doc_id, path = _upload(client, pid)
    _assessment(store, pid, "done", clock())
    deps_blobs = client.app.state.deps.blobs
    assert deps_blobs.exists(path)

    r = client.delete(f"/api/plots/{pid}", headers=bearer("smallholder-1"))
    assert r.status_code == 204 and r.content == b""
    assert store.get(f"plots/{pid}") is None
    assert store.get(f"plots/{pid}/documents/{doc_id}") is None
    assert store.get(f"plots/{pid}/assessments/a1") is None
    assert not deps_blobs.exists(path)


def test_delete_plot_keeps_other_plots(client, store):
    keep, drop = _plot(client), _plot(client)
    client.delete(f"/api/plots/{drop}", headers=bearer("smallholder-1"))
    assert store.get(f"plots/{keep}") is not None


def test_someone_elses_plot_is_forbidden_and_unknown_is_404(client, store):
    pid = _plot(client)
    assert client.delete(f"/api/plots/{pid}", headers=bearer("smallholder-2")).status_code == 403
    assert store.get(f"plots/{pid}") is not None
    assert client.delete("/api/plots/nope", headers=bearer("smallholder-1")).status_code == 404
    assert client.delete(f"/api/plots/{pid}").status_code == 401


def test_demo_data_cannot_be_deleted(client, store):
    pid = _plot(client)
    store.update(f"plots/{pid}", {"isSynthetic": True})
    r = client.delete(f"/api/plots/{pid}", headers=bearer("smallholder-1"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_data_protected"
    assert store.get(f"plots/{pid}") is not None


def test_running_assessment_blocks_delete_but_stale_one_does_not(client, store, clock):
    pid = _plot(client)
    _assessment(store, pid, "running", clock())
    r = client.delete(f"/api/plots/{pid}", headers=bearer("smallholder-1"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "assessment_in_progress"
    assert store.get(f"plots/{pid}") is not None

    _assessment(store, pid, "running", clock() - timedelta(hours=2))  # Cloud Run 实例被回收后留下的残留
    assert client.delete(f"/api/plots/{pid}", headers=bearer("smallholder-1")).status_code == 204


def test_delete_one_document_removes_record_and_photo_only(client, store):
    pid = _plot(client)
    keep_id, keep_path = _upload(client, pid)
    drop_id, drop_path = _upload(client, pid)
    blobs = client.app.state.deps.blobs
    r = client.delete(f"/api/documents/{drop_id}", headers=bearer("smallholder-1"))
    assert r.status_code == 204
    assert store.get(f"plots/{pid}/documents/{drop_id}") is None and not blobs.exists(drop_path)
    assert store.get(f"plots/{pid}/documents/{keep_id}") is not None and blobs.exists(keep_path)
    assert store.get(f"plots/{pid}") is not None


def test_delete_document_guards(client, store, clock):
    pid = _plot(client)
    doc_id, _ = _upload(client, pid)
    assert client.delete(f"/api/documents/{doc_id}", headers=bearer("smallholder-2")).status_code == 403
    assert client.delete("/api/documents/nope", headers=bearer("smallholder-1")).status_code == 404

    _assessment(store, pid, "queued", clock())
    r = client.delete(f"/api/documents/{doc_id}", headers=bearer("smallholder-1"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "assessment_in_progress"

    store.delete(f"plots/{pid}/assessments/a1")
    store.update(f"plots/{pid}", {"isSynthetic": True})
    r = client.delete(f"/api/documents/{doc_id}", headers=bearer("smallholder-1"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_data_protected"


def test_store_delete_and_delete_tree(store):
    store.set("plots/p/documents/d", {"x": 1})
    store.set("plots/p/documents/d/pages/1", {"y": 1})
    store.set("plots/q", {"z": 1})
    store.delete("plots/p/documents/d")  # 只删这一篇，子集合还在
    assert store.get("plots/p/documents/d") is None and store.get("plots/p/documents/d/pages/1") is not None
    store.delete("plots/missing")  # 不存在也不报错
    store.delete_tree("plots/p")
    assert store.get("plots/p/documents/d/pages/1") is None and store.get("plots/q") is not None
