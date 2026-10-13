"""身份证号：打码与哈希。完整号码不入库，只存哈希和末四位。"""
from __future__ import annotations

import hashlib
import re

_IC_IN_TEXT = re.compile(r"(?<!\d)(\d{6})-?(\d{2})-?(\d{4})(?!\d)")


def mask_ic(last4: str) -> str:
    return f"******-**-{last4}"


def last4_of(ic: str) -> str:
    return re.sub(r"\D", "", ic)[-4:]


def hash_ic(ic: str, pepper: str = "") -> str:
    """SHA-256(pepper + 纯数字)。pepper 为空时与 seed 里的哈希相同；上线前必须配服务端秘密值。"""
    digits = re.sub(r"\D", "", ic)
    return hashlib.sha256((pepper + digits).encode("ascii")).hexdigest()


def mask_ic_in_text(text: str) -> str:
    """把文本里出现的完整 12 位身份证号（带不带短横线都行）换成 ******-**-1234。"""
    return _IC_IN_TEXT.sub(lambda m: mask_ic(m.group(3)), text)
