"""Make one approved IVR test call over Yemot SIP and record the received audio."""

import argparse
import errno
import math
import os
import pty
import re
import select
import shutil
import subprocess
import tempfile
import time
import tty
import wave
from pathlib import Path

DEFAULT_TARGET = "0765673575"
BLOCKED_TARGET = "0527180504"
DEFAULT_HOST = "sip.yemot.co.il"
RATE = 8000
DIGIT_INTERVAL = 0.35
REQUIRED_MODULES = ("stdio", "g711", "aufile", "aubridge", "sndfile", "account", "menu")


class CallError(Exception):
    pass


def target_number(value: str) -> str:
    number = re.sub(r"[ -]", "", value)
    if number.startswith(("+972", "00972")):
        number = "0" + number.split("972", 1)[1]
    if not re.fullmatch(r"0[0-9]{8,9}", number):
        raise CallError("Use a local Israeli telephone number or its +972 equivalent.")
    if number == BLOCKED_TARGET:
        raise CallError("Dialing this number is not allowed.")
    return number


def credentials() -> tuple[str, str, str]:
    user = os.environ.get("YEMOT_SIP_USER", "")
    password = os.environ.get("YEMOT_SIP_PASSWORD", "")
    host = os.environ.get("YEMOT_SIP_HOST", DEFAULT_HOST)
    if not (
        len(user) <= 64 and re.fullmatch(r"[0-9]+=[0-9]+", user)
        and password.isascii() and 0 < len(password) <= 128
        and re.fullmatch(r'[^\s;<>\x00-\x1f"\\]+', password)
        and len(host) <= 253 and re.fullmatch(r"[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*", host)
    ):
        raise CallError("Set valid YEMOT_SIP_USER, YEMOT_SIP_PASSWORD and optional YEMOT_SIP_HOST.")
    return user, password, host


def prepare_steps(directory: Path, values: list[str], limit: int) -> list[tuple[str, str, float]]:
    steps = []
    elapsed = 0.0
    for index, value in enumerate(values):
        action, sep, argument = value.partition(":")
        if not sep or not argument:
            raise CallError("Use --step wait:SECONDS, keys:DIGITS or play:FILE.wav.")
        if action == "wait":
            try:
                duration = float(argument)
            except ValueError:
                raise CallError("Wait must be a finite, nonnegative number of seconds.") from None
            if not math.isfinite(duration) or duration < 0:
                raise CallError("Wait must be a finite, nonnegative number of seconds.")
        elif action == "keys" and re.fullmatch(r"[0-9*#]+", argument):
            duration = len(argument) * DIGIT_INTERVAL
        elif action == "play":
            filename = f"play-{index}.wav"
            try:
                with wave.open(argument, "rb") as speech:
                    frames = speech.getnframes()
                    if (speech.getnchannels(), speech.getsampwidth(), speech.getframerate(),
                        speech.getcomptype()) != (1, 2, RATE, "NONE") or not frames:
                        raise CallError("Speech WAV must be nonempty 8 kHz mono 16-bit PCM.")
                    duration = frames / RATE
                    if elapsed + duration > limit:
                        raise CallError("The scripted steps exceed --max-duration.")
                    audio = speech.readframes(frames)
                    if len(audio) != frames * 2:
                        raise CallError("Speech WAV is truncated.")
            except (OSError, EOFError, wave.Error):
                raise CallError("Could not read speech WAV.") from None
            source_frames = (limit + 1) * RATE - int(elapsed * RATE)
            write_wav(directory / filename, audio.ljust(source_frames * 2, b"\x00"))
            argument = filename
        else:
            raise CallError("Use --step wait:SECONDS, keys:DIGITS or play:FILE.wav.")
        elapsed += duration
        if elapsed > limit:
            raise CallError("The scripted steps exceed --max-duration.")
        steps.append((action, argument, duration))
    return steps


def write_wav(path: Path, audio: bytes) -> None:
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        wav.writeframes(audio)


def write_config(directory: Path, modules: Path, limit: int) -> None:
    lines = [
        f"module_path {modules}", "sip_listen 0.0.0.0:0", "audio_player aubridge,nil",
        "audio_alert aubridge,nil", "audio_source aufile,silence.wav", "snd_path .",
        "redial_attempts 0",
        *(f"module {module}.so" for module in REQUIRED_MODULES),
        "module_app account.so", "module_app menu.so",
    ]
    (directory / "config").write_text("\n".join(lines) + "\n")
    write_wav(directory / "silence.wav", bytes((limit + 1) * RATE * 2))


class Baresip:
    def __init__(self, executable: str, directory: Path, timeout: int,
                 account: tuple[str, str, str]):
        self.master, slave = pty.openpty()
        try:
            tty.setraw(slave)
            env = {key: value for key, value in os.environ.items()
                   if key not in ("YEMOT_SIP_USER", "YEMOT_SIP_PASSWORD")}
            user, password, host = account
            read_fd, write_fd = os.pipe()
            try:
                with os.fdopen(write_fd, "w") as pipe:
                    pipe.write(
                        f"<sip:{user}@{host};transport=udp>;auth_pass={password};"
                        "regint=600;audio_codecs=PCMA,PCMU;answermode=manual\n"
                    )
                (directory / "accounts").symlink_to(f"/proc/self/fd/{read_fd}")
                self.process = subprocess.Popen(
                    [executable, "-4", "-f", ".", "-t", str(timeout)],
                    cwd=directory, env=env, stdin=slave, stdout=slave, stderr=slave,
                    pass_fds=(read_fd,),
                )
            finally:
                os.close(read_fd)
        except BaseException:
            os.close(self.master)
            raise
        finally:
            os.close(slave)
        self.buffer = b""

    def send(self, command: str) -> None:
        try:
            os.write(self.master, command.encode("ascii"))
        except OSError:
            raise CallError("Could not send command to baresip.") from None

    def observe(self, deadline: float, pattern: bytes | None = None) -> bool:
        while True:
            match = re.search(pattern, self.buffer, re.IGNORECASE) if pattern else None
            closed = re.search(rb"session closed|failed to set audio-source", self.buffer)
            if closed and (not match or closed.start() < match.start()):
                raise CallError("The call ended or SIP audio stopped before the step completed.")
            if match:
                self.buffer = self.buffer[match.end():]
                return True
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.master], [], [], remaining)[0]:
                return False
            try:
                chunk = os.read(self.master, 4096)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b""
            if not chunk:
                raise CallError("Baresip stopped before the operation completed.")
            self.buffer = self.buffer[-4096:] + chunk

    def close(self) -> None:
        try:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
        finally:
            os.close(self.master)


