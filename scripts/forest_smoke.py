"""森林初筛冒烟：对几块位置已知的地真实查询 Earth Engine，打印结果和耗时。
用法（仓库根目录；要先 gcloud auth login，且项目已注册 Earth Engine）：python scripts/forest_smoke.py [--project kebunsah]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
for sub in ("core", "api", "ai-worker", "scripts"):
    sys.path.insert(0, str(ROOT / sub))

import load_seed  # noqa: E402
from google.oauth2.credentials import Credentials  # noqa: E402
from worker.earthengine import EarthEngineForest, buffer_radius_m  # noqa: E402

import math  # noqa: E402


def square(lat: float, lng: float, area_ha: float) -> list[list[float]]:
    half = math.sqrt(area_ha * 10_000) / 2
    dlat, dlng = half / 111_320, half / (111_320 * math.cos(math.radians(lat)))
    return [[lng - dlng, lat - dlat], [lng + dlng, lat - dlat], [lng + dlng, lat + dlat], [lng - dlng, lat + dlat], [lng - dlng, lat - dlat]]


CASES = [
    # 名称, 纬度, 经度, 面积(公顷), 用多边形还是一个点, 预期
    ("Kampar 示例地块（油棕园）", 4.31, 101.15, 4.2, "polygon", "low，2020 年不是森林"),
    ("Taman Negara 原始森林", 4.70, 102.45, 4.0, "polygon", "low，100% 森林、无损失"),
    ("Pahang 真实毁林点（2021–2025 年有损失）", 3.6654, 102.95906, 3.97, "polygon", "high，大面积损失"),
    ("同一个点，只记一个点 + 手填 3 公顷", 3.6654, 102.95906, 3.0, "point", "high"),
    ("吉隆坡市区", 3.139, 101.687, 1.0, "polygon", "low，0% 森林"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default="kebunsah")
    args = parser.parse_args()
    ef = EarthEngineForest(args.project, credentials=Credentials(token=load_seed.gcloud_token(), quota_project_id=args.project))
    for name, lat, lng, ha, mode, expect in CASES:
        ring = square(lat, lng, ha) if mode == "polygon" else None
        started = time.monotonic()
        r = ef.screen(lat, lng, ring, ha)
        print(f"{name}\n   {mode:7} {ha} ha → risk={r.risk}  2020 森林 {r.cover_2020_pct}%  2020 年后损失 {r.loss_after_2020_ha} ha  "
              f"[{time.monotonic() - started:.1f}s]   预期：{expect}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
