"""把一个地块的资料（地块文档、证件读出的字段、MSPO 名单）拼成 core.evaluate_plot 要的 PlotFacts 与 critical。

只做"取值与拼装"，不判断对错——判断都在 core/。读出来的值可能是乱码：认不出的面积给 NaN、认不出的日期原样交给 core，
core 会把它们变成 needs_review 而不是抛错。
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

from kebunsah_core.evaluate import PlotFacts
from kebunsah_core.names import similarity
from kebunsah_core.params import DEFAULT_PARAMS, Params
from kebunsah_core.units import to_ha

from app.store import Store

from .fields import effective, parse_number, parse_unit

_PROPRIETOR = re.compile(r"land_title\.proprietor_(\d+)_name")
Doc = tuple[str, dict]  # (documentId, 文档)


@dataclass
class Built:
    facts: PlotFacts
    critical: dict[str, dict | None]
    evidence: dict[str, list[dict[str, str]]] = field(default_factory=dict)  # "CC-01" / "CC-02:mpob_licence" / "CC-03"


def merged_fields(docs: list[Doc], doc_type: str) -> dict[str, tuple[str, dict]]:
    """同一种证件的所有页合在一起：键 → (documentId, 字段)。页码大的覆盖小的。"""
    out: dict[str, tuple[str, dict]] = {}
    for doc_id, doc in sorted((d for d in docs if d[1].get("docType") == doc_type), key=lambda d: d[1].get("pageNo") or 1):
        for key, value in (doc.get("fields") or {}).items():
            out[key] = (doc_id, value)
    return out


def title_identity(docs: list[Doc]) -> dict[str, str]:
    """从地契照片读出的、用来给地块起名和做看板筛选的几项：地段号、地契号、县、州。读不到的不写；不含任何人名。"""
    if not any(d.get("docType") == "land_title" for _, d in docs):
        return {}
    fields = merged_fields(docs, "land_title")
    out: dict[str, str] = {}
    for plot_key, field_key in (("lotNo", "land_title.lot_no"), ("titleNo", "land_title.title_no"),
                                ("district", "land_title.district"), ("state", "land_title.state")):
        entry = fields.get(field_key)
        value = (effective(entry[1]) or "").strip() if entry else ""
        if value:
            out[plot_key] = value[:80]
    return out


def _has(docs: list[Doc], doc_type: str) -> bool:
    return any(d.get("docType") == doc_type for _, d in docs)


def _ref(entry: tuple[str, dict] | None, key: str) -> list[dict[str, str]]:
    return [{"documentId": entry[0], "fieldKey": key}] if entry else []


def _find_member(store: Store, cert_no: str | None, operator_name: str, params: Params):
    """按证书号找到 MSPO 团体证书，再在它的成员里找与园主姓名最像且过线的一位。"""
    if not cert_no:
        return None, None
    best = (None, None, 0.0)
    for cert_id, cert in store.list("mspoCertificates", [("certNo", "==", cert_no)]):
        for member_id, member in store.list(f"mspoCertificates/{cert_id}/members"):
            sim = similarity(operator_name, str(member.get("memberName") or ""))
            if sim > best[2]:
                best = ((cert_id, cert), (member_id, member), sim)
    if best[2] >= params.name_similarity_min:
        return best[0], best[1]
    return None, None


def build_facts(store: Store, plot: dict, operator_name: str, docs: list[Doc], *, plot_ha: float,
                params: Params = DEFAULT_PARAMS) -> Built:
    evidence: dict[str, list[dict[str, str]]] = {}
    critical: dict[str, dict | None] = {}

    # --- 地契 ---
    title_ha: float | None = None
    title_names: list[str] = []
    lease_expiry: str | None = None
    if _has(docs, "land_title"):
        lt = merged_fields(docs, "land_title")
        area_entry = lt.get("land_title.area_value")
        unit_entry = lt.get("land_title.area_unit")
        number = parse_number(effective(area_entry[1])) if area_entry else None
        unit = parse_unit(effective(unit_entry[1])) if unit_entry else "ha"
        title_ha = to_ha(number, unit) if number is not None and unit else math.nan
        critical["area"] = area_entry[1] if area_entry else None
        evidence["CC-01"] = _ref(area_entry, "land_title.area_value")
        proprietors = sorted(((int(m[1]), key) for key in lt if (m := _PROPRIETOR.fullmatch(key))))
        named = [(key, effective(lt[key][1])) for _, key in proprietors]
        named = [(key, name) for key, name in named if name]
        title_names = [name for _, name in named]
        if named:
            best_key = max(named, key=lambda kn: similarity(operator_name, kn[1]))[0]
            critical["name"] = lt[best_key][1]
            evidence["CC-03"] = _ref(lt[best_key], best_key)
        lease_entry = lt.get("land_title.lease_expiry")
        lease_expiry = effective(lease_entry[1]) if lease_entry else None
        if lease_expiry is None and plot.get("landTitleId"):
            registry = store.get(f"titles/{plot['landTitleId']}") or {}
            lease_expiry = registry.get("leaseExpiry")
        if lease_entry:
            evidence["CC-02:land_title"] = _ref(lease_entry, "land_title.lease_expiry")

    # --- MPOB 执照 ---
    licence_valid_until: str | None = None
    licence_name: str | None = None
    if _has(docs, "mpob_licence"):
        ml = merged_fields(docs, "mpob_licence")
        valid_entry = ml.get("mpob_licence.valid_until")
        licence_valid_until = (effective(valid_entry[1]) if valid_entry else None) or ""
        name_entry = ml.get("mpob_licence.holder_name")
        licence_name = effective(name_entry[1]) if name_entry else None
        critical["valid_until"] = valid_entry[1] if valid_entry else None
        evidence["CC-02:mpob_licence"] = _ref(valid_entry, "mpob_licence.valid_until")

    # --- MSPO：名单（种子里有）→ 地块上记的链接 → 按证书号查 ---
    cert_expiry: str | None = None
    member_name: str | None = None
    cert_fields = merged_fields(docs, "mspo_cert")
    list_fields = merged_fields(docs, "mspo_member_list")
    cert_entry = cert_fields.get("mspo_cert.expiry_date")
    registry_cert: dict | None = None
    if (e := list_fields.get("mspo_member_list.member_name")):
        member_name = effective(e[1])
    if member_name is None and plot.get("mspoCertificateId") and plot.get("mspoMemberId"):
        member = store.get(f"mspoCertificates/{plot['mspoCertificateId']}/members/{plot['mspoMemberId']}")
        if member:
            member_name = member.get("memberName")
            registry_cert = store.get(f"mspoCertificates/{plot['mspoCertificateId']}")
    if member_name is None:
        cert_no = effective(cert_fields["mspo_cert.cert_no"][1]) if "mspo_cert.cert_no" in cert_fields else None
        found_cert, found_member = _find_member(store, cert_no, operator_name, params)
        if found_member:
            member_name = found_member[1].get("memberName")
            registry_cert = found_cert[1]
    in_mspo = member_name is not None
    if in_mspo:  # core 约定：园主在名单上才给证书到期日
        if cert_entry:
            cert_expiry = effective(cert_entry[1]) or ""
            evidence["CC-02:mspo_cert"] = _ref(cert_entry, "mspo_cert.expiry_date")
        elif plot.get("mspoCertificateId") or registry_cert:
            if registry_cert is None:
                registry_cert = store.get(f"mspoCertificates/{plot['mspoCertificateId']}")
            cert_expiry = (registry_cert or {}).get("expiryDate")

    facts = PlotFacts(operator_name=operator_name, plot_ha=plot_ha, title_ha=title_ha, title_names=tuple(title_names),
                      lease_expiry=lease_expiry, licence_valid_until=licence_valid_until, licence_name=licence_name,
                      cert_expiry=cert_expiry, member_name=member_name, in_mspo=in_mspo)
    return Built(facts=facts, critical=critical, evidence=evidence)
