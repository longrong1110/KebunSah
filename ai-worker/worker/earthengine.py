"""真实的森林初筛：Google Earth Engine。

EUDR 的截止日是 2020-12-31：之后不能有毁林。做法（初筛，不是认证）：
  - JRC Global Forest Cover 2020（JRC/GFC2020/V4，10 米）：2020 年是不是森林（Map == 1；非森林被遮罩）
  - Hansen Global Forest Change（UMD/hansen/global_forest_change_2025_v1_13，30 米）：lossyear 21..25 = 2021..2025 年有树冠损失
  - 地块范围内：面积、2020 年森林面积、「2020 年是森林、之后又有损失」的面积
风险档位是保守的筛查口径，不是法律认定：损失 ≤ 1 个像素 → low；有损失但很小 → medium；明显 → high（交给人复核）。
数据集 ID 会随版本更新；2026-10-18 用 earthengine-api 核对过这两个都存在，波段分别是 Map、lossyear。

失败（没权限、超时、接口出错）抛异常，由流水线降级成 forestRisk = unknown（再降成需人工复核），不会悄悄当成「没有损失」。
"""
from __future__ import annotations

import math
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass

from .forest import ForestResult

GFC2020 = "JRC/GFC2020/V4"
HANSEN = "UMD/hansen/global_forest_change_2025_v1_13"
DATASET = f"{GFC2020} + {HANSEN}"
FIRST_LOSS_YEAR_CODE = 21  # Hansen lossyear：21 = 2021，即截止日之后
SCALE_M = 10  # 与 JRC 2020 地图同一分辨率；小地块（≤ 40 公顷）几千个像素，很快
PIXEL_HA = (SCALE_M * SCALE_M) / 10_000  # 一个像素的公顷数，损失不超过它当噪声


@dataclass(frozen=True)
class ForestStats:
    area_ha: float
    forest_2020_ha: float
    loss_after_2020_ha: float


def buffer_radius_m(area_ha: float) -> float:
    """只记一个点时：以该点为圆心、面积等于手填面积的圆的半径（米）"""
    return math.sqrt(area_ha * 10_000 / math.pi)


def risk_level(stats: ForestStats) -> str:
    """low：2020 年后的损失不超过一个像素；medium：有损失但小（< 0.1 公顷且 < 5%）；high：其余。"""
    loss = stats.loss_after_2020_ha
    if loss <= PIXEL_HA * 1.01:
        return "low"
    share = loss / stats.area_ha if stats.area_ha > 0 else 1.0
    return "medium" if (loss < 0.1 and share < 0.05) else "high"


def to_result(stats: ForestStats) -> ForestResult:
    area = stats.area_ha
    cover = 100 * stats.forest_2020_ha / area if area > 0 else 0.0
    return ForestResult(cover_2020_pct=round(min(max(cover, 0.0), 100.0), 1),
                        loss_after_2020_ha=round(max(stats.loss_after_2020_ha, 0.0), 4),
                        risk=risk_level(stats), dataset=DATASET)


class EarthEngineForest:
    """Forest 协议的 Earth Engine 实现。compute 可以注入（测试用）；默认真的去查。"""

    def __init__(self, project: str, *, timeout_s: float = 25.0, credentials=None,
                 compute: Callable[[float, float, list[list[float]] | None, float | None], ForestStats] | None = None):
        self.project = project
        self.timeout_s = timeout_s
        self._credentials = credentials  # 不给就用运行环境的默认凭据（Cloud Run 上是服务账号）
        self._compute = compute or self._compute_with_ee
        self._init_lock = threading.Lock()
        self._initialised = False
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="earthengine")

    def screen(self, lat: float, lng: float, ring: list[list[float]] | None, area_ha: float | None = None) -> ForestResult:
        future = self._pool.submit(self._compute, lat, lng, ring, area_ha)
        try:
            return to_result(future.result(timeout=self.timeout_s))
        except FutureTimeout:
            future.cancel()
            raise TimeoutError(f"Earth Engine did not answer within {self.timeout_s:.0f}s") from None

    # ---- 真的去查 ----

    def _ensure_initialised(self):
        import ee

        with self._init_lock:
            if not self._initialised:
                credentials = self._credentials
                if credentials is None:
                    import google.auth

                    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/earthengine",
                                                                  "https://www.googleapis.com/auth/cloud-platform"])
                ee.Initialize(credentials=credentials, project=self.project)
                self._initialised = True
        return ee

    def _compute_with_ee(self, lat: float, lng: float, ring: list[list[float]] | None, area_ha: float | None) -> ForestStats:
        ee = self._ensure_initialised()
        if ring:
            geometry = ee.Geometry.Polygon([ring], None, False)
        elif area_ha and area_ha > 0:
            geometry = ee.Geometry.Point([lng, lat]).buffer(buffer_radius_m(area_ha))
        else:
            raise ValueError("need a polygon, or a point with its declared area")
        forest = ee.Image(GFC2020).select("Map").eq(1)
        lost_after_cutoff = ee.Image(HANSEN).select("lossyear").gte(FIRST_LOSS_YEAR_CODE).And(forest)
        pixel_ha = ee.Image.pixelArea().divide(10_000)
        stats = ee.Image.cat([
            pixel_ha.rename("area"),
            pixel_ha.updateMask(forest).rename("forest"),
            pixel_ha.updateMask(lost_after_cutoff).rename("loss"),
        ]).reduceRegion(reducer=ee.Reducer.sum(), geometry=geometry, scale=SCALE_M, maxPixels=1_000_000_000).getInfo()
        return ForestStats(area_ha=float(stats.get("area") or 0.0), forest_2020_ha=float(stats.get("forest") or 0.0),
                           loss_after_2020_ha=float(stats.get("loss") or 0.0))
