"""在线上（或模拟器）造一块「有读不准字段」的测试地，并用真实的评估流水线跑一遍。
用来测屏 8（确认字段）：这块地的 MPOB 执照日期置信度只有 0.45，评估会给出「读不准」的缺口，
用户在屏 10 点「Semak nilai」→ 屏 8 确认 → 重新评估，结果应该变好。

用法（仓库根目录；要先 gcloud auth login；.env 里要有 GEMINI_API_KEY）：
  python scripts/make_test_plot.py [--project kebunsah] [--owner a0000000-0000-4000-8000-000000000002]
默认园主是 demo-smallholder-2（Ahmad Zaki，+60100000012）。全部带 isSynthetic，不碰种子数据。
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
for sub in ("core", "api", "ai-worker", "scripts"):
    sys.path.insert(0, str(ROOT / sub))

import load_seed  # noqa: E402
from app.blobs import LocalBlobs  # noqa: E402
from app.config import Settings  # noqa: E402
from app.deps import Deps  # noqa: E402
from app.firestore_store import FirestoreStore  # noqa: E402
from app.main import _models, load_dotenv  # noqa: E402
from google.oauth2.credentials import Credentials  # noqa: E402
from kebunsah_core.params import params_from_config  # noqa: E402
from worker.earthengine import EarthEngineForest  # noqa: E402
from worker.explain import GeminiExplainer  # noqa: E402
from worker.pipeline import run_assessment  # noqa: E402

COOP = "c0000000-0000-4000-8000-000000000001"


def field(raw: str, value: str, confidence: float) -> dict:
    return {"rawText": raw, "normalizedValue": value, "confidence": confidence}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default="kebunsah")
    parser.add_argument("--owner", default="a0000000-0000-4000-8000-000000000002")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    if not args.project.startswith("demo-"):
        # .env 里的 FIRESTORE_EMULATOR_HOST 等是给本机模拟器用的；目标是线上项目时必须去掉，否则会悄悄连到本机
        for name in ("FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"):
            os.environ.pop(name, None)
    settings = Settings.from_env()
    creds = Credentials(token=load_seed.gcloud_token(), quota_project_id=args.project)
    store = FirestoreStore(args.project, credentials=creds)
    owner = store.get(f"persons/{args.owner}")
    if not owner:
        print("找不到这个园主：", args.owner)
        return 1
    now = datetime.now(timezone.utc)
    plot_id, aid = str(uuid.uuid4()), str(uuid.uuid4())
    store.set(f"plots/{plot_id}", {
        "operatorPersonId": args.owner, "coopId": COOP, "countryCode": "MY", "status": "pending", "isSynthetic": True,
        "geometryType": "point", "polygonGeojson": None, "centroidLat": 4.31, "centroidLng": 101.15,
        "areaHaComputed": None, "areaHaDeclared": 3.0, "geometryRecordedAt": now, "createdAt": now, "updatedAt": now,
        "nickname": "Test: values to confirm",
    })

    def doc(doc_type: str, status: str, fields: dict) -> None:
        doc_id = str(uuid.uuid4())
        store.set(f"plots/{plot_id}/documents/{doc_id}", {
            "documentId": doc_id, "plotId": plot_id, "docType": doc_type, "pageNo": 1, "isCurrent": True,
            "storagePath": f"test/{plot_id}/{doc_id}.jpg", "mimeType": "image/jpeg", "sha256": None, "source": "gallery",
            "uploadedBy": None, "capturedAt": now, "extractionStatus": status, "extractedAt": now, "modelVersion": "test-fixture",
            "fields": fields, "isSynthetic": True, "createdAt": now})

    doc("land_title", "extracted", {
        "land_title.lot_no": field("2217", "2217", 0.99), "land_title.area_value": field("3.04 Hektar", "3.0400", 0.97),
        "land_title.area_unit": field("Hektar", "ha", 0.97),
        "land_title.proprietor_1_name": field("AHMAD ZAKI BIN ROSLI", "AHMAD ZAKI BIN ROSLI", 0.97)})
    doc("mpob_licence", "needs_review", {
        "mpob_licence.licence_no": field("810200000022", "810200000022", 0.9),
        "mpob_licence.holder_name": field("AHMAD ZAKI BIN ROSLI", "AHMAD ZAKI BIN ROSLI", 0.95),
        "mpob_licence.valid_until": field("3l/03/2O27", "2027-03-31", 0.45)})  # 读不准：日期其实对，但置信度低
    doc("mspo_cert", "extracted", {
        "mspo_cert.cert_no": field("MSPO 900001", "MSPO 900001", 0.95), "mspo_cert.expiry_date": field("28/02/2029", "2029-02-28", 0.95)})
    store.set(f"plots/{plot_id}/assessments/{aid}", {
        "plotId": plot_id, "coopId": COOP, "runStatus": "queued", "result": None, "createdAt": now, "startedAt": None,
        "finishedAt": None, "ruleResults": [], "gaps": [], "isSynthetic": True})

    tmp = tempfile.mkdtemp()
    deps = Deps(
        settings=Settings(project_id=args.project, blobs_dir=tmp, dev_endpoints=False),
        store=store, blobs=LocalBlobs(tmp, "http://unused"), verifier=None, extractor=None,
        explainer=GeminiExplainer(settings.gemini_api_key, _models(settings.gemini_explain_model), settings.gemini_timeout_s),
        forest=EarthEngineForest(args.project, credentials=creds),
        params=params_from_config(store.get("config/ruleParams")))
    run_assessment(deps, plot_id, aid)
    a = store.get(f"plots/{plot_id}/assessments/{aid}")
    print(f"测试地块 {plot_id}\n评估 {a['runStatus']} → {a.get('result')}  森林 {a.get('forestRisk')} ({a.get('forestDataset')})")
    print("缺口:", [(g['gapCode'], g['docType']) for g in a["gaps"]])
    print("日志:", [(s['step'], s['status']) for s in a["steps"]])
    print("说明:", a.get("summaryText"), f"[{a.get('summaryModel')}]")
    return 0 if a["runStatus"] == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
