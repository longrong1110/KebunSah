import pytest

from app.store import MemoryStore, NotFoundError


def test_get_set_returns_copies():
    s = MemoryStore()
    s.set("plots/p1", {"status": "pending", "tags": ["a"]})
    got = s.get("plots/p1")
    got["tags"].append("b")
    assert s.get("plots/p1") == {"status": "pending", "tags": ["a"]}
    assert s.get("plots/nope") is None


def test_update_merges_top_level_and_requires_existing_doc():
    s = MemoryStore()
    s.set("plots/p1", {"a": 1, "b": 2})
    s.update("plots/p1", {"b": 3, "c": 4})
    assert s.get("plots/p1") == {"a": 1, "b": 3, "c": 4}
    with pytest.raises(NotFoundError):
        s.update("plots/missing", {"a": 1})


def test_update_nested_keeps_dotted_key_intact():
    s = MemoryStore()
    s.set("plots/p1/documents/d1", {"fields": {"land_title.lot_no": {"rawText": "12", "confidence": 0.5}}})
    s.update_nested("plots/p1/documents/d1", ("fields", "land_title.lot_no", "confidence"), 0.9)
    s.update_nested("plots/p1/documents/d1", ("fields", "land_title.title_no"), {"rawText": "GRN 1"})
    doc = s.get("plots/p1/documents/d1")
    assert doc["fields"]["land_title.lot_no"] == {"rawText": "12", "confidence": 0.9}
    assert doc["fields"]["land_title.title_no"] == {"rawText": "GRN 1"}
    assert "land_title" not in doc["fields"]  # 没有并存的嵌套键


def test_list_only_direct_children_with_where():
    s = MemoryStore()
    s.set("plots/p1", {"coopId": "c1"})
    s.set("plots/p2", {"coopId": "c2"})
    s.set("plots/p1/documents/d1", {"docType": "land_title"})
    assert [i for i, _ in s.list("plots")] == ["p1", "p2"]
    assert [i for i, _ in s.list("plots", [("coopId", "==", "c2")])] == ["p2"]
    assert [i for i, _ in s.list("plots", [("coopId", "in", ["c1", "c2"])])] == ["p1", "p2"]
    assert [i for i, _ in s.list("plots/p1/documents")] == ["d1"]
    assert s.list("plots/p9/documents") == []


def test_find_in_group():
    s = MemoryStore()
    s.set("plots/p1/documents/d1", {"docType": "land_title"})
    s.set("plots/p2/documents/d2", {"docType": "mpob_licence"})
    path, doc = s.find_in_group("documents", "d2")
    assert path == "plots/p2/documents/d2" and doc["docType"] == "mpob_licence"
    assert s.find_in_group("documents", "zzz") is None
    assert s.find_in_group("assessments", "d2") is None
