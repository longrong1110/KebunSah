"""Gemini 冒烟：对 seed/photos 的 16 张仿真证件照真实抽取，与种子里的期望值逐字段对照，打印准确率与耗时。
要 key、要花钱（16 次调用），所以不进 PR 检查。

用法（仓库根目录）：
  python scripts/gemini_smoke.py --list-models     # 先看这个 key 能用哪些模型，核对 GEMINI_EXTRACT_MODEL
  python scripts/gemini_smoke.py                   # 跑 16 张
  python scripts/gemini_smoke.py green-3-title-single-page red-4-licence-expired --model gemini-3.5-flash
key 从环境变量 GEMINI_API_KEY 或仓库根的 .env 读。
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):  # Windows 控制台默认不是 UTF-8，中文会抛 UnicodeEncodeError
    _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
for sub in ("core", "api", "ai-worker"):
    sys.path.insert(0, str(ROOT / sub))

from app.main import load_dotenv  # noqa: E402
from worker.fields import effective  # noqa: E402
from worker.gemini import ExtractionError, GeminiExtractor  # noqa: E402

PHOTOS = ROOT / "seed" / "photos"
# 期望值取自 seed/photos/README.md 与 seed/src/demo.mjs（演示地块）；只列有把握的字段
EXPECTED: dict[str, tuple[str, dict[str, str]]] = {
    "green-1-title-page1": ("land_title", {"land_title.title_no": "GRN 51234", "land_title.lot_no": "1052", "land_title.area_value": "4.2000", "land_title.area_unit": "ha"}),
    "green-2-title-page2": ("land_title", {"land_title.proprietor_1_name": "TAN AH KOW"}),
    "green-3-title-single-page": ("land_title", {"land_title.lot_no": "1052", "land_title.area_value": "4.2000", "land_title.proprietor_1_name": "TAN AH KOW"}),
    "green-4-licence": ("mpob_licence", {"mpob_licence.licence_no": "810200000011", "mpob_licence.holder_name": "TAN AH KOW", "mpob_licence.valid_until": "2027-03-31"}),
    "green-extra-title-handwritten": ("land_title", {"land_title.lot_no": "1052", "land_title.area_value": "4.2000"}),
    "yellow-1-title-page1": ("land_title", {"land_title.title_no": "HSM 2217/91", "land_title.lot_no": "2217", "land_title.area_value": "3.0400", "land_title.area_unit": "ha"}),
    "yellow-2-title-page2": ("land_title", {"land_title.proprietor_1_name": "AHMAD ZAKI BIN ROSLI"}),
    "yellow-3-title-single-page": ("land_title", {"land_title.lot_no": "2217", "land_title.area_value": "3.0400", "land_title.proprietor_1_name": "AHMAD ZAKI BIN ROSLI"}),
    "yellow-4-licence": ("mpob_licence", {"mpob_licence.licence_no": "810200000022", "mpob_licence.holder_name": "AHMAD ZAKI BIN ROSLI", "mpob_licence.valid_until": "2026-12-05"}),
    "yellow-extra-licence-blurry": ("mpob_licence", {"mpob_licence.valid_until": "2026-12-05"}),
    "red-1-title-page1": ("land_title", {"land_title.title_no": "GRN 30977", "land_title.lot_no": "88", "land_title.area_value": "2.0000", "land_title.area_unit": "ha"}),
    "red-2-title-page2": ("land_title", {"land_title.proprietor_1_name": "RAMAN A/L SUBRAMANIAM"}),
    "red-3-title-single-page": ("land_title", {"land_title.lot_no": "88", "land_title.area_value": "2.0000", "land_title.proprietor_1_name": "RAMAN A/L SUBRAMANIAM"}),
    "red-4-licence-expired": ("mpob_licence", {"mpob_licence.licence_no": "810200000033", "mpob_licence.holder_name": "MUTHU A/L RAMAN", "mpob_licence.valid_until": "2026-04-30"}),
    "mspo-cert-clear": ("mspo_cert", {"mspo_cert.cert_no": "MSPO 900001", "mspo_cert.expiry_date": "2029-02-28"}),
    "mspo-cert-extra-dark-tilted": ("mspo_cert", {"mspo_cert.cert_no": "MSPO 900001", "mspo_cert.expiry_date": "2029-02-28"}),
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

        client = genai.Client(api_key=key)  # 要一直拿着引用，否则列表还没读完客户端就被回收关闭了
        for m in client.models.list():
            print(m.name)
        return 0

    names = args.photos or list(EXPECTED)
    extractor = GeminiExtractor(api_key=key, model=[m.strip() for m in args.model.split(",") if m.strip()])
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
