"""Gemini 冒烟：对 seed/photos 的 9 张仿真证件照真实抽取，与种子里的期望值逐字段对照，打印准确率与耗时。
要 key、要花钱（9 次调用），所以不进 PR 检查。

用法（仓库根目录）：
  python scripts/gemini_smoke.py --list-models     # 先看这个 key 能用哪些模型，核对 GEMINI_EXTRACT_MODEL
  python scripts/gemini_smoke.py                   # 跑 9 张
  python scripts/gemini_smoke.py title-1-clear licence-2-blurry --model gemini-3.5-flash
key 从环境变量 GEMINI_API_KEY 或仓库根的 .env 读。
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for sub in ("core", "api", "ai-worker"):
    sys.path.insert(0, str(ROOT / sub))

from app.main import load_dotenv  # noqa: E402
from worker.fields import effective  # noqa: E402
from worker.gemini import ExtractionError, GeminiExtractor  # noqa: E402

PHOTOS = ROOT / "seed" / "photos"
# 期望值取自 seed/photos/README.md 与 seed/data/documents.json（演示地块）；只列有把握的字段
EXPECTED: dict[str, tuple[str, dict[str, str]]] = {
    "title-1-clear": ("land_title", {"land_title.lot_no": "2217", "land_title.area_value": "3.0400", "land_title.area_unit": "ha"}),
    "title-2-proprietor": ("land_title", {"land_title.proprietor_1_name": "AHMAD ZAKI BIN ROSLI"}),
    "title-3-handwritten-area": ("land_title", {"land_title.lot_no": "1052", "land_title.area_value": "4.2000"}),
    "title-4-deceased-father": ("land_title", {"land_title.proprietor_1_name": "RAMAN A/L SUBRAMANIAM"}),
    "licence-1-clear": ("mpob_licence", {"mpob_licence.licence_no": "810200000022", "mpob_licence.valid_until": "2026-12-05"}),
    "licence-2-blurry": ("mpob_licence", {"mpob_licence.valid_until": "2026-12-05"}),
    "licence-3-expired": ("mpob_licence", {"mpob_licence.licence_no": "810200000033", "mpob_licence.valid_until": "2026-04-30"}),
    "mspo-cert-1-clear": ("mspo_cert", {"mspo_cert.cert_no": "MSPO 900001", "mspo_cert.expiry_date": "2029-02-28"}),
    "mspo-cert-2-dark-tilted": ("mspo_cert", {"mspo_cert.cert_no": "MSPO 900001", "mspo_cert.expiry_date": "2029-02-28"}),
}


def main() -> int:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("photos", nargs="*", help="照片名（不带 .jpg）；不写就跑全部")
    parser.add_argument("--model", default=os.environ.get("GEMINI_EXTRACT_MODEL", "gemini-3.5-flash"))
    parser.add_argument("--list-models", action="store_true")
    args = parser.parse_args()
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("没有 GEMINI_API_KEY（环境变量或 .env）。去 aistudio.google.com 拿一个，不用绑卡。")
        return 2
    if args.list_models:
        from google import genai

        for m in genai.Client(api_key=key).models.list():
            print(m.name)
        return 0

    names = args.photos or list(EXPECTED)
    extractor = GeminiExtractor(api_key=key, model=args.model)
    total = right = 0
    for name in names:
        doc_type, expected = EXPECTED[name]
        image = (PHOTOS / f"{name}.jpg").read_bytes()
        started = time.monotonic()
        try:
            result = extractor.extract(doc_type, image, "image/jpeg")
        except ExtractionError as exc:
            print(f"\n{name}: 失败 — {exc}")
            total += len(expected)
            continue
        print(f"\n{name} ({doc_type}) {time.monotonic() - started:.1f}s tokens={result.usage}")
        for k, want in expected.items():
            got = effective(result.fields.get(k))
            ok = got is not None and got.upper() == want.upper()
            total += 1
            right += ok
            conf = result.fields.get(k, {}).get("confidence")
            print(f"  {'OK ' if ok else 'BAD'} {k}: 读到 {got!r} 期望 {want!r} 置信度 {conf}")
        extra = sorted(set(result.fields) - set(expected))
        if extra:
            print("  其他读出的字段：" + ", ".join(f"{k}={effective(result.fields[k])!r}" for k in extra))
    print(f"\n逐字段准确率：{right}/{total} = {right / total:.0%}" if total else "\n没有可比对的字段")
    return 0 if right == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
