"""Run one adaptive conversation QA call to the SpeakCall teacher."""

import argparse
import base64
import io
import json
import os
import re
import shutil
import struct
import tempfile
import time
import wave
from array import array
from pathlib import Path
from threading import Timer

import requests
from sip_test_caller import (
    DEFAULT_TARGET,
    RATE,
    REQUIRED_MODULES,
    Baresip,
    CallEnded,
    CallError,
    credentials,
    save_recording,
    write_config,
    write_wav,
)

PERSONAS = {
    "beginner": "Adult who understands Hebrew and speaks very basic, hesitant English.",
    "child": "A 9-year-old English learner; short concrete answers about school and hobbies.",
    "off-topic": "Keeps changing subject: ask about weather, football, and the tutor personally.",
    "buyer": "Interested customer asking for exact prices, packages and how to pay; never buy.",
    "advanced": "Fluent adult who wants a real discussion, not drills; raise an everyday debate.",
}
FRAME_BYTES = RATE * 2 // 50
SILENT_FRAMES = 60
MIN_VOICED_FRAMES = 8


class TurnDetector:
    def __init__(self):
        self.pending = b""
        self.frames = []
        self.voiced = 0
        self.quiet = 0

    def finish(self) -> bytes | None:
        turn = b"".join(self.frames[:len(self.frames) - self.quiet])
        voiced = self.voiced
        self.frames.clear()
        self.voiced = self.quiet = 0
        return turn if voiced >= MIN_VOICED_FRAMES else None

    def feed(self, data: bytes) -> list[bytes]:
        data = self.pending + data
        end = len(data) - len(data) % FRAME_BYTES
        self.pending = data[end:]
        turns = []
        for offset in range(0, end, FRAME_BYTES):
            frame = data[offset:offset + FRAME_BYTES]
            samples = array("h", frame)
            speech = sum(sample * sample for sample in samples) >= 280**2 * len(samples)
            if speech:
                self.voiced += 1
                self.quiet = 0
            elif self.frames:
                self.quiet += 1
            if speech or self.frames:
                self.frames.append(frame)
            if self.quiet >= SILENT_FRAMES:
                if turn := self.finish():
                    turns.append(turn)
        return turns


def wav_data_offset(file) -> int | None:
    file.seek(0)
    header = file.read(12)
    if len(header) != 12:
        return None
    if header[:4] != b"RIFF" or header[8:] != b"WAVE":
        raise CallError("Expected RIFF/WAVE capture.")
    while len(chunk := file.read(8)) == 8:
        tag, size = struct.unpack("<4sI", chunk)
        if tag == b"data":
            return file.tell()
        file.seek(size + size % 2, io.SEEK_CUR)
    return None


class Incoming:
    def __init__(self, directory: Path):
        self.directory = directory
        self.offset = None

    def read(self) -> bytes:
        capture = next(self.directory.glob("dump-*-dec.wav"), None)
        if capture is None:
            return b""
        with capture.open("rb") as file:
            if self.offset is None:
                self.offset = wav_data_offset(file)
            if self.offset is None:
                return b""
            file.seek(self.offset)
            new = file.read()
            self.offset += len(new)
            return new


def wave_base64(pcm: bytes) -> str:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    return base64.b64encode(buffer.getvalue()).decode()


