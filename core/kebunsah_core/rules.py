"""确定性规则：CC-01 面积、CC-02 有效期、CC-03 姓名，加上"读出置信度"。

逻辑与 seed/src/rules.mjs 一致（它是种子生成器用的实现），区别有两处，都是企划书 §11 / spec 的决定：
- CC-02 每份文件一条（带 doc_type），而不是只留最差的一条；
- 缺地契、缺执照按"缺文件"处理，不抛错。
说明文字（detail）用马来语，是兜底文案；前端不显示它们，按 gapCode 自己生成。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Any, Mapping

from .dates import diff_days
from .names import similarity
from .params import DEFAULT_PARAMS, Params
from .units import fmt_fixed, fmt_num, to_ten_thousandths


@dataclass
class RuleResult:
    rule_code: str
    result: str  # pass | warn | fail | needs_review
    expected_value: str
    actual_value: str
    params_used: dict[str, Any]
    detail: str
    doc_type: str | None = None  # 只有 CC-02（以及缺文件的行）带
    evidence: list[dict[str, str]] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)  # 给 derive_gaps 用，不进 Firestore

    def to_doc(self) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "ruleCode": self.rule_code,
            "result": self.result,
            "expectedValue": self.expected_value,
            "actualValue": self.actual_value,
            "paramsUsed": dict(self.params_used),
            "evidence": [dict(e) for e in self.evidence],
            "detail": self.detail,
        }
        if self.doc_type is not None:
            doc["docType"] = self.doc_type
        return doc


def _ha4(x: float) -> str:
    return fmt_fixed(x, 4)


def cc01(*, title_ha: float | None, plot_ha: float, params: Params = DEFAULT_PARAMS) -> RuleResult:
    """地图面积比地契多出多少。多出不超过"地契面积的 10% 与 0.1 公顷中较大者"→ 通过；超出 → 黄；多出超过 50% → 红。
    面积偏小不判（企划书 §8.6 未定，保守按通过）。"""
    used = {
        "tol_pct": params.area_tolerance_pct,
        "tol_min_ha": params.area_tolerance_min_ha,
        "fail_over_pct": params.area_fail_over_pct,
    }
    if title_ha is None:
        return RuleResult("CC-01", "fail", "Geran ada", "Tiada geran", used, "Geran belum dimuat naik",
                          doc_type="land_title", meta={"kind": "missing"})
    t = to_ten_thousandths(title_ha)
    p = to_ten_thousandths(plot_ha)
    over = p - t
    tol = max(t * params.area_tolerance_pct / 100, params.area_tolerance_min_ha * 10000)
    result = "pass"
    if over * 100 > t * params.area_fail_over_pct:
        result = "fail"
    elif over > tol:
        result = "warn"
    over_ha = over / 10000
    pct = over / t * 100
    if result == "pass":
        detail = f"Beza {fmt_fixed(over_ha, 2)} ha, dalam had yang dibenarkan"
    elif result == "warn":
        detail = f"Lebih {fmt_fixed(over_ha, 2)} ha (+{fmt_fixed(pct, 1)}%), melebihi had {fmt_fixed(tol / 10000, 3)} ha"
    else:
        detail = f"Lebih {fmt_fixed(pct, 0)}%, melebihi had {fmt_num(params.area_fail_over_pct)}%"
    return RuleResult("CC-01", result, f"{_ha4(title_ha)} ha", f"{_ha4(plot_ha)} ha", used, detail,
                      meta={"kind": "area", "over_ha": over_ha, "pct": pct})


def _expiry_used(params: Params) -> dict[str, Any]:
    return {"warn_days": params.expiry_warn_days}


def cc02(*, as_of: str, doc_type: str, label: str, expiry_date: str, params: Params = DEFAULT_PARAMS) -> RuleResult:
    """一份文件的有效期。已过期(<0 天) → 红；不足 warn_days(<90) → 黄；其余通过。到期当天按未过期。
    actualValue 的格式前端会解析：剩余天数写 "58 hari"，已过期写以 YYYY-MM-DD 开头的 "2026-04-30 telah tamat"。"""
    days = diff_days(as_of, expiry_date)
    if days < 0:
        result, kind = "fail", "expired"
    elif days < params.expiry_warn_days:
        result, kind = "warn", "expiring"
    else:
        result, kind = "pass", "ok"
    if kind == "expired":
        detail = f"{label} tamat pada {expiry_date}, telah tamat tempoh {-days} hari"
        actual = f"{expiry_date} telah tamat"
    else:
        detail = f"{label} tamat pada {expiry_date}, {days} hari lagi"
        actual = f"{days} hari"
    return RuleResult("CC-02", result, f">= {fmt_num(params.expiry_warn_days)} hari", actual, _expiry_used(params), detail,
                      doc_type=doc_type, meta={"kind": kind, "days": days, "date": expiry_date, "label": label})


def cc02_missing_licence(params: Params = DEFAULT_PARAMS) -> RuleResult:
    """缺 MPOB 执照记黄（团队约定，企划书屏 11 线框有 "MPOB licence missing" 一行）。"""
    return RuleResult("CC-02", "warn", "Lesen MPOB ada", "Tiada lesen MPOB", _expiry_used(params),
                      "Lesen MPOB belum dimuat naik", doc_type="mpob_licence", meta={"kind": "missing"})


def cc03(*, operator_name: str, title_names: list[str], licence_name: str | None = None,
         member_name: str | None = None, params: Params = DEFAULT_PARAMS) -> RuleResult:
    """园主姓名与三处纸面对得上吗。地契取各持有人中最像的一位；执照、MSPO 名单有才比；三段取最低。
    不采用"身份证哈希相同即同一人"的捷径（企划书里仍待确认）。"""
    used = {"min_similarity": params.name_similarity_min}
    expected = f">= {fmt_fixed(params.name_similarity_min, 2)}"
    if not title_names:
        return RuleResult("CC-03", "needs_review", expected, "Tiada geran", used, "Geran belum dimuat naik",
                          meta={"kind": "missing"})
    best = max(title_names, key=lambda n: similarity(operator_name, n))
    parts = [("geran", best)]
    if licence_name is not None:
        parts.append(("lesen MPOB", licence_name))
    if member_name is not None:
        parts.append(("senarai MSPO", member_name))
    scored = [(label, name, similarity(operator_name, name)) for label, name in parts]
    label, name, sim = min(scored, key=lambda s: s[2])
    result = "pass" if sim >= params.name_similarity_min else "fail"
    detail = ("Nama pada geran, lesen dan senarai sepadan" if result == "pass"
              else f"Nama pada {label} ialah {name}, berbeza daripada pengusaha {operator_name}")
    return RuleResult("CC-03", result, expected, fmt_fixed(sim, 2), used, detail,
                      meta={"kind": "name", "sim": sim, "label": label, "name": name})


def is_unconfirmed_low(field_doc: Mapping[str, Any] | None, params: Params = DEFAULT_PARAMS) -> bool:
    """置信度低于阈值（0.7）且用户还没确认 → 这个字段读不准，依赖它的规则只能"需人工复核"。
    没有字段（文件没读到）不算；有字段但没有置信度按低处理。"""
    if not field_doc:
        return False
    if field_doc.get("confirmedValue") is not None:
        return False
    confidence = field_doc.get("confidence")
    if confidence is None:
        return True
    return math.floor(confidence * 100 + 0.5) < math.floor(params.confidence_min * 100 + 0.5)


def to_needs_review(base: RuleResult, field_doc: Mapping[str, Any], doc_type: str) -> RuleResult:
    confidence = field_doc.get("confidence")
    shown = fmt_fixed(confidence, 2) if confidence is not None else "?"
    return replace(
        base,
        result="needs_review",
        actual_value=f"keyakinan bacaan {shown}",
        detail="Bacaan gambar kurang jelas, perlu disahkan",
        meta={**base.meta, "kind": "low_confidence", "doc_type": doc_type},
    )
