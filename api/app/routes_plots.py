"""POST /api/plots（建空地块）、PATCH /api/plots/{id}（保存多边形或一个点；面积与质心由后端重算）。"""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from kebunsah_core.geo import GeometryError, check_point, parse_polygon
from kebunsah_core.rules import valid_area_ha

from .access import load_plot
from .auth import User, get_user
from .deps import Deps, get_deps
from .errors import ApiError, forbidden, unprocessable

router = APIRouter()


class CreatePlot(BaseModel):
    model_config = ConfigDict(extra="ignore")
    memberId: str | None = None


class LngLat(BaseModel):
    lng: float
    lat: float


class PatchPlot(BaseModel):
    model_config = ConfigDict(extra="ignore")
    geometryType: Literal["polygon", "point"]
    polygon: dict | None = None
    point: LngLat | None = None
    areaHaDeclared: float | None = None


def _is_member(deps: Deps, user: User, person_id: str) -> bool:
    """成员 = 本合作社有地块以他为园主，或本合作社有绑定他的账号。"""
    if deps.store.list("plots", [("operatorPersonId", "==", person_id), ("coopId", "==", user.coop_id)]):
        return True
    return bool(deps.store.list("users", [("personId", "==", person_id), ("coopId", "==", user.coop_id)]))


@router.post("/api/plots", status_code=201)
def create_plot(body: CreatePlot | None = None, user: User = Depends(get_user), deps: Deps = Depends(get_deps)):
    body = body or CreatePlot()
    if user.is_staff:
        if not body.memberId:
            raise unprocessable("member_id_required", "field officers must say which member the plot is for")
        if deps.store.get(f"persons/{body.memberId}") is None or not _is_member(deps, user, body.memberId):
            raise forbidden("that person is not a member of your cooperative")
        operator = body.memberId
    else:
        if user.person_id is None:
            raise forbidden("account has no person record")
        if body.memberId not in (None, user.person_id):
            raise forbidden("smallholders can only create plots for themselves")
        operator = user.person_id
    plot_id = deps.new_id()
    now = deps.now()
    deps.store.set(f"plots/{plot_id}", {
        "operatorPersonId": operator, "coopId": user.coop_id, "countryCode": "MY", "status": "pending",
        "isSynthetic": False, "createdAt": now, "updatedAt": now,
    })
    return {"plotId": plot_id}


@router.patch("/api/plots/{plot_id}")
def patch_plot(plot_id: str, body: PatchPlot, user: User = Depends(get_user), deps: Deps = Depends(get_deps)):
    load_plot(deps.store, user, plot_id)
    now = deps.now()
    try:
        if body.geometryType == "polygon":
            if body.polygon is None:
                raise unprocessable("geometry_invalid", "polygon is required when geometryType is polygon")
            info = parse_polygon(body.polygon)
            if not valid_area_ha(info.area_ha):
                raise GeometryError("geometry_invalid", "polygon area is out of range")
            geojson = json.dumps({"type": "Polygon", "coordinates": [info.ring]}, separators=(",", ":"))
            changes = {"geometryType": "polygon", "polygonGeojson": geojson, "centroidLat": info.centroid_lat,
                       "centroidLng": info.centroid_lng, "areaHaComputed": info.area_ha, "areaHaDeclared": None}
        else:
            if body.point is None:
                raise unprocessable("geometry_invalid", "point is required when geometryType is point")
            lat, lng, area = check_point(body.point.lat, body.point.lng, body.areaHaDeclared, deps.params)
            changes = {"geometryType": "point", "polygonGeojson": None, "centroidLat": lat, "centroidLng": lng,
                       "areaHaComputed": None, "areaHaDeclared": area}
    except GeometryError as exc:
        raise ApiError(422, exc.code, str(exc)) from None
    except ValueError as exc:  # shapely / pyproj 对离谱输入抛的
        raise ApiError(422, "geometry_invalid", f"geometry could not be processed: {exc}") from None
    deps.store.update(f"plots/{plot_id}", {**changes, "geometryRecordedAt": now, "updatedAt": now})
    return JSONResponse(status_code=200, content={
        "plotId": plot_id, "geometryType": changes["geometryType"], "areaHaComputed": changes["areaHaComputed"],
        "areaHaDeclared": changes["areaHaDeclared"],
        "centroid": {"lat": changes["centroidLat"], "lng": changes["centroidLng"]}})
