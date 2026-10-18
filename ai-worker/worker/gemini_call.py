"""调用 Gemini 的统一入口：遇到 429（配额）按服务端说的"请 N 秒后再试"等一等再试，遇到 5xx（服务端暂时不可用）退避几秒再试，别的错误原样抛出。

免费档每个模型每分钟只许 5 次请求，而一次评估要调 4 次（3 份证件的抽取 + 1 次说明），一分钟内连评估两次就会撞上。
SDK 自带的重试间隔太短，对"每分钟配额"没用，所以 429 交给这里处理（SDK 那边只重试 5xx）。
"""
from __future__ import annotations

import re
import time
from collections.abc import Callable
from typing import Any

DEFAULT_WAIT_S = 20.0


def retry_after_seconds(exc: BaseException, attempt: int = 1) -> float | None:
    """该等多少秒再试；这个错误不值得重试返回 None。
    429（配额）：按服务端说的时间；500／502／503／504（服务端暂时不可用，Gemini 高峰期常见）：退避 4、8、12 秒。"""
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    text = str(exc)
    if code == 429 or "RESOURCE_EXHAUSTED" in text:
        m = re.search(r"retry in ([\d.]+)\s*s", text) or re.search(r"retryDelay['\"]?\s*:\s*['\"]?([\d.]+)\s*s", text)
        return float(m[1]) if m else DEFAULT_WAIT_S
    if code in {500, 502, 503, 504} or "UNAVAILABLE" in text:
        return min(4.0 * attempt, 12.0)
    return None


def generate_with_retry(client: Any, *, attempts: int = 4, max_wait_s: float = 60.0,
                        sleep: Callable[[float], None] | None = None, **kwargs: Any) -> Any:
    """client.models.generate_content(**kwargs)，429 时最多等 max_wait_s 秒、最多试 attempts 次。"""
    pause = sleep or time.sleep  # 调用时再取，测试里才能替换
    for attempt in range(1, attempts + 1):
        try:
            return client.models.generate_content(**kwargs)
        except Exception as exc:
            wait = retry_after_seconds(exc, attempt)
            if wait is None or attempt == attempts or wait > max_wait_s:
                raise
            pause(wait + 1.0)
    raise AssertionError("unreachable")  # pragma: no cover
