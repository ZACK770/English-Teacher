import importlib.util
import io
import math
import struct
import sys
import wave
from pathlib import Path
from unittest.mock import Mock

import pytest

script = Path(__file__).resolve().parents[1] / "scripts" / "technoline_test_caller.py"
spec = importlib.util.spec_from_file_location("technoline_test_caller", script)
caller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caller)


def test_wav_contains_two_repetitions_of_both_dtmf_frequencies():
    with wave.open(io.BytesIO(caller.tone_wav("2")), "rb") as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        frames = wav.readframes(wav.getnframes())
    signal = [sample for (sample,) in struct.iter_unpack("<h", frames)]
    assert len(signal) == 67200
    assert not any(signal[:48000])
    for offset in (48000, 57600):
        tone = signal[offset:offset + 4800]
        for frequency in (697, 1336):
            power = sum(sample * math.sin(math.tau * i * frequency / 16000)
                        for i, sample in enumerate(tone))
            assert power / len(tone) > 3000
        assert not any(signal[offset + 4800:offset + 9600])


def test_campaign_upload_has_one_fixed_target_and_no_retries(monkeypatch):
    tech = Mock()
    monkeypatch.setattr(caller, "tech", tech)
    caller.run_campaign("fake", b"wav", demo=True)
    caller.run_campaign("fake", b"wav", demo=False)
    demo, live = (call.kwargs for call in tech.call_args_list)
    assert demo["data"]["demo"] == "yes"
    assert "demo" not in live["data"]
    assert demo["data"]["externalID"] != live["data"]["externalID"]
    for upload in (demo, live):
        assert upload["data"]["phones"] == "0765673575"
        assert upload["data"]["dialRetries"] == "0"
        assert upload["data"]["messagesType"] == "audioFile"
        assert upload["data"]["runType"] == "hold"
        assert upload["files"]["audioFile"] == ("dtmf.wav", b"wav", "audio/wav")


def test_default_mode_validates_without_dialing(monkeypatch):
    monkeypatch.setattr(sys, "argv", [str(script)])
    monkeypatch.setenv("TLIVR_SYSTEM_API_KEY", "fake")
    monkeypatch.setattr(caller, "check_route", Mock())
    upload = Mock(return_value={"campaignId": "demo", "errorCode": 0, "phones": 1, "billing": 1})
    monkeypatch.setattr(caller, "run_campaign", upload)
    live = Mock()
    monkeypatch.setattr(caller, "live_check", live)
    assert caller.main() == 0
    assert upload.call_args.kwargs == {"demo": True}
    live.assert_not_called()


def test_no_resumption_when_provider_reports_retries(monkeypatch):
    monkeypatch.setattr(caller, "worker_event", Mock())
    monkeypatch.setattr(caller, "run_campaign", Mock(return_value={
        "errorCode": 0, "campaignId": 123,
    }))
    campaign = Mock(return_value={"campaign": {"dialRetries": "1"}})
    monkeypatch.setattr(caller, "campaign", campaign)
    with pytest.raises(caller.CheckError, match="dialRetries=1; held campaign was not resumed"):
        caller.live_check("fake", "fake", b"wav")
    campaign.assert_called_once_with("fake", "campaignReport", campaignId="123")


def test_held_report_identifies_undialed_target_from_row():
    report = {
        "campaign": {"dialRetries": "0", "recipients": "", "callId": "076-5674688"},
        "calls": [{"phone": "076-5673575", "status": "NEW", "retries": "0"}],
    }
    caller.check_held_report(report)
    report["calls"][0]["phone"] = "076-5673576"
    with pytest.raises(caller.CheckError, match="one undialed target"):
        caller.check_held_report(report)
