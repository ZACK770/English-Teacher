from __future__ import annotations

import json
from dataclasses import dataclass


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class StartFrame:
    call_id: str
    caller: str
    channel_id: str
    sample_rate: int
    channels: int


def _format_parts(value: str) -> dict[str, str]:
    parts: dict[str, str] = {}
    chunks = value.replace(",", ";").split(";")
    if chunks and "=" not in chunks[0]:
        parts["codec"] = chunks.pop(0).strip().lower()
    for item in chunks:
        key, separator, raw = item.partition("=")
        if separator:
            parts[key.strip().lower()] = raw.strip().lower()
    return parts


def parse_start_frame(raw: str, expected_channel_id: str) -> StartFrame:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError("first frame must be JSON") from exc
    if not isinstance(payload, dict) or payload.get("type") != "start":
        raise ProtocolError("first frame must have type=start")
    if str(payload.get("token", "")) != expected_channel_id:
        raise ProtocolError("channel id mismatch")

    format_parts = _format_parts(str(payload.get("format", "")))
    if format_parts.get("codec") != "pcm16":
        raise ProtocolError("only pcm16 is supported")
    try:
        rate = int(format_parts.get("rate", "0"))
        channels = int(format_parts.get("ch", "0"))
    except ValueError as exc:
        raise ProtocolError("invalid audio format") from exc
    if rate != 8000 or channels != 1:
        raise ProtocolError("expected mono pcm16 at 8000 Hz")

    call_id = str(payload.get("callId", "")).strip()
    if not call_id or len(call_id) > 200:
        raise ProtocolError("missing or invalid callId")
    return StartFrame(
        call_id=call_id,
        caller=str(payload.get("caller", ""))[:64],
        channel_id=expected_channel_id,
        sample_rate=rate,
        channels=channels,
    )


def clear_command() -> str:
    return json.dumps({"type": "clear"}, separators=(",", ":"))


def hangup_command() -> str:
    return json.dumps({"type": "hangup"}, separators=(",", ":"))


def transfer_command(target: str) -> str:
    if not target.startswith("/"):
        raise ValueError("Technoline transfer target must begin with /")
    return json.dumps({"type": "transfer_extension", "target": target}, separators=(",", ":"))
