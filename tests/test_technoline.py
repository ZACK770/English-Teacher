import json

import pytest

from app.technoline import ProtocolError, parse_start_frame, transfer_command

CHANNEL = "2614d922d06b4f"


def start(**overrides: object) -> str:
    payload = {
        "type": "start",
        "callId": "call-123",
        "caller": "0500000000",
        "token": CHANNEL,
        "format": "pcm16;rate=8000;ch=1",
    }
    payload.update(overrides)
    return json.dumps(payload)


def test_parses_measured_start_frame() -> None:
    frame = parse_start_frame(start(), CHANNEL)
    assert frame.call_id == "call-123"
    assert frame.sample_rate == 8000


@pytest.mark.parametrize(
    "raw",
    [
        start(token="wrong"),
        start(format="pcm16;rate=16000;ch=1"),
        start(format="pcmu;rate=8000;ch=1"),
        json.dumps({"type": "media"}),
    ],
)
def test_rejects_unverified_variants(raw: str) -> None:
    with pytest.raises(ProtocolError):
        parse_start_frame(raw, CHANNEL)


def test_transfer_requires_absolute_extension() -> None:
    assert json.loads(transfer_command("/200")) == {
        "type": "transfer_extension",
        "target": "/200",
    }
    with pytest.raises(ValueError):
        transfer_command("200")
