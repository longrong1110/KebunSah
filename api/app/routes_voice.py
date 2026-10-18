"""POST /api/plots/{id}/voice：园主说一句话（音频，base64），回「听到了什么」和一两句回答（文字，手机负责读出来）。

音频只用于这一次调用，不存。音频格式只收 Gemini 明确支持的几种；前端统一转成 16 kHz 单声道 WAV 再传。
"""
from __future__ import annotations

import base64
import binascii
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from worker.voice import VoiceError, build_facts

from .access import load_plot
from .auth import User, get_user
from .deps import Deps, get_deps
from .errors import ApiError

router = APIRouter()

ALLOWED_MIME = {"audio/wav", "audio/x-wav", "audio/mp3", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac", "audio/aiff"}
MIN_BYTES = 2_000  # 不到这么点基本是没录上
MAX_BYTES = 1_500_000  # 16 kHz 单声道 16 位 WAV 约 32 KB/秒：约 45 秒


class VoiceQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")
    audio: str
    mimeType: str
    lang: Literal["ms", "en"] = "ms"


def _latest_assessment(deps: Deps, plot_id: str) -> dict | None:
    rows = deps.store.list(f"plots/{plot_id}/assessments")
    if not rows:
        return None
    return max((row for _, row in rows), key=lambda r: str(r.get("createdAt") or ""))


@router.post("/api/plots/{plot_id}/voice")
def ask_by_voice(plot_id: str, body: VoiceQuestion, user: User = Depends(get_user), deps: Deps = Depends(get_deps)):
    plot = load_plot(deps.store, user, plot_id)
    if deps.voice is None:
        raise ApiError(503, "voice_unavailable", "voice answers are not configured on this server")
    mime = body.mimeType.split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise ApiError(422, "unsupported_audio", f"audio type {mime or '(none)'} is not supported; send WAV")
    try:
        audio = base64.b64decode(body.audio, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, "invalid_audio", "audio is not valid base64") from None
    if len(audio) < MIN_BYTES:
        raise ApiError(422, "audio_too_short", "no speech was recorded")
    if len(audio) > MAX_BYTES:
        raise ApiError(413, "audio_too_long", "the recording is too long; keep it under 40 seconds")
    facts = build_facts(plot, _latest_assessment(deps, plot_id))
    try:
        out = deps.voice.answer(audio, mime, body.lang, facts)
    except VoiceError as exc:
        raise ApiError(502, "voice_failed", f"could not answer: {exc}") from None
    return {"transcript": out.transcript, "answer": out.answer, "lang": body.lang}
