import base64
import importlib
import io
import json
import struct
import wave
from pathlib import Path
from unittest.mock import Mock

import pytest


def load(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "scripts"))
    return importlib.import_module("sip_conversation")


def test_live_capture_reads_data_even_before_riff_sizes_are_final(monkeypatch, tmp_path):
    caller = load(monkeypatch)
    path = tmp_path / "dump-test-dec.wav"
    caller.write_wav(path, b"")
    incoming = caller.Incoming(tmp_path)
    assert incoming.read() == b""
    with path.open("ab") as handle:
        handle.write(b"\x02\x01" * 100)
    assert incoming.read() == b"\x02\x01" * 100
    assert not incoming.read()


def test_turn_detector_waits_for_silence_and_ignores_clicks(monkeypatch):
    caller = load(monkeypatch)
    detector = caller.TurnDetector()
    voice = struct.pack("<h", 1200) * (caller.FRAME_BYTES // 2)
    quiet = bytes(caller.FRAME_BYTES)
    assert detector.feed(voice * 2 + quiet * 60) == []
    assert detector.feed(voice[:21]) == []
    assert detector.feed(voice[21:] + voice * 8 + quiet * 59) == []
    assert detector.feed(quiet) == [voice * 9]


def test_converse_uses_heard_audio_to_generate_and_play_response(monkeypatch, tmp_path):
    caller = load(monkeypatch)
    voice = struct.pack("<h", 1200) * (caller.FRAME_BYTES // 2) * 9
    capture = Mock()
    capture.read.side_effect = [b"", voice + bytes(caller.FRAME_BYTES * 60)]
    monkeypatch.setattr(caller, "Incoming", Mock(return_value=capture))
    client = Mock()
    clock = Mock()
    clock.monotonic.return_value = 100
    monkeypatch.setattr(caller, "time", clock)

    def send(command):
        if command == "/ausrc aufile,silence.wav\n":
            clock.monotonic.return_value = 280

    client.send.side_effect = send
    timer = Mock()
    monkeypatch.setattr(caller, "Timer", timer)
    gemini = Mock()
    gemini.respond.return_value = {"heard": "What do you like?", "reply": "I like dogs."}
    gemini.speak.return_value = voice
    log = io.StringIO()
    caller.converse(client, gemini, tmp_path, "child", "test.invalid", 180, log)
    assert gemini.respond.call_args.args[:2] == (voice, "child")
    assert gemini.speak.call_args.args[0] == "I like dogs."
    assert gemini.respond.call_args.args[-1] == 280
    assert timer.call_args.args[0] == 180
    timer.return_value.cancel.assert_called_once()
    assert [call.args[0] for call in client.send.call_args_list] == [
        "/dial sip:0765673575@test.invalid;transport=udp\n", "1",
        "/ausrc aufile,turn-1.wav\n", "/ausrc aufile,silence.wav\n",
    ]
    assert json.loads(log.getvalue())["spoken"] == "I like dogs."


@pytest.mark.parametrize("wrapped", [False, True])
def test_gemini_sends_audio_to_flash_and_plain_reply_to_tts(monkeypatch, wrapped):
    caller = load(monkeypatch)
    gemini = caller.Gemini("test-key")
    audio = struct.pack("<6h", 1, 2, 5, 4, 6, 8)
    mime_type = "audio/L16;codec=pcm;rate=24000"
    if wrapped:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
            wav.writeframes(audio)
        audio = buffer.getvalue()
        mime_type = "audio/wav"
    gemini.request = Mock(side_effect=[
        [{"text": '{"heard":"Hello!","reply":"Hi."}'}],
        [{"inlineData": {
            "mimeType": mime_type,
            "data": base64.b64encode(audio).decode(),
        }}],
    ])
    assert gemini.respond(bytes(320), "child", [], 1000) == {"heard": "Hello!", "reply": "Hi."}
    stt_model, stt_parts, *_ = gemini.request.call_args.args
    assert stt_model == "gemini-3.1-flash-lite"
    assert "9-year-old" in stt_parts[0]["text"]
    assert stt_parts[1]["inlineData"]["mimeType"] == "audio/wav"
    assert gemini.speak("Hi.", 1000) == struct.pack("<hh", 2, 6)
    assert gemini.request.call_args.args[:2] == ("gemini-3.8-flash-tts", [{"text": "Hi."}])
