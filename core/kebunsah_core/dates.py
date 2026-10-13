"""日期计算：全部按 ISO 日期字符串（YYYY-MM-DD）的整数天算，不读系统时钟、不受时区影响。"""
from __future__ import annotations

from datetime import date


def day_number(iso: str) -> int:
    return date.fromisoformat(iso).toordinal()


def diff_days(frm: str, to: str) -> int:
    """frm → to 相隔几天（to 在后为正）。"""
    return day_number(to) - day_number(frm)
