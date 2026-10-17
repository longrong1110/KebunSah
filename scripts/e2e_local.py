"""本地端到端：对着模拟器 + 正在跑的 API，用 seed/photos 的仿真证件照走完整条主线并打印评估结果。

先起三样东西（各一个终端，仓库根目录，已 `pip install -r requirements-dev.txt`、复制好 .env）：
  1. cd web && npm run emulators                                   # Auth 9099 + Firestore 8080
  2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
       PYTHONPATH=core:api:ai-worker python -m uvicorn app.main:create_app_from_env --factory --port 8000
     （PowerShell：$env:PYTHONPATH="core;api;ai-worker"；.env 里的变量 create_app_from_env 会自己读）
  3. python scripts/e2e_local.py [--api http://127.0.0.1:8000] [--name "TAN AH KOW"]

没有 GEMINI_API_KEY 时抽取会失败，评估降级成 needs_review——这本身也是在演示降级。
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
for sub in ("core", "api", "ai-worker"):
    sys.path.insert(0, str(ROOT / sub))

PHOTOS = ROOT / "seed" / "photos"
SQUARE = {"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895],
                                                [101.149037, 4.310895], [101.149037, 4.309105]]]}
UPLOADS = [("land_title", "title-3-handwritten-area.jpg"), ("mpob_licence", "licence-1-clear.jpg"),
           ("mspo_cert", "mspo-cert-1-clear.jpg")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--name", default="TAN AH KOW")
    args = parser.parse_args()
    auth_host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
    os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")

    sign_up = httpx.post(f"http://{auth_host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake",
                         json={"email": f"{uuid.uuid4().hex[:8]}@example.com", "password": "secret123", "returnSecureToken": True})
    sign_up.raise_for_status()
    h = {"Authorization": f"Bearer {sign_up.json()['idToken']}"}
    api = httpx.Client(base_url=args.api, headers=h, timeout=30)

    def step(label: str, r: httpx.Response, ok: int) -> dict:
        print(f"{label:<28} {r.status_code}")
        if r.status_code != ok:
            print("  ", r.text)
            raise SystemExit(1)
        return r.json() if r.content else {}

    step("POST /api/me", api.post("/api/me", json={"fullName": args.name}), 201)
    plot_id = step("POST /api/plots", api.post("/api/plots", json={}), 201)["plotId"]
    saved = step("PATCH /api/plots/{id}", api.patch(f"/api/plots/{plot_id}", json={"geometryType": "polygon", "polygon": SQUARE}), 200)
    print(f"   后端重算面积 {saved['areaHaComputed']} ha")
    for doc_type, photo in UPLOADS:
        reg = step(f"POST …/documents ({doc_type})",
                   api.post(f"/api/plots/{plot_id}/documents", json={"docType": doc_type, "contentType": "image/jpeg", "source": "gallery"}), 201)
        up = reg["upload"]
        put = httpx.put(up["url"], content=(PHOTOS / photo).read_bytes(), headers=up["headers"], timeout=30)
        print(f"{'PUT 照片 ' + photo:<28} {put.status_code}")
        put.raise_for_status()
    assessment_id = step("POST …/assess", api.post(f"/api/plots/{plot_id}/assess"), 202)["assessmentId"]

    from app.firestore_store import FirestoreStore

    store = FirestoreStore(os.environ.get("GOOGLE_CLOUD_PROJECT", "demo-kebunsah"))
    path = f"plots/{plot_id}/assessments/{assessment_id}"
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        a = store.get(path) or {}
        print(f"  runStatus={a.get('runStatus')} progress={a.get('progress')}")
        if a.get("runStatus") in {"done", "failed"}:
            break
        time.sleep(2)
    else:
        print("超过 3 分钟还没结束")
        return 1

    print(f"\n结果 result={a.get('result')} plots.status={(store.get(f'plots/{plot_id}') or {}).get('status')}")
    print(f"森林 {a.get('forestRisk')} ({a.get('forestDataset')})  模型 {a.get('modelVersion')}  规则集 {a.get('rulesVersion')}")
    for r in a.get("ruleResults", []):
        print(f"  {r['ruleCode']} {r.get('docType') or '':<13} {r['result']:<13} 期望 {r['expectedValue']} 实际 {r['actualValue']}")
    for g in a.get("gaps", []):
        print(f"  缺口 {g['gapCode']:<14} {g['severity']:<6} {g['docType']}: {g['description']}")
    print(f"  总结：{a.get('summaryText')}")
    print("  日志：")
    for s in a.get("steps", []):
        print(f"    {s['step']:<8} {s['status']:<9} {s['ms']:>5}ms  {s['detail']}")
    if a.get("errorMessage"):
        print("  错误：", a["errorMessage"])
    return 0 if a.get("runStatus") == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
