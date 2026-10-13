"""地块几何：校验 GeoJSON 多边形，按 WGS84 椭球算面积，算质心。后端重算，不信前端传来的数。

前端屏 5 预览用的是球面算法（@turf/area），椭球算法在半岛纬度大约小 0.7%，所以最终数字可能与预览略有出入。
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from pyproj import Geod
from shapely.geometry import Polygon

from .params import DEFAULT_PARAMS, Params

GEOD = Geod(ellps="WGS84")
MIN_AREA_HA = 0.005  # 与前端屏 5 的校验一致


class GeometryError(ValueError):
    """几何不合法。code 给接口层映射成 422 的错误码。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PolygonInfo:
    ring: list[list[float]]  # [[lng, lat], ...]，首尾闭合，6 位小数
    area_ha: float  # 4 位小数
    centroid_lat: float
    centroid_lng: float


def _invalid(message: str) -> GeometryError:
    return GeometryError("geometry_invalid", message)


def _coord(pair: Any) -> list[float]:
    if not isinstance(pair, (list, tuple)) or len(pair) < 2:
        raise _invalid("coordinate must be [lng, lat]")
    lng, lat = pair[0], pair[1]
    for v in (lng, lat):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise _invalid("coordinate must be a finite number")
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise _invalid("coordinate out of range")
    return [round(float(lng), 6), round(float(lat), 6)]


def parse_polygon(geojson: Any) -> PolygonInfo:
    if not isinstance(geojson, dict) or geojson.get("type") != "Polygon":
        raise _invalid("geometry must be a GeoJSON Polygon")
    rings = geojson.get("coordinates")
    if not isinstance(rings, list) or len(rings) != 1:
        raise _invalid("polygon must have exactly one ring (no holes)")
    ring = [_coord(p) for p in rings[0]]
    if len(ring) < 4:
        raise _invalid("ring needs at least 3 distinct vertices")
    if ring[0] != ring[-1]:
        raise _invalid("ring is not closed")
    if len({tuple(p) for p in ring[:-1]}) < 3:
        raise _invalid("ring needs at least 3 distinct vertices")
    poly = Polygon(ring)
    if not poly.is_valid:
        raise _invalid("ring is self-intersecting")
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    area_ha = round(abs(GEOD.polygon_area_perimeter(lons, lats)[0]) / 10000, 4)
    if area_ha < MIN_AREA_HA:
        raise _invalid("polygon area is too small")
    centroid = poly.centroid
    if not poly.contains(centroid):
        centroid = poly.representative_point()
    return PolygonInfo(ring=ring, area_ha=area_ha, centroid_lat=round(centroid.y, 6), centroid_lng=round(centroid.x, 6))


def check_point(lat: Any, lng: Any, area_ha_declared: Any, params: Params = DEFAULT_PARAMS) -> tuple[float, float, float]:
    """只记一个点：返回规范化后的 (lat, lng, 手填面积)。面积必须 >0 且 < point_max_ha（EUDR：4 公顷以下才能只给一个点）。"""
    lng_, lat_ = _coord([lng, lat])
    if isinstance(area_ha_declared, bool) or not isinstance(area_ha_declared, (int, float)) or not math.isfinite(area_ha_declared):
        raise _invalid("declared area must be a number")
    if area_ha_declared <= 0:
        raise _invalid("declared area must be greater than 0")
    if area_ha_declared >= params.point_max_ha:
        raise GeometryError("point_area_too_large", f"point mode needs an area below {params.point_max_ha} ha")
    return lat_, lng_, round(float(area_ha_declared), 4)
