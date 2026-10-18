import json
from types import SimpleNamespace

import pytest

from worker.voice import GeminiVoice, VoiceError, build_facts


class FakeClient:
    def __init__(self, text=None, error=None):
        self.calls = []
        self.models = SimpleNamespace(generate_content=self._call)
        self._text, self._error = text, error

    def _call(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return SimpleNamespace(text=self._text, usage_metadata=None)


def _reply(transcript="kenapa kuning", answer="Sebab luas tidak sepadan."):
    return json.dumps({"transcript": transcript, "answer": answer})


def test_voice_sends_audio_and_facts_and_trims_the_answer():
    client = FakeClient(_reply(answer="x" * 900))
    out = GeminiVoice(model="m", client=client).answer(b"RIFFdata", "audio/wav", "ms", {"checked": True, "overall": "yellow"})
    assert out.model == "m" and out.transcript == "kenapa kuning" and len(out.answer) == 420
    sent = client.calls[0]
    assert sent["model"] == "m" and "DATA" in sent["config"].system_instruction
    assert "Bahasa Malaysia" in sent["contents"][1] and '"overall": "yellow"' in sent["contents"][1]
    assert sent["contents"][0].inline_data.mime_type == "audio/wav"


def test_voice_asks_for_english_when_the_user_chose_english():
    client = FakeClient(_reply())
    GeminiVoice(client=client).answer(b"x", "audio/wav", "en", {})
    assert "English" in client.calls[0]["contents"][1]


@pytest.mark.parametrize("client", [
    FakeClient("not json"), FakeClient("{}"), FakeClient(_reply(answer="  ")), FakeClient(error=RuntimeError("boom"))])
def test_voice_failures_become_voice_error(client):
    with pytest.raises(VoiceError):
        GeminiVoice(client=client).answer(b"x", "audio/wav", "ms", {})


def test_build_facts_shapes():
    plot = {"areaHaComputed": None, "areaHaDeclared": 2.5}
    assert build_facts(plot, None) == {"checked": False, "areaHa": 2.5}
    assert build_facts(plot, {"runStatus": "running"}) == {"checked": False, "areaHa": 2.5}
    facts = build_facts(plot, {"runStatus": "done", "result": "red", "forestRisk": "high",
                               "gaps": [{"gapCode": "expired", "severity": "high", "docType": "mpob_licence"}]})
    assert facts["openGaps"] == [{"gapCode": "expired", "severity": "high", "docType": "mpob_licence"}]  # 没写 status 按没解决
    assert facts["forestScreening"] == {"risk": "high", "preliminaryOnly": True}
