"""面积换算与取整。公式与 contract/schema.sql 的 land_titles.area_ha 生成列、seed/src/units.mjs 一致。

取整故意模仿 JavaScript（Math.round、toFixed），这样和种子生成的评估字符串逐字相同
（前端会严格解析其中的数字）。
"""
from __future__ import annotations

import math
import sys
from decimal import ROUND_HALF_UP, Decimal

ACRE_HA = 0.40468564224
SQFT_HA = 0.09290304 / 10000


def js_round(x: float, digits: int) -> float:
    """seed 的 round()：(x + EPSILON*sign) * 10^d 后按 Math.round（半数向正无穷）取整。"""
    f = 10**digits
    sign = (x > 0) - (x < 0)
    return math.floor((x + sys.float_info.epsilon * sign) * f + 0.5) / f


def to_ha(value: float, unit: str) -> float:
    if unit == "ha":
        return js_round(value, 4)
    if unit == "sqm":
        return js_round(value / 10000, 4)
    if unit == "acre":
        return js_round(value * ACRE_HA, 4)
    if unit == "sqft":
        return js_round(value * SQFT_HA, 4)
    raise ValueError(f"未知面积单位：{unit}")


def to_ten_thousandths(ha: float) -> int:
    """规则比较一律用"万分之一公顷"的整数，避免浮点误差让边界样本翻转。"""
    return math.floor(ha * 10000 + 0.5)


def fmt_fixed(x: float, digits: int) -> str:
    """等同 JavaScript 的 x.toFixed(digits)（半数远离 0），Python 的 format 是半数取偶，会差 1。"""
    quantum = Decimal(1).scaleb(-digits)
    return str(Decimal(x).quantize(quantum, rounding=ROUND_HALF_UP))


def fmt_num(x: float) -> str:
    """50.0 → "50"，0.5 → "0.5"，和 JavaScript 把 number 放进模板字符串一致。"""
    return str(int(x)) if float(x).is_integer() else str(x)
