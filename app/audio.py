from __future__ import annotations

import array
import struct


def _samples(data: bytes) -> array.array:
    values = array.array("h")
    values.frombytes(data[: len(data) - (len(data) % 2)])
    return values


def upsample_8k_to_16k(data: bytes) -> bytes:
    """Convert PBX audio to Gemini input with cheap linear interpolation."""
    source = _samples(data)
    if not source:
        return b""
    output = array.array("h", bytes(4 * len(source)))
    previous = source[0]
    for index, sample in enumerate(source):
        output[index * 2] = (previous + sample) // 2
        output[index * 2 + 1] = sample
        previous = sample
    return output.tobytes()


def downsample_24k_to_8k(data: bytes, carry: bytes = b"") -> tuple[bytes, bytes]:
    """Convert Gemini output to PBX audio without losing chunk-boundary samples."""
    source = _samples(carry + data)
    usable = len(source) - (len(source) % 3)
    output = array.array("h", bytes(2 * (usable // 3)))
    for index in range(0, usable, 3):
        output[index // 3] = (source[index] + source[index + 1] + source[index + 2]) // 3
    return output.tobytes(), source[usable:].tobytes()


def rms(data: bytes) -> float:
    source = _samples(data)
    return (sum(sample * sample for sample in source) / len(source)) ** 0.5 if source else 0.0


def resample_pcm16le(data: bytes, source_rate: int, target_rate: int) -> bytes:
    """Resample mono signed PCM16LE with linear interpolation.

    Telephone speech does not need studio-grade filtering, but it does require
    correct sample timing. The function is deterministic and keeps endpoints.
    """
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("sample rates must be positive")
    if len(data) % 2:
        raise ValueError("PCM16 data must contain complete samples")
    if source_rate == target_rate or not data:
        return data

    count = len(data) // 2
    samples = struct.unpack(f"<{count}h", data)
    if count == 1:
        output_count = max(1, round(target_rate / source_rate))
        return struct.pack(f"<{output_count}h", *([samples[0]] * output_count))

    output_count = max(1, round(count * target_rate / source_rate))
    scale = source_rate / target_rate
    result: list[int] = []
    for output_index in range(output_count):
        position = min(output_index * scale, count - 1)
        left = int(position)
        right = min(left + 1, count - 1)
        fraction = position - left
        value = round(samples[left] + (samples[right] - samples[left]) * fraction)
        result.append(max(-32768, min(32767, value)))
    return struct.pack(f"<{len(result)}h", *result)
