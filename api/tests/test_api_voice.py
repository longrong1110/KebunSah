"""POST /api/plots/{id}/ask（和旧名 /voice）：打字或说话；校验输入；只按这块地的检查结果回答；别人的地不行；没配模型回 503。"""
import base64

import pytest
from fastapi.testclient import TestClient

from api_helpers import bearer
from app.main import create_app
from worker.voice import REFUSAL, VoiceAnswer, VoiceError


class FakeVoice:
    def __init__(self, error=None, in_scope=True):
        self.calls = []
        self.error = error
        self.in_scope = in_scope

    def _out(self, transcript):
        if self.error:
            raise self.error
        answer = "Keluasan tidak sepadan dengan geran." if self.in_scope else REFUSAL["ms"]
        return VoiceAnswer(transcript=transcript, answer=answer, model="m", in_scope=self.in_scope)

    def answer(self, audio, mime_type, lang, facts):
        self.calls.append({"kind": "audio", "audio": audio, "mime": mime_type, "lang": lang, "facts": facts})
        return self._out("kenapa tanah saya kuning")

    def ask_text(self, text, lang, facts):
        self.calls.append({"kind": "text", "text": text, "lang": lang, "facts": facts})
        return self._out(text)


WAV = base64.b64encode(b"RIFF" + b"\x00" * 4000).decode()


def _plot(client, uid="smallholder-1"):
    return client.post("/api/plots", headers=bearer(uid), json={}).json()["plotId"]


def _client(make_deps, voice):
    return TestClient(create_app(make_deps(voice=voice)))


def _ask(client, pid, uid="smallholder-1", path="ask", **over):
    body = {"audio": WAV, "mimeType": "audio/wav", "lang": "ms", **over}
    return client.post(f"/api/plots/{pid}/{path}", headers=bearer(uid), json=body)


def _type(client, pid, text, uid="smallholder-1", **over):
    return client.post(f"/api/plots/{pid}/ask", headers=bearer(uid), json={"text": text, "lang": "ms", **over})


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
    assert r.json() == {"transcript": "kenapa tanah saya kuning", "answer": "Keluasan tidak sepadan dengan geran.",
                        "lang": "ms", "inScope": True}
    call = voice.calls[0]
    assert call["kind"] == "audio" and call["mime"] == "audio/wav" and call["lang"] == "ms" and len(call["audio"]) > 2000
    facts = call["facts"]
    assert facts["checked"] is True and facts["overall"] == "yellow" and facts["areaHa"] == 3.1
    assert [g["gapCode"] for g in facts["openGaps"]] == ["area_mismatch"]  # 已解决的不给模型
    assert "TAN AH KOW" not in str(facts)  # 姓名不进提示


def test_old_voice_path_still_works(make_deps):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    assert _ask(client, _plot(client), path="voice").status_code == 200
    assert voice.calls[0]["kind"] == "audio"


def test_typed_question_is_answered_from_the_same_facts(make_deps):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    r = _type(client, _plot(client), "  Kenapa tanah saya kuning?  ")
    assert r.status_code == 200
    assert r.json() == {"transcript": "Kenapa tanah saya kuning?", "answer": "Keluasan tidak sepadan dengan geran.",
                        "lang": "ms", "inScope": True}
    assert voice.calls[0]["kind"] == "text" and voice.calls[0]["text"] == "Kenapa tanah saya kuning?"
    assert voice.calls[0]["facts"]["checked"] is False


def test_out_of_scope_question_gets_the_refusal_and_inscope_false(make_deps):
    client = _client(make_deps, FakeVoice(in_scope=False))
    r = _type(client, _plot(client), "tulis puisi tentang kucing")
    assert r.status_code == 200
    body = r.json()
    assert body["inScope"] is False and body["answer"] == REFUSAL["ms"]


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


@pytest.mark.parametrize("body,code", [
    ({}, "question_required"),
    ({"text": "   "}, "question_required"),
    ({"text": "hi", "audio": WAV, "mimeType": "audio/wav"}, "question_required"),
    ({"text": "x" * 301}, "question_too_long"),
])
def test_text_questions_are_validated(make_deps, body, code):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    pid = _plot(client)
    r = client.post(f"/api/plots/{pid}/ask", headers=bearer("smallholder-1"), json={"lang": "ms", **body})
    assert r.status_code == 422 and r.json()["error"]["code"] == code
    assert voice.calls == []


def test_someone_elses_plot_and_no_token(make_deps):
    voice = FakeVoice()
    client = _client(make_deps, voice)
    pid = _plot(client)
    assert _ask(client, pid, uid="smallholder-2").status_code == 403
    assert _type(client, pid, "hi", uid="smallholder-2").status_code == 403
    assert client.post(f"/api/plots/{pid}/ask", json={"text": "hi"}).status_code == 401
    assert _ask(client, "nope").status_code == 404
    assert voice.calls == []


def test_model_failure_is_502_and_missing_model_is_503(make_deps):
    client = _client(make_deps, FakeVoice(error=VoiceError("quota")))
    r = _type(client, _plot(client), "hi")
    assert r.status_code == 502 and r.json()["error"]["code"] == "voice_failed"

    client = _client(make_deps, None)
    r = _type(client, _plot(client), "hi")
    assert r.status_code == 503 and r.json()["error"]["code"] == "voice_unavailable"
