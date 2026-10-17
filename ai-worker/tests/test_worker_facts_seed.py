"""用 seed 的 200 个地块验证：从 documents.fields 拼出的事实，经 core 评估得到的红黄绿与种子一致。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.store import MemoryStore
from kebunsah_core.evaluate import evaluate_plot
from kebunsah_core.params import params_from_config
from worker.facts import build_facts

SEED = Path(__file__).resolve().parents[2] / "seed" / "data"
AS_OF = json.loads((SEED / "_manifest.json").read_text(encoding="utf8"))["asOf"]


def _load(name):
    return json.loads((SEED / f"{name}.json").read_text(encoding="utf8"))


@pytest.fixture(scope="module")
def seeded():
    store = MemoryStore()
    for name in ("persons", "titles", "mspoCertificates", "mspoMembers", "plots", "documents"):
        for row in _load(name):
            store.set(row["path"], row["data"])
    return store


PLOT_IDS = [(r["path"].split("/")[1], r["data"]["status"]) for r in _load("plots")]
PARAMS = params_from_config(_load("config")[0]["data"])


@pytest.mark.parametrize("plot_id,status", PLOT_IDS, ids=[p[:8] for p, _ in PLOT_IDS])
def test_status_from_document_fields_matches_seed(seeded, plot_id, status):
    plot = seeded.get(f"plots/{plot_id}")
    operator = seeded.get(f"persons/{plot['operatorPersonId']}")["fullName"]
    docs = [d for d in seeded.list(f"plots/{plot_id}/documents") if d[1].get("isCurrent") is not False]
    plot_ha = plot["areaHaComputed"] if plot["geometryType"] == "polygon" else plot["areaHaDeclared"]
    built = build_facts(seeded, plot, operator, docs, plot_ha=plot_ha, params=PARAMS)
    ev = evaluate_plot(built.facts, built.critical, as_of=AS_OF, params=PARAMS)
    assert ev.status == status, [(r.rule_code, r.doc_type, r.result, r.detail) for r in ev.results]