class Gemini:
    def __init__(self, key: str):
        self.http = requests.Session()
        self.http.headers["x-goog-api-key"] = key

    def request(self, model: str, parts: list[dict], config: dict, deadline: float) -> list:
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            raise CallError("No time remaining for Gemini.")
        response = self.http.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            json={"contents": [{"parts": parts}], "generationConfig": config},
            timeout=(min(3, remaining / 3), min(15, remaining / 2)),
        )
        if response.status_code != 200:
            raise CallError(f"Gemini {model} HTTP {response.status_code}.")
        return response.json()["candidates"][0]["content"]["parts"]

    def respond(self, audio: bytes, persona: str, history: list, deadline: float) -> dict:
        prompt = (
            "Transcribe the attached recent phone audio verbatim in its original language; "
            "do not invent unclear words. Then optionally reply AS THE CALLER in one short "
            f"spoken line matching this persona: {PERSONAS[persona]} "
            "Answer what the teacher actually said, do not teach or imitate the teacher. "
            "Use an empty reply if audio is silence, hold music, a prerecorded menu, or noise. "
            "Never share personal contact, provide payment information, or authorize purchases. "
            'Return JSON with string keys "heard" and "reply". Recent turns: '
            + json.dumps(history[-6:], ensure_ascii=False)
        )
        parts = self.request(
            "gemini-3.1-flash-lite",
            [{"text": prompt}, {"inlineData": {
                "mimeType": "audio/wav", "data": wave_base64(audio),
            }}],
            {"responseMimeType": "application/json", "maxOutputTokens": 768,
             "thinkingConfig": {"thinkingLevel": "MINIMAL"},
             "responseSchema": {"type": "OBJECT", "required": ["heard", "reply"],
                                "properties": {"heard": {"type": "STRING"},
                                               "reply": {"type": "STRING"}}}},
            deadline,
        )
        result = json.loads(next(part["text"] for part in parts if "text" in part))
        return {key: str(result.get(key, "")).strip() for key in ("heard", "reply")}

    def speak(self, message: str, deadline: float) -> bytes:
        parts = self.request(
            "gemini-3.8-flash-tts", [{"text": message}],
            {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {
                "prebuiltVoiceConfig": {"voiceName": "Kore"},
            }}}, deadline,
        )
        part = next(part["inlineData"] for part in parts if "inlineData" in part)
        media_type = part["mimeType"].lower()
        audio = base64.b64decode(part["data"])
        if media_type.split(";", 1)[0] == "audio/wav":
            with wave.open(io.BytesIO(audio), "rb") as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                    raise CallError("Gemini WAV must be mono, signed 16-bit PCM.")
                sample_rate = wav.getframerate()
                audio = wav.readframes(wav.getnframes())
        else:
            match = re.search(r"(?:^|;)\s*rate=(\d+)", media_type)
            if not match or not media_type.startswith("audio/l16"):
                raise CallError("Gemini did not return signed 16-bit PCM audio.")
            sample_rate = int(match.group(1))
        samples = array("h", audio)
        factor, remainder = divmod(sample_rate, RATE)
        if remainder or factor < 1:
            raise CallError("TTS PCM sample rate cannot be reduced to 8 kHz.")
        return array("h", (sum(samples[i:i + factor]) // factor
                           for i in range(0, len(samples) - factor + 1, factor))).tobytes()


def converse(client, gemini, directory: Path, persona: str, host: str, duration: int, log) -> None:
    def hang_up() -> None:
        try:
            client.send("/hangup\n")
        except CallError:
            pass

    start = time.monotonic()
    timer = Timer(duration, hang_up)
    timer.start()
    try:
        client.send(f"/dial sip:{DEFAULT_TARGET}@{host};transport=udp\n")
        exchange_turns(client, gemini, directory, persona, start, start + duration, log)
    finally:
        timer.cancel()
        timer.join()


def exchange_turns(client, gemini, directory: Path, persona: str,
                   start: float, deadline: float, log) -> None:
    if not client.observe(min(deadline, time.monotonic() + 20), rb"Call established:"):
        raise CallError("Destination did not answer within 20 seconds.")
    print("SIP answered.", flush=True)
    client.observe(min(deadline, time.monotonic() + 4))
    incoming = Incoming(directory)
    incoming.read()
    if time.monotonic() >= deadline:
        return
    client.send("1")
    try:
        listen_and_reply(client, gemini, incoming, directory, persona, start, deadline, log)
    except CallEnded:
        print("SIP call ended.", flush=True)


