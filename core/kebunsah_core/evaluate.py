"""把一个地块的事实喂给三条规则，得到规则结果、缺口和红黄绿。评估流水线和黄金测试都从这里进。"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from .dates import day_number
from .grading import Gap, aggregate, derive_gaps
from .params import DEFAULT_PARAMS, Params
from .rules import (RuleResult, cc01, cc02, cc02_missing_licence, cc03, clean_name, is_unconfirmed_low,
                    to_needs_review, valid_area_ha)


@dataclass(frozen=True)
class PlotFacts:
    """评估一个地块用到的、已经规范化的事实。缺的文件用 None / 空表示。

    约定：来自文件的字段（title_ha、title_names、各到期日、licence_name、member_name）可能是乱码——模型读错、用户填错；
    评估不会因此抛错，而是给出 needs_review 的行。三个到期日只认纯 YYYY-MM-DD 字符串（带时间、别的写法都算读不准），
    调用方要先规范化 / 截取。operator_name（来自我们自己的库）和 plot_ha（来自 parse_polygon / check_point）必须有效，
    不对就是调用方的 bug，evaluate_plot 抛 ValueError。
    """
    operator_name: str
    plot_ha: float  # 多边形的重算面积，或只记一个点时手填的面积；必须是 0 < x < 1e9 的有限数
    title_ha: float | None = None  # 地契面积（已换算成公顷）；None = 没有地契
    title_names: tuple[str, ...] = ()  # 地契上登记的全部持有人
    lease_expiry: str | None = None  # 仅租约；YYYY-MM-DD
    licence_valid_until: str | None = None  # None = 没有 MPOB 执照；YYYY-MM-DD
    licence_name: str | None = None
    cert_expiry: str | None = None  # 园主在 MSPO 名单上时才给；YYYY-MM-DD
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
    置信度低于阈值（或根本不是正常的数）又没确认的，依赖它的规则降为 needs_review。

    对文件里读出来的值是全函数（见 PlotFacts）。plot_ha 无效、as_of 不是 YYYY-MM-DD、operator_name 为空，都是调用方的 bug，
    抛 ValueError。"""
    if not valid_area_ha(facts.plot_ha):
        raise ValueError("plot_ha must be a finite number > 0")
    try:
        day_number(as_of)  # 没有任何带日期的文件时 as_of 用不上，但写错照样要报
    except (ValueError, TypeError) as exc:
        raise ValueError("as_of must be a plain YYYY-MM-DD date string") from exc
    critical = critical or {}
    title_names = tuple(n for n in map(clean_name, facts.title_names or ()) if n is not None)
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

    r3 = cc03(operator_name=facts.operator_name, title_names=list(title_names),
              licence_name=facts.licence_name, member_name=facts.member_name, params=params)
    if title_names and is_unconfirmed_low(critical.get("name"), params):
        r3 = to_needs_review(r3, critical["name"], "land_title")

    results = [r1, *r2, r3]
    gaps = derive_gaps(results, not_in_mspo=not facts.in_mspo)
    return Evaluation(results=results, gaps=gaps, status=aggregate(results, gaps))
