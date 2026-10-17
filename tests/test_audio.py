import struct

import pytest

from app.audio import downsample_24k_to_8k, resample_pcm16le, upsample_8k_to_16k


def samples(data: bytes) -> tuple[int, ...]:
    return struct.unpack(f"<{len(data) // 2}h", data)


def test_upsample_8k_to_24k_preserves_duration_and_endpoints() -> None:
    source = struct.pack("<4h", -1000, 0, 1000, 2000)
    output = resample_pcm16le(source, 8000, 24000)
    assert len(output) == len(source) * 3
    assert samples(output)[0] == -1000
    assert samples(output)[-1] == 2000


def test_downsample_24k_to_8k_has_one_third_samples() -> None:
    source = struct.pack("<12h", *range(12))
    assert len(resample_pcm16le(source, 24000, 8000)) == 8


def test_rejects_half_pcm_sample() -> None:
    with pytest.raises(ValueError, match="complete samples"):
        resample_pcm16le(b"\x00", 8000, 24000)


def test_gemini_streaming_resampler_keeps_remainder() -> None:
    source = struct.pack("<5h", 3, 6, 9, 12, 15)
    first, carry = downsample_24k_to_8k(source, b"")
    assert samples(first) == (6,)
    second, carry = downsample_24k_to_8k(struct.pack("<h", 18), carry)
    assert samples(second) == (15,)
    assert carry == b""


def test_8k_to_16k_doubles_sample_count() -> None:
    source = struct.pack("<4h", 100, 200, 300, 400)
    assert len(upsample_8k_to_16k(source)) == len(source) * 2
