"""森林初筛（EUDR：2020 年底之后不能有毁林）。

真实实现在 earthengine.py（JRC/GFC2020/V4 + Hansen Global Forest Change，FOREST_BACKEND=earthengine）。没配置 / 调不通时用 PrecomputedForest，
返回固定的演示数据并在 forestDataset 里写明 "precomputed-demo"——演示视频里要如实说明这一步用的是预先算好的数据。
查询失败（异常或 risk=unknown）时评估降级为 needs_review，而不是当作没有毁林。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ForestResult:
    cover_2020_pct: float | None
    loss_after_2020_ha: float | None
    risk: str  # low | medium | high | unknown
    dataset: str | None


class Forest(Protocol):
    def screen(self, lat: float, lng: float, ring: list[list[float]] | None, area_ha: float | None = None) -> ForestResult:
        """ring 是多边形的 [[lng, lat], …]；只记一个点时 ring 为 None，area_ha 是手填面积。"""


class PrecomputedForest:
    """演示用：不查任何数据，固定返回低风险，并把数据来源写成 precomputed-demo。"""

    DATASET = "precomputed-demo"

    def screen(self, lat: float, lng: float, ring: list[list[float]] | None, area_ha: float | None = None) -> ForestResult:
        return ForestResult(cover_2020_pct=0.0, loss_after_2020_ha=0.0, risk="low", dataset=self.DATASET)


class UnavailableForest:
    """查不到时的占位（以及测试降级用）：risk=unknown。"""

    def screen(self, lat: float, lng: float, ring: list[list[float]] | None, area_ha: float | None = None) -> ForestResult:
        return ForestResult(cover_2020_pct=None, loss_after_2020_ha=None, risk="unknown", dataset=None)