def execute_call(client, number: str, host: str, steps: list, limit: int) -> int:
    deadline = time.monotonic() + limit
    client.send(f"/dial sip:{number}@{host};transport=udp\n")
    if not client.observe(deadline, rb"Call established:"):
        raise CallError("The destination did not answer before --max-duration.")
    print("SIP call answered.", flush=True)

    def pause(seconds: float) -> None:
        wake = time.monotonic() + seconds
        client.observe(min(deadline, wake))
        if wake > deadline:
            raise CallError("Maximum call duration reached.")

    for action, argument, duration in steps:
        if time.monotonic() >= deadline:
            raise CallError("Maximum call duration reached.")
        if action == "keys":
            for digit in argument:
                client.send(digit)
                pause(DIGIT_INTERVAL)
        elif action == "play":
            client.send(f"/ausrc aufile,{argument}\n")
            if not client.observe(deadline, rb"aufile: " + re.escape(argument.encode()) + rb":"):
                raise CallError("Baresip did not open the speech WAV.")
            pause(duration)
            client.send("/ausrc aufile,silence.wav\n")
        else:
            pause(duration)
    try:
        client.observe(deadline)
    except CallError:
        pass
    return len(steps)


def save_recording(directory: Path, output: Path) -> None:
    recordings = list(directory.glob("dump-*-dec.wav"))
    if len(recordings) != 1:
        raise CallError("No single received-audio recording was available.")
    with wave.open(str(recordings[0]), "rb") as wav:
        if not wav.getnframes():
            raise CallError("No received audio was captured.")
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as destination, recordings[0].open("rb") as source:
        shutil.copyfileobj(source, destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", nargs="?")
    parser.add_argument("--register-only", action="store_true", help="Register without dialing.")
    parser.add_argument(
        "--step", action="append", default=[], help="wait:N, keys:2, play:FILE.wav."
    )
    parser.add_argument("--max-duration", type=int, default=30, metavar="SECONDS")
    parser.add_argument("--output", type=Path, help="New WAV file for received audio.")
    args = parser.parse_args()
    if args.register_only and (args.target or args.step or args.output):
        parser.error("--register-only cannot be combined with a target, steps or output.")
    if not args.register_only and not (args.target and args.output):
        parser.error("a target and --output are required, unless using --register-only.")
    if not 1 <= args.max_duration <= 120:
        parser.error("--max-duration must be between 1 and 120 seconds.")
    try:
        number = None
        if not args.register_only:
            number = target_number(args.target)
            allowed = {target_number(item.strip()) for item in
                       os.environ.get("YEMOT_SIP_ALLOWED_TARGETS", "").split(",") if item.strip()}
            if number not in allowed | {DEFAULT_TARGET}:
                raise CallError("Target not approved in YEMOT_SIP_ALLOWED_TARGETS.")
            if not args.output.parent.is_dir() or os.path.lexists(args.output):
                raise CallError("--output must be a new file in an existing directory.")
        executable = shutil.which("baresip")
        modules = Path(os.environ.get("BARESIP_MODULE_PATH", "/usr/lib/baresip/modules"))
        if not executable or not all((modules / f"{m}.so").is_file() for m in REQUIRED_MODULES):
            raise CallError("Install baresip-core and its modules (Ubuntu: sudo apt install "
                            "baresip-core); set BARESIP_MODULE_PATH if needed.")
        account = credentials()
        with tempfile.TemporaryDirectory(prefix="sip-test-") as path:
            directory = Path(path)
            steps = prepare_steps(directory, args.step, args.max_duration)
            write_config(directory, modules, args.max_duration)
            client = Baresip(executable, directory, args.max_duration + 20, account)
            try:
                if not client.observe(time.monotonic() + 15, rb"registered successfully"):
                    raise CallError("Yemot SIP registration timed out.")
                if number is None:
                    print("SIP registration succeeded; no call placed.")
                    return 0
                try:
                    completed = execute_call(client, number, account[2], steps, args.max_duration)
                finally:
                    client.close()
                    client = None
                    if list(directory.glob("dump-*-dec.wav")):
                        save_recording(directory, args.output)
                        print(f"Saved received audio to {args.output}.")
            finally:
                if client is not None:
                    client.close()
            if not args.output.is_file():
                raise CallError("No received audio was captured.")
            print(f"One SIP call completed; {completed}/{len(steps)} steps run.")
    except (CallError, OSError, EOFError, wave.Error) as error:
        detail = str(error) if isinstance(error, CallError) else type(error).__name__
        print(f"SIP test stopped: {detail}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
