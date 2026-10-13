"""身份证号：打码与哈希。完整号码不入库，只存哈希和末四位。

数字一律按 ASCII 0-9 认。Python 的 \\d 会把全角数字也当数字，那样既会漏打码，也会让哈希在 .encode("ascii") 时崩。
"""
from __future__ import annotations

import hashlib
import re

_IC_IN_TEXT = re.compile(r"(?<![0-9])([0-9]{6})-?([0-9]{2})-?([0-9]{4})(?![0-9])")
_NON_DIGIT = re.compile(r"[^0-9]")
_LAST4 = re.compile(r"[0-9]{4}")


def mask_ic(last4: str) -> str:
    """只接受正好 4 位 ASCII 数字（末四位）。传进整个号码会被拒绝，免得完整身份证号被当成"打码结果"存进库里。"""
    if not isinstance(last4, str) or not _LAST4.fullmatch(last4):
        raise ValueError("last4 must be exactly 4 ASCII digits")
    return f"******-**-{last4}"


def last4_of(ic: str) -> str:
    """身份证号的最后 4 位 ASCII 数字；没有数字时返回空串。"""
    return _NON_DIGIT.sub("", ic)[-4:]


def hash_ic(ic: str, pepper: str) -> str:
    """SHA-256(pepper + 12 位纯数字)。号码里的短横线、空格等会先去掉，去完后必须正好是 12 位 ASCII 数字，否则 ValueError
    （空串、位数不对、全角数字都拒绝，免得缺失的号码都哈希成同一个值而撞在一起）。

    pepper 是必填的：生产环境必须来自服务端配置（秘密值）。12 位号码只有约 10^8–10^9 种，不加盐的哈希能被穷举还原。
    传 "" 会得到与 seed 里一致的无盐哈希，只用于测试 / 对齐 seed，不要在生产代码里这么用。
    """
    if not isinstance(ic, str):
        raise ValueError("ic must contain exactly 12 ASCII digits")
    digits = _NON_DIGIT.sub("", ic)
    if len(digits) != 12:
        raise ValueError("ic must contain exactly 12 ASCII digits")
    return hashlib.sha256((pepper + digits).encode("utf-8")).hexdigest()


def mask_ic_in_text(text: str) -> str:
    """把文本里出现的完整 12 位身份证号（带不带短横线都行）换成 ******-**-1234。"""
    return _IC_IN_TEXT.sub(lambda m: mask_ic(m.group(3)), text)
