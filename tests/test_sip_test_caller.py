import importlib.util
import sys
import wave
from pathlib import Path
from unittest.mock import Mock

import pytest

script = Path(__file__).resolve().parents[1] / "scripts" / "sip_test_caller.py"
spec = importlib.util.spec_from_file_location("sip_test_caller", script)
caller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caller)


@pytest.mark.parametrize("number", ["0527180504", "+972-52-7180504", "00972527180504"])
def test_private_number_is_blocked_in_each_format(number):
    with pytest.raises(caller.CallError, match="not allowed"):
        caller.target_number(number)


def test_prepare_steps_stages_speech_and_validates_timing(tmp_path):
    speech = tmp_path / "speech with spaces.wav"
    speech_audio = b"\x10\x00" * 8000
    caller.write_wav(speech, speech_audio)
    steps = caller.prepare_steps(tmp_path, ["wait:2", "keys:2#", f"play:{speech}"], 8)
    assert steps == [("wait", "2", 2), ("keys", "2#", 0.7), ("play", "play-2.wav", 1)]
    with wave.open(str(tmp_path / "play-2.wav"), "rb") as wav:
        assert wav.readframes(8000) == speech_audio
        assert wav.readframes(wav.getnframes()) == bytes(42400 * 2)
    with pytest.raises(caller.CallError, match="exceed"):
        caller.prepare_steps(tmp_path, ["wait:4"], 2)
    with pytest.raises(caller.CallError, match="finite"):
        caller.prepare_steps(tmp_path, ["wait:nan"], 2)


def test_call_sends_one_dial_then_keys_and_speech():
    client = Mock()
    steps = [("wait", "2", 2), ("keys", "2#", 0.7), ("play", "play-2.wav", 1)]
    assert caller.execute_call(client, "0765673575", "test.invalid", steps, 10) == 3
    assert [call.args[0] for call in client.send.call_args_list] == [
        "/dial sip:0765673575@test.invalid;transport=udp\n", "2", "#",
        "/ausrc aufile,play-2.wav\n", "/ausrc aufile,silence.wav\n",
    ]


def test_register_only_never_sends_a_command(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", [str(script), "--register-only"])
    monkeypatch.setattr(caller.shutil, "which", Mock(return_value="baresip"))
    for module in caller.REQUIRED_MODULES:
        (tmp_path / f"{module}.so").touch()
    monkeypatch.setenv("BARESIP_MODULE_PATH", str(tmp_path))
    monkeypatch.setattr(caller, "credentials", Mock(return_value=("000=0", "test", "test.invalid")))
    client = Mock()
    backend = Mock(return_value=client)
    monkeypatch.setattr(caller, "Baresip", backend)
    assert caller.main() == 0
    assert client.observe.call_args.args[1] == b"registered successfully"
    client.send.assert_not_called()
    client.close.assert_called_once()
    assert not backend.call_args.args[1].exists()


def test_save_recording_only_exports_received_audio_and_does_not_overwrite(tmp_path):
    received = tmp_path / "dump-call-dec.wav"
    caller.write_wav(received, b"\x10\x00" * 10)
    caller.write_wav(tmp_path / "dump-call-enc.wav", b"\x20\x00" * 10)
    output = tmp_path / "recording.wav"
    caller.save_recording(tmp_path, output)
    assert output.read_bytes() == received.read_bytes()
    with pytest.raises(FileExistsError):
        caller.save_recording(tmp_path, output)
