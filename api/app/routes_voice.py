"""POST /api/plots/{id}/ask（旧名 /voice 也留着）：问一句话，打字或说话都行，回「听到／看到了什么」和一两句回答。

只回答和这块地的检查、EUDR 规定、需要的文件、怎么用 KebunSah 有关的问题；别的问题回固定的拒绝语（inScope 为 false）。
文字最长 300 字；音频只收 Gemini 明确支持的几种（前端统一转成 16 kHz 单声道 WAV），只用于这一次调用，不存。
"""
from __future__ import annotations

import base64
import binascii
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from worker.voice import MAX_TEXT, VoiceError, build_facts

from .access import load_plot
from .auth import User, get_user
from .deps import Deps, get_deps
from .errors import ApiError

router = APIRouter()

ALLOWED_MIME = {"audio/wav", "audio/x-wav", "audio/mp3", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac", "audio/aiff"}
MIN_BYTES = 2_000  # 不到这么点基本是没录上
MAX_BYTES = 1_500_000  # 16 kHz 单声道 16 位 WAV 约 32 KB/秒：约 45 秒


class Question(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str | None = None
    audio: str | None = None
    mimeType: str | None = None
    lang: Literal["ms", "en"] = "ms"


def _latest_assessment(deps: Deps, plot_id: str) -> dict | None:
    rows = deps.store.list(f"plots/{plot_id}/assessments")
    if not rows:
        return None
    return max((row for _, row in rows), key=lambda r: str(r.get("createdAt") or ""))


def _decode_audio(body: Question) -> tuple[bytes, str]:
    mime = (body.mimeType or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise ApiError(422, "unsupported_audio", f"audio type {mime or '(none)'} is not supported; send WAV")
    try:
        audio = base64.b64decode(body.audio or "", validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, "invalid_audio", "audio is not valid base64") from None
    if len(audio) < MIN_BYTES:
        raise ApiError(422, "audio_too_short", "no speech was recorded")
    if len(audio) > MAX_BYTES:
        raise ApiError(413, "audio_too_long", "the recording is too long; keep it under 40 seconds")
    return audio, mime


@router.post("/api/plots/{plot_id}/ask")
@router.post("/api/plots/{plot_id}/voice")
def ask(plot_id: str, body: Question, user: User = Depends(get_user), deps: Deps = Depends(get_deps)):
    plot = load_plot(deps.store, user, plot_id)
    if deps.voice is None:
        raise ApiError(503, "voice_unavailable", "answers are not configured on this server")
    typed = body.text is not None and body.text.strip() != ""
    spoken = body.audio is not None
    if typed == spoken:  # 两个都没有，或两个都有
        raise ApiError(422, "question_required", "send either text or audio")
    if typed and len(body.text.strip()) > MAX_TEXT:
        raise ApiError(422, "question_too_long", f"keep the question under {MAX_TEXT} characters")
    audio, mime = _decode_audio(body) if spoken else (b"", "")
    facts = build_facts(plot, _latest_assessment(deps, plot_id))
    try:
        out = deps.voice.answer(audio, mime, body.lang, facts) if spoken else deps.voice.ask_text(
            body.text.strip(), body.lang, facts)
    except VoiceError as exc:
        raise ApiError(502, "voice_failed", f"could not answer: {exc}") from None
    return {"transcript": out.transcript, "answer": out.answer, "lang": body.lang, "inScope": out.in_scope}
