import json
from pathlib import Path

import pytest

from kebunsah_core.geo import GeometryError, check_point, parse_polygon

SQUARE = {"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895],
                                                [101.149037, 4.310895], [101.149037, 4.309105]]]}
SEED_PLOTS = Path(__file__).resolve().parents[2] / "seed" / "data" / "plots.json"


def test_parse_polygon_returns_area_and_centroid():
    info = parse_polygon(SQUARE)
    assert info.area_ha == pytest.approx(4.23, abs=0.02)
    assert (info.centroid_lat, info.centroid_lng) == (4.31, 101.15)
    assert info.ring[0] == info.ring[-1]


def test_parse_polygon_rounds_coordinates_to_six_decimals():
    ring = [[101.1490371234, 4.3091051234], [101.150963, 4.309105], [101.150963, 4.310895], [101.1490371234, 4.3091051234]]
    assert parse_polygon({"type": "Polygon", "coordinates": [ring]}).ring[0] == [101.149037, 4.309105]


@pytest.mark.parametrize("bad", [
    {"type": "Point", "coordinates": [101, 4]},
    {"type": "Polygon", "coordinates": []},
    {"type": "Polygon", "coordinates": [[[101, 4], [101.1, 4], [101.1, 4.1]]]},  # 没闭合、点太少
    {"type": "Polygon", "coordinates": [[[101, 4], [101.1, 4], [101.1, 4.1], [101, 4.2]]]},  # 没闭合
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},  # 蝴蝶结自交
    {"type": "Polygon", "coordinates": [[[200, 4], [101.1, 4], [101.1, 4.1], [200, 4]]]},  # 经度越界
    {"type": "Polygon", "coordinates": [[[101, 4], [101.0000001, 4], [101, 4.0000001], [101, 4]]]},  # 太小
    {"type": "Polygon", "coordinates": [[["a", 4], [101.1, 4], [101.1, 4.1], ["a", 4]]]},
])
def test_parse_polygon_rejects_bad_geometry(bad):
    with pytest.raises(GeometryError) as err:
        parse_polygon(bad)
    assert err.value.code == "geometry_invalid"


def test_area_is_within_one_percent_of_the_seed_spherical_area():
    # 种子用球面公式（与前端 @turf/area 同口径），后端用 WGS84 椭球，半岛纬度上约小 0.7%
    plots = [p["data"] for p in json.loads(SEED_PLOTS.read_text(encoding="utf8")) if p["data"]["geometryType"] == "polygon"]
    assert len(plots) == 178
    for d in plots:
        info = parse_polygon(json.loads(d["polygonGeojson"]))
        assert info.area_ha == pytest.approx(d["areaHaComputed"], rel=0.01)
        assert info.centroid_lat == pytest.approx(d["centroidLat"], abs=1e-4)
        assert info.centroid_lng == pytest.approx(d["centroidLng"], abs=1e-4)


def test_check_point_accepts_a_small_declared_area():
    assert check_point(4.3, 101.1, 2.5) == (4.3, 101.1, 2.5)


def test_check_point_rejects_four_hectares_or_more():
    with pytest.raises(GeometryError) as err:
        check_point(4.3, 101.1, 4)
    assert err.value.code == "point_area_too_large"


@pytest.mark.parametrize("area", [0, -1, True, "2"])
def test_check_point_rejects_nonpositive_or_non_numeric_area(area):
    with pytest.raises(GeometryError) as err:
        check_point(4.3, 101.1, area)
    assert err.value.code == "geometry_invalid"


def test_parse_polygon_rejects_ring_that_is_not_a_list():
    # 外环不是数组时要给 GeometryError，而不是 TypeError（接口层只映射 GeometryError）
    for rings in ([None], [5]):
        with pytest.raises(GeometryError) as err:
            parse_polygon({"type": "Polygon", "coordinates": rings})
        assert err.value.code == "geometry_invalid"


def test_parse_polygon_rejects_integer_too_large_for_float():
    # json.loads 接受超大整数，math.isfinite 会抛 OverflowError，要转成 GeometryError
    ring = [[10**400, 4], [101.1, 4], [101.1, 4.1], [10**400, 4]]
    with pytest.raises(GeometryError) as err:
        parse_polygon({"type": "Polygon", "coordinates": [ring]})
    assert err.value.code == "geometry_invalid"


def test_check_point_rejects_declared_area_too_large_for_float():
    with pytest.raises(GeometryError) as err:
        check_point(4.3, 101.1, 10**400)
    assert err.value.code == "geometry_invalid"


def test_parse_polygon_rejects_area_below_minimum():
    # 边长约 6.6 米、面积约 0.0044 公顷，低于 MIN_AREA_HA，且顶点彼此不同，走的是面积分支
    ring = [[101, 4], [101.00006, 4], [101.00006, 4.00006], [101, 4.00006], [101, 4]]
    with pytest.raises(GeometryError) as err:
        parse_polygon({"type": "Polygon", "coordinates": [ring]})
    assert err.value.code == "geometry_invalid"
    assert "too small" in str(err.value)
