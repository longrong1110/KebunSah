"""缺口说明与一句话总结。gapCode / severity / docType / status 由规则确定，模型只许改 description 和 suggestedAction。

Gemini 不可用或返回乱码时回退到 core 里的马来语模板文案，评估照常完成。
提示里不放姓名（规则的 detail 里有），也要求模型别写人名、别推断亲属关系——这些文字前端本来也不显示，但会留在库里。
"""
from __future__ import annotations

import copy
import json
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from kebunsah_core.grading import Gap, summarize
from kebunsah_core.rules import RuleResult

from .gemini_call import generate_with_retry

MAX_TEXT = 300


@dataclass
class Explanation:
    summary_text: str
    summary_lang: str
    gaps: list[Gap]
    model: str
    seconds: float = 0.0
    usage: dict[str, int] = field(default_factory=dict)
    fallback_reason: str | None = None


class Explainer(Protocol):
    def explain(self, status: str, results: list[RuleResult], gaps: list[Gap]) -> Explanation: ...


class TemplateExplainer:
    """不调模型：core 的马来语模板。"""

    def explain(self, status: str, results: list[RuleResult], gaps: list[Gap]) -> Explanation:
        return Explanation(summary_text=summarize(status, gaps), summary_lang="ms", gaps=copy.deepcopy(gaps),
                           model="template")


class _GapText(BaseModel):
    index: int
    description: str
    suggested_action: str


class _Explanation(BaseModel):
    summary_text: str
    gaps: list[_GapText]


SYSTEM = (
    "You help Malaysian oil-palm smallholders understand a compliance check of their land documents. "
    "Write in simple Bahasa Malaysia, short sentences, no jargon, no legal threats. "
    "Use only the facts in the JSON you are given; do not invent laws, fees or deadlines. "
    "Never write any person's name and never guess family relationships. "
    "Return one description and one suggested_action for every gap index, plus a one or two sentence summary_text."
)


class GeminiExplainer:
    def __init__(self, api_key: str | None = None, model: str = "gemini-3.5-flash", timeout_s: float = 40.0,
                 client: Any = None):
        self.model = model
        self.timeout_s = timeout_s
        self._client = client
        self._api_key = api_key
        self._fallback = TemplateExplainer()

    def _client_or_create(self) -> Any:
        if self._client is None:
            from google import genai

            if not self._api_key:
                raise RuntimeError("GEMINI_API_KEY is not set")
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    def explain(self, status: str, results: list[RuleResult], gaps: list[Gap]) -> Explanation:
        base = self._fallback.explain(status, results, gaps)
        if not gaps:
            return base  # 全绿：不用调模型
        started = time.monotonic()
        try:
            from google.genai import types

            payload = {
                "plot_status": status,
                "rules": [{"ruleCode": r.rule_code, "docType": r.doc_type, "result": r.result,
                           "expected": r.expected_value, "actual": r.actual_value} for r in results],
                "gaps": [{"index": i, "gapCode": g.gap_code, "severity": g.severity, "docType": g.doc_type}
                         for i, g in enumerate(gaps)],
            }
            response = generate_with_retry(
                self._client_or_create(), model=self.model, contents=json.dumps(payload, ensure_ascii=False),
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM, response_mime_type="application/json", response_schema=_Explanation,
                    temperature=0.2,
                    http_options=types.HttpOptions(
                        timeout=int(self.timeout_s * 1000),
                        retry_options=types.HttpRetryOptions(attempts=3, http_status_codes=[500, 502, 503, 504]))))
            parsed = _Explanation.model_validate(json.loads(response.text))
        except (ValidationError, json.JSONDecodeError, TypeError) as exc:
            base.fallback_reason = f"unusable answer: {exc}"
            return base
        except Exception as exc:
            base.fallback_reason = f"{type(exc).__name__}: {exc}"
            return base
        out = copy.deepcopy(gaps)
        for item in parsed.gaps:
            if 0 <= item.index < len(out):
                if item.description.strip():
                    out[item.index].description = item.description.strip()[:MAX_TEXT]
                if item.suggested_action.strip():
                    out[item.index].suggested_action = item.suggested_action.strip()[:MAX_TEXT]
        usage = getattr(response, "usage_metadata", None)
        return Explanation(
            summary_text=parsed.summary_text.strip()[:MAX_TEXT] or base.summary_text, summary_lang="ms", gaps=out,
            model=self.model, seconds=round(time.monotonic() - started, 2),
            usage={"promptTokens": int(getattr(usage, "prompt_token_count", 0) or 0),
                   "outputTokens": int(getattr(usage, "candidates_token_count", 0) or 0)})
