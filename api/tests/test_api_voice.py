"""POST /api/plots/{id}/voice：校验音频、只按这块地的检查结果问答、别人的地不行、没配模型回 503。"""
import base64

import pytest
from fastapi.testclient import TestClient

from api_helpers import bearer
from app.main import create_app
from worker.voice import VoiceAnswer, VoiceError


class FakeVoice:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    def answer(self, audio, mime_type, lang, facts):
        self.calls.append({"audio": audio, "mime": mime_type, "lang": lang, "facts": facts})
        if self.error:
            raise self.error
        return VoiceAnswer(transcript="kenapa tanah saya kuning", answer="Keluasan tidak sepadan dengan geran.", model="m")


WAV = base64.b64encode(b"RIFF" + b"\x00" * 4000).decode()


def _plot(client, uid="smallholder-1"):
    return client.post("/api/plots", headers=bearer(uid), json={}).json()["plotId"]


def _client(make_deps, voice):
    return TestClient(create_app(make_deps(voice=voice)))


def _ask(client, pid, uid="smallholder-1", **over):
    body = {"audio": WAV, "mimeType": "audio/wav", "lang": "ms", **over}
    return client.post(f"/api/plots/{pid}/voice", headers=bearer(uid), json=body)


def test_answers_with_transcript_and_uses_the_latest_finished_assessment(make_deps, store):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    pid = _plot(client)
    store.update(f"plots/{pid}", {"areaHaComputed": 3.1})
    store.set(f"plots/{pid}/assessments/old", {"runStatus": "done", "result": "green", "createdAt": "2026-10-01T00:00:00Z",
                                                "ruleResults": [], "gaps": []})
    store.set(f"plots/{pid}/assessments/new", {
        "runStatus": "done", "result": "yellow", "createdAt": "2026-10-17T00:00:00Z", "forestRisk": "low",
        "ruleResults": [{"ruleCode": "CC-01", "docType": None, "result": "warn", "expectedValue": "3.04 ha",
                         "actualValue": "3.10 ha", "detail": "TAN AH KOW luas"}],
        "gaps": [{"gapCode": "area_mismatch", "severity": "medium", "docType": "land_title", "status": "open",
                  "description": "TAN AH KOW punya tanah"},
                 {"gapCode": "expired", "severity": "high", "docType": "mpob_licence", "status": "resolved"}]})
    r = _ask(client, pid)
    assert r.status_code == 200
    assert r.json() == {"transcript": "kenapa tanah saya kuning", "answer": "Keluasan tidak sepadan dengan geran.", "lang": "ms"}
    call = voice.calls[0]
    assert call["mime"] == "audio/wav" and call["lang"] == "ms" and len(call["audio"]) > 2000
    facts = call["facts"]
    assert facts["checked"] is True and facts["overall"] == "yellow" and facts["areaHa"] == 3.1
    assert [g["gapCode"] for g in facts["openGaps"]] == ["area_mismatch"]  # 已解决的不给模型
    assert "TAN AH KOW" not in str(facts)  # 姓名不进提示


def test_plot_not_checked_yet_is_told_to_the_model(make_deps):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    assert _ask(client, _plot(client), lang="en").status_code == 200
    assert voice.calls[0]["facts"]["checked"] is False and voice.calls[0]["lang"] == "en"


def test_mime_with_codecs_suffix_is_accepted(make_deps):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    assert _ask(client, _plot(client), mimeType="audio/wav; codecs=1").status_code == 200
    assert voice.calls[0]["mime"] == "audio/wav"


@pytest.mark.parametrize("over,status,code", [
    ({"mimeType": "video/mp4"}, 422, "unsupported_audio"),
    ({"mimeType": "audio/webm"}, 422, "unsupported_audio"),
    ({"audio": "###not base64###"}, 422, "invalid_audio"),
    ({"audio": base64.b64encode(b"tiny").decode()}, 422, "audio_too_short"),
    ({"audio": base64.b64encode(b"\x00" * 1_600_000).decode()}, 413, "audio_too_long"),
    ({"lang": "zh"}, 422, "invalid_request"),
])
def test_bad_audio_is_rejected_before_calling_the_model(make_deps, over, status, code):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    r = _ask(client, _plot(client), **over)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert voice.calls == []


def test_someone_elses_plot_and_no_token(make_deps):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    pid = _plot(client)
    assert _ask(client, pid, uid="smallholder-2").status_code == 403
    assert client.post(f"/api/plots/{pid}/voice", json={"audio": WAV, "mimeType": "audio/wav"}).status_code == 401
    assert _ask(client, "nope").status_code == 404
    assert voice.calls == []


def test_model_failure_is_502_and_missing_model_is_503(make_deps):
    client = _client(make_deps, FakeVoice(error=VoiceError("quota")))
    r = _ask(client, _plot(client))
    assert r.status_code == 502 and r.json()["error"]["code"] == "voice_failed"

    client = _client(make_deps, None)
    r = _ask(client, _plot(client))
    assert r.status_code == 503 and r.json()["error"]["code"] == "voice_unavailable"