def listen_and_reply(client, gemini, incoming: Incoming, directory: Path, persona: str,
                     start: float, deadline: float, log) -> None:
    detector = TurnDetector()
    history = []
    last_data = time.monotonic()
    while time.monotonic() < deadline:
        client.observe(min(deadline, time.monotonic() + 0.16))
        data = incoming.read()
        now = time.monotonic()
        if data:
            last_data = now
            turns = detector.feed(data)
        elif now - last_data > 1.2 and detector.frames:
            turn = detector.finish()
            turns = [turn] if turn else []
        else:
            turns = []
        for turn in turns:
            if time.monotonic() >= deadline - 1:
                return
            result = gemini.respond(turn, persona, history, deadline)
            record = {"seconds": round(now - start, 2), "heard": result["heard"], "spoken": ""}
            try:
                reply = result["reply"][:280]
                if reply and time.monotonic() < deadline - 4:
                    name = f"turn-{len(history) + 1}.wav"
                    if play_reply(client, directory, gemini.speak(reply, deadline), name, deadline):
                        record["spoken"] = reply
            finally:
                print(json.dumps(record, ensure_ascii=False), file=log, flush=True)
            history.append(record)
            print(
                f"Turn {len(history)}: heard={bool(record['heard'])}, "
                f"spoke={bool(record['spoken'])}", flush=True,
            )


def play_reply(client, directory: Path, audio: bytes, name: str, deadline: float) -> bool:
    playback_time = len(audio) / (RATE * 2)
    remaining = deadline - time.monotonic()
    if not audio or playback_time + 0.2 >= remaining:
        return False
    padding = (int(remaining) + 1) * RATE * 2
    write_wav(directory / name, audio.ljust(padding, b"\x00"))
    client.send(f"/ausrc aufile,{name}\n")
    pattern = rb"aufile: " + re.escape(name.encode()) + rb":[\s\S]*?aufile: loaded"
    if not client.observe(min(deadline, time.monotonic() + 4), pattern):
        raise CallError("Baresip did not open generated speech.")
    client.observe(min(deadline, time.monotonic() + playback_time + 0.12))
    if time.monotonic() < deadline:
        client.send("/ausrc aufile,silence.wav\n")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("persona", choices=PERSONAS)
    parser.add_argument("--output-dir", required=True, type=Path, help="A new directory per call.")
    parser.add_argument("--max-duration", type=int, default=180)
    args = parser.parse_args()
    if not 1 <= args.max_duration <= 200:
        parser.error("--max-duration must be between 1 and 200.")
    try:
        account = credentials()
        key = os.environ.get("GEMINI_API_KEY")
        executable = shutil.which("baresip")
        modules = Path(os.environ.get("BARESIP_MODULE_PATH", "/usr/lib/baresip/modules")).resolve()
        if not key:
            raise CallError("Set GEMINI_API_KEY before dialing.")
        if not executable or not all((modules / f"{m}.so").is_file() for m in REQUIRED_MODULES):
            raise CallError("Install baresip-core and its audio modules before dialing.")
        args.output_dir.mkdir(mode=0o700)
        with tempfile.TemporaryDirectory(prefix="sip-conversation-") as path:
            directory = Path(path)
            write_config(directory, modules, args.max_duration)
            client = Baresip(executable, directory, args.max_duration + 15, account)
            try:
                if not client.observe(time.monotonic() + 15, rb"registered successfully"):
                    raise CallError("SIP registration timed out before dialing.")
                with (args.output_dir / "turns.jsonl").open("x") as log:
                    converse(client, Gemini(key), directory, args.persona, account[2],
                             args.max_duration, log)
            finally:
                client.close()
                if list(directory.glob("dump-*-dec.wav")):
                    save_recording(directory, args.output_dir / "teacher.wav")
                enc = list(directory.glob("dump-*-enc.wav"))
                if len(enc) == 1:
                    shutil.copyfile(enc[0], args.output_dir / "caller.wav")
    except (CallError, requests.RequestException, ValueError, KeyError, IndexError, StopIteration,
            OSError, wave.Error) as error:
        detail = str(error) if isinstance(error, CallError) else type(error).__name__
        print(f"Conversation stopped: {detail}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
