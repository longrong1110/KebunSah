"""确定性规则：CC-01 面积、CC-02 有效期、CC-03 姓名，加上"读出置信度"。

逻辑与 seed/src/rules.mjs 一致（它是种子生成器用的实现），区别有两处，都是企划书 §11 / spec 的决定：
- CC-02 每份文件一条（带 doc_type），而不是只留最差的一条；
- 缺地契、缺执照按"缺文件"处理，不抛错。
说明文字（detail）用马来语，是兜底文案；前端不显示它们，按 gapCode 自己生成。

从文件读出来的值（面积、日期、姓名、置信度）可能是乱码（模型读错、用户填错），规则对它们是全函数：
读不准就给 needs_review 的行，不抛错。只有调用方自己传错（operator_name、as_of）才抛 ValueError。
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, replace
from typing import Any, Mapping

from .dates import day_number
from .names import similarity
from .params import DEFAULT_PARAMS, Params
from .units import fmt_fixed, fmt_num, to_ten_thousandths

MAX_AREA_HA = 1e9  # 面积上限（不含）。再大必是读错；也保证后面格式化时数位不会超出 Decimal 的精度
_PLAIN_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")  # 纯日期；Python 3.11 的 fromisoformat 还会收 20261231、2026-W44-1


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


def _finite_number(x: Any) -> bool:
    """非 bool 的有限实数（int / float）。bool、字符串、NaN、±inf、大到转不成 float 的整数都不算。"""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return False
    try:
        return math.isfinite(x)
    except OverflowError:
        return False


def valid_area_ha(x: Any) -> bool:
    """可用的公顷数：有限实数，且 0 < x < MAX_AREA_HA。"""
    return _finite_number(x) and 0 < x < MAX_AREA_HA


def clean_name(value: Any) -> str | None:
    """姓名清洗：非空白的字符串原样返回（不改内容），其余（None、非字符串、空串、纯空白）返回 None。"""
    if isinstance(value, str) and value.strip():
        return value
    return None


def _plain_day_number(value: Any) -> int | None:
    """纯 YYYY-MM-DD 日期的天数；其余（别的写法、带时间、不存在的日子、非字符串）返回 None。"""
    if not isinstance(value, str) or not _PLAIN_DAY.fullmatch(value):
        return None
    try:
        return day_number(value)
    except (ValueError, TypeError):
        return None


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
    t = to_ten_thousandths(title_ha) if valid_area_ha(title_ha) else 0
    if t <= 0:
        # 地契面积不是可用的数（读成 0 或负数、NaN、字符串、大得离谱，或小到四舍五入成 0）：
        # 不能拿它当分母，按"读不准，需确认"处理
        return RuleResult("CC-01", "needs_review", "Luas geran sah", "Luas geran tidak sah", used,
                          "Luas pada geran tidak sah, perlu disahkan",
                          meta={"kind": "low_confidence", "doc_type": "land_title"})
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
    today = day_number(as_of)  # as_of 是调用方给的，写错是 bug，照常抛 ValueError
    expiry = _plain_day_number(expiry_date)
    if expiry is None:
        # 文件上读出来的日期不是纯 YYYY-MM-DD（读错、格式不对、带了时间）：读不准，需确认
        return RuleResult("CC-02", "needs_review", f">= {fmt_num(params.expiry_warn_days)} hari", "Tarikh tidak sah",
                          _expiry_used(params), f"{label}: tarikh tamat tidak sah, perlu disahkan", doc_type=doc_type,
                          meta={"kind": "low_confidence", "doc_type": doc_type, "label": label})
    days = expiry - today
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
    if clean_name(operator_name) is None:
        raise ValueError("operator_name must be a non-empty string")  # 来自我们自己的库，不对就是程序 bug
    used = {"min_similarity": params.name_similarity_min}
    expected = f">= {fmt_fixed(params.name_similarity_min, 2)}"
    # 文件上读出来的姓名可能是 None / 空 / 非字符串：丢掉，不让它们进相似度计算
    title_names = [n for n in map(clean_name, title_names or ()) if n is not None]
    licence_name = clean_name(licence_name)
    member_name = clean_name(member_name)
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
    没有字段（文件没读到）不算；有字段但没有置信度、或置信度不是正常的有限数（字符串、bool、NaN、inf）按低处理。"""
    if not field_doc:
        return False
    if field_doc.get("confirmedValue") is not None:
        return False
    confidence = field_doc.get("confidence")
    if not _finite_number(confidence):
        return True
    try:
        return math.floor(confidence * 100 + 0.5) < math.floor(params.confidence_min * 100 + 0.5)
    except OverflowError:  # 大得离谱的数，*100 会溢出
        return True


def to_needs_review(base: RuleResult, field_doc: Mapping[str, Any], doc_type: str) -> RuleResult:
    confidence = field_doc.get("confidence")
    try:
        shown = fmt_fixed(confidence, 2) if _finite_number(confidence) else "?"
    except ArithmeticError:  # 有限但大得离谱（如 1e300），Decimal 放不下
        shown = "?"
    return replace(
        base,
        result="needs_review",
        actual_value=f"keyakinan bacaan {shown}",
        detail="Bacaan gambar kurang jelas, perlu disahkan",
        meta={**base.meta, "kind": "low_confidence", "doc_type": doc_type},
    )
