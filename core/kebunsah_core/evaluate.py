"""把一个地块的事实喂给三条规则，得到规则结果、缺口和红黄绿。评估流水线和黄金测试都从这里进。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from .grading import Gap, aggregate, derive_gaps
from .params import DEFAULT_PARAMS, Params
from .rules import (RuleResult, cc01, cc02, cc02_missing_licence, cc03, is_unconfirmed_low,
                    to_needs_review)


@dataclass(frozen=True)
class PlotFacts:
    """评估一个地块用到的、已经规范化的事实。缺的文件用 None / 空表示。"""
    operator_name: str
    plot_ha: float  # 多边形的重算面积，或只记一个点时手填的面积
    title_ha: float | None = None  # 地契面积（已换算成公顷）；None = 没有地契
    title_names: tuple[str, ...] = ()  # 地契上登记的全部持有人
    lease_expiry: str | None = None  # 仅租约
    licence_valid_until: str | None = None  # None = 没有 MPOB 执照
    licence_name: str | None = None
    cert_expiry: str | None = None  # 园主在 MSPO 名单上时才给
    member_name: str | None = None
    in_mspo: bool = False


@dataclass
class Evaluation:
    results: list[RuleResult] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)
    status: str = "pending"


def evaluate_plot(facts: PlotFacts, critical: Mapping[str, Mapping | None] | None = None, *, as_of: str,
                  params: Params = DEFAULT_PARAMS) -> Evaluation:
    """critical 是三个关键字段的读出结果（含 confidence、confirmedValue），键为 area / valid_until / name；
    置信度低于阈值又没确认的，依赖它的规则降为 needs_review。"""
    critical = critical or {}
    r1 = cc01(title_ha=facts.title_ha, plot_ha=facts.plot_ha, params=params)
    if facts.title_ha is not None and is_unconfirmed_low(critical.get("area"), params):
        r1 = to_needs_review(r1, critical["area"], "land_title")

    r2: list[RuleResult] = []
    if facts.licence_valid_until is None:
        r2.append(cc02_missing_licence(params))
    else:
        row = cc02(as_of=as_of, doc_type="mpob_licence", label="MPOB", expiry_date=facts.licence_valid_until, params=params)
        if is_unconfirmed_low(critical.get("valid_until"), params):
            row = to_needs_review(row, critical["valid_until"], "mpob_licence")
        r2.append(row)
    if facts.lease_expiry is not None:
        r2.append(cc02(as_of=as_of, doc_type="land_title", label="sewaan", expiry_date=facts.lease_expiry, params=params))
    if facts.cert_expiry is not None:
        r2.append(cc02(as_of=as_of, doc_type="mspo_cert", label="MSPO", expiry_date=facts.cert_expiry, params=params))

    r3 = cc03(operator_name=facts.operator_name, title_names=list(facts.title_names),
              licence_name=facts.licence_name, member_name=facts.member_name, params=params)
    if facts.title_names and is_unconfirmed_low(critical.get("name"), params):
        r3 = to_needs_review(r3, critical["name"], "land_title")

    results = [r1, *r2, r3]
    gaps = derive_gaps(results, not_in_mspo=not facts.in_mspo)
    return Evaluation(results=results, gaps=gaps, status=aggregate(results, gaps))
