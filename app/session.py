from __future__ import annotations

import asyncio
import collections
import json
import logging
import struct
import time
from datetime import UTC, datetime

from fastapi import WebSocket, WebSocketDisconnect

from .audio import downsample_24k_to_8k, upsample_8k_to_16k
from .basic_translator import BasicTranslator
from .business import BusinessStore
from .config import Settings
from .controls import TutorControls
from .gemini_live import GeminiLive
from .progress import LessonSummary, Observation, ProgressStore, UsageTotals
from .prompting import compile_prompt
from .technoline import StartFrame, hangup_command, transfer_command

LOGGER = logging.getLogger(__name__)

FRAME_BYTES = 320
FRAME_SECONDS = 0.02
SILENCE_FRAME = b"\x00" * FRAME_BYTES


class CallEnded(Exception):
    pass


class TutorSession:
    """Bridge one measured Technoline PCM stream to one Gemini Live session."""

    def __init__(
        self,
        *,
        pbx: WebSocket,
        start: StartFrame,
        settings: Settings,
        progress: ProgressStore,
        business: BusinessStore | None = None,
        before_transfer=None,
    ) -> None:
        self.pbx = pbx
        self.start = start
        self.settings = settings
        self.progress = progress
        self.business = business
        self.customer_id = settings.student_id
        self._sent_audio_turns: set[int] = set()
        self._meter_started: float | None = None
        self.started_at = datetime.now(UTC)
        self.learner_turns = 0
        self.tutor_turns = 0
        self.observations: list[Observation] = []
        self.lesson_summary: LessonSummary | None = None
        self.transcript: list[dict[str, str]] = []
        self.input_text_tokens = 0
        self.input_audio_tokens = 0
        self.output_text_tokens = 0
        self.output_audio_tokens = 0
        self.thoughts_tokens = 0
        self.input_audio_bytes = 0
        self.output_audio_bytes = 0
        self._out: collections.deque[tuple[int, bytes]] = collections.deque()
        self._partial = b""
        self._resample_carry = b""
        self._learner_seen_this_turn = False
        self._turn_input_transcript_chars = 0
        self._turn_output_transcript_chars = 0
        self._turn_output_audio_bytes = 0
        self._clock_start = time.monotonic()
        self._clock_previous = self._clock_start
        self._first_pbx_audio_seen = False
        self._first_output_audio_seen = False
        self._last_human_activity = time.monotonic()
        self._end_reason: str | None = None
        self._pbx_disconnected = False
        self._pbx_finish_sent = False
        self._return_path = None
        self._final_audio_drained = False
        self.before_transfer = before_transfer
        self._gemini_entered = False
        self._ai_connection_closed = False
        self._stop_requested = asyncio.Event()

    def request_stop(self) -> None:
        self._end_reason = "admin_requested"
        self._stop_requested.set()

    async def _stop_watchdog(self) -> None:
        await self._stop_requested.wait()
        raise CallEnded

    async def run(self) -> None:
        try:
            await self._latency("session_started")
            radio_url = self.settings.radio_streams.get(self.settings.student_id)
            if radio_url:
                await self._run_radio(radio_url)
                return
            if self.business:
                self.customer_id = await asyncio.to_thread(
                    self.business.identify_call,
                    self.start.caller,
                    self.start.call_id,
                    self.settings.student_id,
                )
            defaults = (
                TutorControls.adult_from_settings(self.settings)
                if self.settings.student_id == self.settings.adult_student_id
                else TutorControls.from_settings(self.settings)
            )
            controls = await self.progress.load_tutor_controls(self.settings.student_id, defaults)
            await self._latency("configuration_loaded")
            history = await self.progress.lesson_context(self.customer_id)
            if self.business:
                history += await asyncio.to_thread(
                    self.business.lesson_context,
                    self.customer_id,
                    self.settings.student_id,
                )
                from .pbx import quick_opening, runtime_context

                opening = await asyncio.to_thread(quick_opening, self.business, self.start.call_id)
                if opening:
                    controls = controls.model_copy(update={"opening_message": opening})

                history += "\n" + await asyncio.to_thread(
                    runtime_context,
                    self.business,
                    self.start.call_id,
                )
            artifact = compile_prompt(
                controls=controls,
                history_context=history,
                settings=self.settings,
                profile_id=self.settings.student_id,
            )
            self.settings = artifact.runtime_settings
            allowed_seconds = self.settings.max_call_minutes * 60
            if self.business:
                allowance = await asyncio.to_thread(
                    self.business.reserve_call,
                    self.customer_id,
                    self.settings.student_id,
                    self.start.call_id,
                    allowed_seconds,
                )
                allowed_seconds = allowance["seconds"]
                await self._latency("access_checked", {"mode": allowance["mode"]})
                if not allowed_seconds:
                    self._return_path = allowance["extension"]
                    return
                if allowance["mode"] == "basic":
                    self.settings = self.settings.model_copy(
                        update={"gemini_live_model": self.settings.basic_translator_model}
                    )
                    self._meter_started = time.monotonic()
                    async with asyncio.timeout(allowed_seconds):
                        await self._run_basic(allowance.get("intro") or "")
                    return
            await self.progress.save_prompt_snapshot(
                profile_id=self.settings.student_id,
                call_id=self.start.call_id,
                artifact=artifact,
            )
            await self._latency(
                "prompt_compiled",
                {"fingerprint": artifact.fingerprint, "history_chars": len(history)},
            )
            async with asyncio.timeout(allowed_seconds + 20):
                await self._latency("gemini_connect_started")
                async with GeminiLive(self.settings, setup_payload=artifact.setup_message) as ai:
                    await self._latency("gemini_connected")
                    self._gemini_entered = True
                    self._last_human_activity = time.monotonic()
                    if self._stop_requested.is_set():
                        raise CallEnded
                    self._meter_started = time.monotonic()
                    await self.progress.log_diagnostic(
                        profile_id=self.settings.student_id,
                        call_id=self.start.call_id,
                        event_type="gemini_connected",
                        details={"model": self.settings.gemini_live_model},
                    )
                    await ai.start_greeting()
                    await self._latency("greeting_sent")
                    await self.progress.log_diagnostic(
                        profile_id=self.settings.student_id,
                        call_id=self.start.call_id,
                        event_type="greeting_requested",
                    )
                    async with asyncio.timeout(allowed_seconds):
                        await self._bridge(ai)
        except TimeoutError:
            self._end_reason = "hard_time_limit"
            if self.settings.student_id.startswith("isaac-"):
                self._return_path = self.settings.tlivr_project_path + "/8"
        except (CallEnded, WebSocketDisconnect):
            pass
        finally:
            # The Gemini context has exited BEFORE any phone drain, database save or transfer.
            self._ai_connection_closed = True
            if self._gemini_entered:
                await self._latency(
                    "ai_connection_closed",
                    {
                        "reason": self._end_reason or "transport_ended",
                    },
                )
            await self._drain_final_audio()
            meter_ended = time.monotonic()
            try:
                if self.business:
                    billed = (meter_ended - self._meter_started) if self._meter_started else 0
                    await asyncio.to_thread(self.business.settle_call, self.start.call_id, billed)
                await self.progress.save_session(
                    student_id=self.customer_id,
                    call_id=self.start.call_id,
                    started_at=self.started_at,
                    learner_turns=self.learner_turns,
                    tutor_turns=self.tutor_turns,
                    observations=self.observations,
                    transcript=self.transcript if self.settings.store_transcripts else None,
                    summary=self.lesson_summary or self._fallback_summary(),
                    usage=self._usage_totals(),
                    model=self.settings.gemini_live_model,
                )
                await self.progress.log_diagnostic(
                    profile_id=self.settings.student_id,
                    call_id=self.start.call_id,
                    event_type="session_saved",
                    details={
                        "learner_turns": self.learner_turns,
                        "tutor_turns": self.tutor_turns,
                        "duration_seconds": max(
                            0, int((datetime.now(UTC) - self.started_at).total_seconds())
                        ),
                    },
                )
                await self._latency("session_saved")
            except Exception:
                # Do not start another segment with uncertain balances or history.
                self._return_path = None
                self.settings.session_end_action = "hangup"
                raise
            finally:
                await self._finish_pbx()

    async def _bridge(self, ai: GeminiLive) -> None:
        tasks = {
            asyncio.create_task(self._pbx_to_ai(ai), name="pbx-to-gemini"),
            asyncio.create_task(self._ai_to_queue(ai), name="gemini-to-pbx-queue"),
            asyncio.create_task(self._paced_output(), name="paced-pbx-output"),
            asyncio.create_task(self._idle_watchdog(), name="session-idle-watchdog"),
            asyncio.create_task(self._stop_watchdog(), name="session-stop-watchdog"),
        }
        await self._run_tasks(tasks)

    async def _run_tasks(self, tasks: set[asyncio.Task]) -> None:
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                exception = task.exception()
                if exception and not isinstance(exception, (CallEnded, WebSocketDisconnect)):
                    raise exception
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _receive_pbx_audio(self) -> bytes | None:
        try:
            message = await asyncio.wait_for(self.pbx.receive(), timeout=15)
        except TimeoutError:
            self._end_reason = "pbx_input_timeout"
            raise CallEnded from None
        if message.get("type") == "websocket.disconnect":
            self._pbx_disconnected = True
            self._end_reason = "caller_disconnected"
            raise CallEnded
        audio = message.get("bytes")
        if audio is not None:
            if len(audio) > 128 * 1024:
                raise CallEnded("oversized audio frame")
            if len(audio) % 2:
                LOGGER.warning("Dropping odd-length PCM frame for call %s", self.start.call_id)
                return None
            if not self._first_pbx_audio_seen:
                self._first_pbx_audio_seen = True
                await self._latency("first_pbx_audio")
            return audio
        text = message.get("text")
        if not text:
            return None
        try:
            control = json.loads(text)
        except json.JSONDecodeError:
            return None
        if str(control.get("type", "")).lower() in {"stop", "hangup", "end"}:
            self._pbx_disconnected = True
            self._end_reason = "caller_disconnected"
            raise CallEnded
        return None

    async def _pbx_to_ai(self, ai: GeminiLive) -> None:
        batch: list[bytes] = []
        while True:
            audio = await self._receive_pbx_audio()
            if audio is None:
                continue
            if self._has_voice_activity(audio):
                self._last_human_activity = time.monotonic()
            batch.append(audio)
            if len(batch) >= self.settings.gemini_input_batch_frames:
                pcm16k = upsample_8k_to_16k(b"".join(batch))
                self.input_audio_bytes += len(pcm16k)
                await ai.send_audio(pcm16k)
                batch.clear()

    async def _run_radio(self, url: str) -> None:
        await self._latency("radio_started")
        reconnect = (
            ["-reconnect", "1", "-reconnect_streamed", "1"] if url.startswith("http") else []
        )
        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-loglevel", "error", *reconnect,
            "-i", url, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1",
            stdout=asyncio.subprocess.PIPE, stdin=asyncio.subprocess.DEVNULL,
        )

        async def relay() -> None:
            while chunk := await process.stdout.read(FRAME_BYTES * 25):
                self._enqueue(chunk)
                while len(self._out) > 150:  # keep at most ~3 s of backlog
                    self._out.popleft()
            while self._out:  # noqa: ASYNC110 - drain paced output
                await asyncio.sleep(FRAME_SECONDS)
            self._end_reason = "radio_stream_ended"

        async def listen() -> None:
            while True:
                await self._receive_pbx_audio()

        try:
            await self._run_tasks({
                asyncio.create_task(relay(), name="radio-relay"),
                asyncio.create_task(listen(), name="radio-listen"),
                asyncio.create_task(self._paced_output(), name="paced-pbx-output"),
                asyncio.create_task(self._stop_watchdog(), name="session-stop-watchdog"),
            })
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()

    async def _run_basic(self, intro: str) -> None:
        language = ""
        if self.business and "~" in self.start.call_id:
            from .pbx import load_context

            language = load_context(self.business, self.start.call_id).get("language") or ""
        translator = BasicTranslator(self.settings, language)
        self._last_human_activity = time.monotonic()
        await self._latency("basic_translator_started", {"language": language})
        await self._run_tasks({
            asyncio.create_task(self._basic_listen(translator, intro), name="basic-translator"),
            asyncio.create_task(self._paced_output(), name="paced-pbx-output"),
            asyncio.create_task(self._idle_watchdog(), name="session-idle-watchdog"),
            asyncio.create_task(self._stop_watchdog(), name="session-stop-watchdog"),
        })

    async def _basic_say(self, translator: BasicTranslator, text: str, language: str) -> None:
        pcm8 = await translator.speak(text, language)
        self.output_audio_bytes += len(pcm8) * 3
        self._enqueue(pcm8)
        if self._partial:
            self._enqueue(b"\0" * (FRAME_BYTES - len(self._partial)))
        self.tutor_turns += 1

    async def _basic_listen(self, translator: BasicTranslator, intro: str) -> None:
        bytes_per_second = 16000
        if intro:
            await self._basic_say(translator, intro, "he-IL")
        speech = bytearray()
        voiced = silent = 0
        while True:
            audio = await self._receive_pbx_audio()
            if audio is None:
                continue
            if self._out:
                # Half duplex: ignore the line while the translation is still playing.
                speech.clear()
                voiced = silent = 0
                self._last_human_activity = time.monotonic()
                continue
            if self._has_voice_activity(audio):
                self._last_human_activity = time.monotonic()
                speech += audio
                voiced += len(audio)
                silent = 0
            elif speech:
                speech += audio
                silent += len(audio)
            ended = silent >= bytes_per_second * 0.8 or len(speech) >= bytes_per_second * 15
            if not (speech and ended):
                continue
            utterance = bytes(speech)
            speech.clear()
            enough = voiced >= bytes_per_second * 0.3
            voiced = silent = 0
            if not enough:
                continue
            self.learner_turns += 1
            self.input_audio_bytes += len(utterance) * 2
            try:
                result = await translator.translate(utterance)
                await self._latency("basic_translated", {"chars": len(result.text)})
                if result.text:
                    self.transcript.append({"role": "learner", "text": result.heard})
                    self.transcript.append({"role": "tutor", "text": result.text})
                    await self._basic_say(translator, result.text, result.language)
            except Exception:
                LOGGER.exception("Basic translation failed for call %s", self.start.call_id)
                await self.progress.log_diagnostic(
                    profile_id=self.settings.student_id,
                    call_id=self.start.call_id,
                    event_type="basic_translation_failed",
                )

    async def _ai_to_queue(self, ai: GeminiLive) -> None:
        async for event in ai.events():
            kind = event["type"]
            if kind == "audio":
                if not self._first_output_audio_seen:
                    self._first_output_audio_seen = True
                    await self._latency(
                        "first_gemini_audio",
                        {"tutor_turn": self.tutor_turns + 1},
                    )
                self.output_audio_bytes += len(event["pcm24k"])
                self._turn_output_audio_bytes += len(event["pcm24k"])
                pcm8, self._resample_carry = downsample_24k_to_8k(
                    event["pcm24k"], self._resample_carry
                )
                self._enqueue(pcm8)
            elif kind == "interrupted":
                self._out.clear()
                self._partial = b""
                self._resample_carry = b""
                await self._latency("tutor_interrupted")
                await self.progress.log_diagnostic(
                    profile_id=self.settings.student_id,
                    call_id=self.start.call_id,
                    event_type="tutor_interrupted",
                    details={"queued_audio_cleared": True},
                )
            elif kind == "transcript":
                role = str(event["role"])
                transcript = str(event["text"]).strip()
                if not transcript:
                    continue
                self.transcript.append({"role": role, "text": transcript})
                await self.progress.log_conversation_turn(
                    profile_id=self.settings.student_id,
                    call_id=self.start.call_id,
                    direction="input" if role == "learner" else "output",
                    text=transcript,
                    metadata={
                        "learner_turn": self.learner_turns + (1 if role == "learner" else 0),
                        "tutor_turn": self.tutor_turns + (1 if role == "tutor" else 0),
                    },
                )
                if role == "learner" and not self._learner_seen_this_turn:
                    self.learner_turns += 1
                    self._learner_seen_this_turn = True
                    await self._latency(
                        "learner_transcript_ready",
                        {"learner_turn": self.learner_turns},
                    )
                if role == "learner":
                    self._last_human_activity = time.monotonic()
                    self._turn_input_transcript_chars += len(transcript)
                else:
                    if self._turn_output_transcript_chars == 0:
                        await self._latency(
                            "tutor_transcript_started",
                            {"tutor_turn": self.tutor_turns + 1},
                        )
                    self._turn_output_transcript_chars += len(transcript)
            elif kind == "turn_complete":
                possible_unprompted = self.tutor_turns > 0 and not self._learner_seen_this_turn
                self.tutor_turns += 1
                await self._latency(
                    "tutor_turn_complete",
                    {
                        "tutor_turn": self.tutor_turns,
                        "possible_unprompted": possible_unprompted,
                    },
                )
                await self.progress.log_diagnostic(
                    profile_id=self.settings.student_id,
                    call_id=self.start.call_id,
                    event_type=(
                        "possible_unprompted_response"
                        if possible_unprompted
                        else "tutor_turn_complete"
                    ),
                    details={
                        "tutor_turn": self.tutor_turns,
                        "learner_transcript_seen": self._learner_seen_this_turn,
                        "learner_transcript_chars": self._turn_input_transcript_chars,
                        "tutor_transcript_chars": self._turn_output_transcript_chars,
                        "output_audio_bytes": self._turn_output_audio_bytes,
                    },
                )
                if possible_unprompted:
                    LOGGER.warning(
                        "Possible unprompted Gemini response call=%s profile=%s turn=%s",
                        self.start.call_id,
                        self.settings.student_id,
                        self.tutor_turns,
                    )
                self._learner_seen_this_turn = False
                self._turn_input_transcript_chars = 0
                self._turn_output_transcript_chars = 0
                self._turn_output_audio_bytes = 0
                self._first_output_audio_seen = False
            elif kind == "tool_call":
                await self.progress.log_diagnostic(
                    profile_id=self.settings.student_id,
                    call_id=self.start.call_id,
                    event_type="tool_call",
                    details={"names": [str(call.get("name", "")) for call in event["calls"]]},
                )
                for call in event["calls"]:
                    if call.get("name") == "get_driving_route":
                        await ai.submit_tool_result(call, True, await self._route_tool(call))
                        continue
                    if call.get("name") == "navigation_update":
                        await ai.submit_tool_result(call, True, await self._nav_tool(call))
                        continue
                    saved = self._record_tool_call(call)
                    await ai.submit_tool_result(call, saved)
                    if call.get("name") == "end_session":
                        return  # Unwind the context and close Google immediately.
            elif kind == "usage":
                self._record_usage(event["usage"])
            elif kind == "go_away":
                LOGGER.warning("Gemini requested session close: %s", event.get("detail"))
                raise CallEnded
        raise CallEnded

    def _has_voice_activity(self, audio: bytes) -> bool:
        count = len(audio) // 2
        if not count:
            return False
        samples = struct.unpack(f"<{count}h", audio)
        return sum(v * v for v in samples) / count >= (
            self.settings.session_idle_audio_threshold**2
        )

    async def _idle_watchdog(self) -> None:
        # Constant PCM silence and the bot's own speech must NOT keep an idle session alive.
        while True:
            remaining = self.settings.session_idle_timeout_seconds - (
                time.monotonic() - self._last_human_activity
            )
            if remaining <= 0:
                self._end_reason = "idle_timeout"
                await self._latency(
                    "idle_timeout",
                    {
                        "idle_seconds": self.settings.session_idle_timeout_seconds,
                    },
                )
                raise CallEnded
            await asyncio.sleep(min(1, remaining))

    async def _drain_final_audio(self) -> None:
        if (self._final_audio_drained or self.pbx is None or self._pbx_disconnected
                or not self._end_reason or not self._end_reason.startswith("model:")):
            return
        self._final_audio_drained = True
        # Producers are stopped and Google is closed: drain a finite snapshot, not a 2s slice.
        if self._partial:
            self._out.append((self.tutor_turns + 1, self._partial.ljust(FRAME_BYTES, b"\0")))
            self._partial = b""
        frames = len(self._out)
        try:
            for _ in range(frames):
                if self._stop_requested.is_set():
                    break
                _, frame = self._out.popleft()
                async with asyncio.timeout(3):
                    await self.pbx.send_bytes(frame)
                await asyncio.sleep(FRAME_SECONDS)
            # Pace the last frame and leave a small PCM tail for the PBX playback buffer.
            if (frames or self.output_audio_bytes) and not self._stop_requested.is_set():
                for _ in range(10):
                    async with asyncio.timeout(3):
                        await self.pbx.send_bytes(SILENCE_FRAME)
                    await asyncio.sleep(FRAME_SECONDS)
        except (TimeoutError, RuntimeError, WebSocketDisconnect):
            pass
        self._out.clear()

    async def _finish_pbx(self) -> None:
        if self.pbx is None or self._pbx_disconnected or self._pbx_finish_sent:
            return
        await self._drain_final_audio()
        self._out.clear()
        try:
            command = hangup_command()
            if self._return_path:
                command = transfer_command(self._return_path)
            elif self.settings.session_end_action == "return_to_menu":
                path = (
                    self.settings.tlivr_project_path
                    if "~" in self.start.call_id
                    else self.settings.technoline_return_extension
                )
                command = transfer_command(path)
            if (self._return_path or self.settings.session_end_action == "return_to_menu"):
                if self.before_transfer:
                    await self.before_transfer()
                    self.before_transfer = None
            async with asyncio.timeout(3):
                await self.pbx.send_text(command)
            self._pbx_finish_sent = True
            await self._latency(
                "phone_session_ended",
                {
                    "reason": self._end_reason or "transport_ended",
                    "action": "navigate" if self._return_path else self.settings.session_end_action,
                    **({"target": self._return_path} if self._return_path else {}),
                },
            )
        except (TimeoutError, RuntimeError, WebSocketDisconnect):
            pass

    async def _latency(self, event_name: str, details: dict[str, object] | None = None) -> None:
        now = time.monotonic()
        previous = self._clock_previous
        self._clock_previous = now
        await self.progress.log_latency(
            profile_id=self.settings.student_id,
            call_id=self.start.call_id,
            event_name=event_name,
            since_call_start_ms=(now - self._clock_start) * 1000,
            since_previous_ms=(now - previous) * 1000,
            details=dict(details or {}),
        )

    async def _paced_output(self) -> None:
        next_tick = time.monotonic()
        while True:
            next_tick += FRAME_SECONDS
            await asyncio.sleep(max(0, next_tick - time.monotonic()))
            had_audio = bool(self._out)
            turn, frame = self._out.popleft() if had_audio else (0, SILENCE_FRAME)
            await self.pbx.send_bytes(frame)
            if had_audio and turn not in self._sent_audio_turns:
                self._sent_audio_turns.add(turn)
                if turn == 1 and self.business:
                    from .pbx import mark_quick_intro

                    await asyncio.to_thread(
                        mark_quick_intro, self.business, self.start.call_id, self.customer_id,
                    )
                await self._latency(
                    "first_audio_sent_to_phone",
                    {
                        "queue_frames": len(self._out),
                        "customer_id": self.customer_id,
                        "tutor_turn": turn,
                    },
                )

    def _enqueue(self, pcm8: bytes) -> None:
        data = self._partial + pcm8
        whole = len(data) - (len(data) % FRAME_BYTES)
        for offset in range(0, whole, FRAME_BYTES):
            self._out.append((self.tutor_turns + 1, data[offset : offset + FRAME_BYTES]))
        self._partial = data[whole:]

    async def _route_tool(self, call: dict) -> dict:
        from .routes_api import compute_route

        args = call.get("args") or {}
        origin, destination = str(args.get("origin", "")), str(args.get("destination", ""))
        if (self.settings.student_id not in self.settings.navigation_bot_ids
                or not origin or not destination):
            return {"found": False, "error": "origin and destination are required"}
        if self.business and not await asyncio.to_thread(
            self.business.consume_monthly_quota, "routes", self.settings.routes_monthly_limit,
        ):
            return {"found": False, "error": "monthly live-route quota reached; navigate "
                    "from general knowledge and say live traffic is unavailable"}
        try:
            result = await compute_route(self.settings, origin, destination)
        except Exception:
            LOGGER.exception("Route lookup failed for call %s", self.start.call_id)
            return {"found": False, "error": "live route lookup failed"}
        await self._latency("route_lookup", {"found": result.get("found", False)})
        return result

    async def _nav_tool(self, call: dict) -> dict:
        from .nav_engine import new_state, run_update

        if self.settings.student_id not in self.settings.navigation_bot_ids:
            return {"status": "error", "error": "navigation is not enabled for this bot"}
        if self.business and not await asyncio.to_thread(
            self.business.consume_monthly_quota, "places", self.settings.places_monthly_limit,
        ):
            return {"status": "error", "error": "monthly map quota reached; navigate from "
                    "general knowledge and say live maps are unavailable"}
        if getattr(self, "_nav", None) is None:
            self._nav = new_state(self.settings)
        args = call.get("args") or {}
        try:
            result = await run_update(self._nav, args)
        except Exception:
            LOGGER.exception("Navigation update failed for call %s", self.start.call_id)
            result = {"status": "error", "error": "map lookup failed; ask the driver to repeat"}
        self.transcript.append({"role": "navigation", "text": json.dumps(
            {"args": args, "result": result}, ensure_ascii=False)[:1500]})
        await self._latency("nav_update", {"status": result.get("status")})
        return result

    def _record_tool_call(self, call: dict) -> bool:
        if call.get("name") == "end_session":
            args = call.get("args") or {}
            reason = args.get("reason", "task_completed")
            destination = args.get("destination")
            targets = {"main": "", "school": "/1", "translator": "/2", "options": "/9"}
            if (reason == "caller_requested" and isinstance(destination, str)
                    and destination in targets and self.business and "~" in self.start.call_id):
                self._return_path = self.settings.tlivr_project_path + targets[destination]
            if (not isinstance(reason, str)
                    or reason not in {"caller_requested", "task_completed", "no_response"}):
                reason = "task_completed"
            self._end_reason = "model:" + reason
            return True
        if call.get("name") == "save_translation_language":
            from .pbx import load_context, save_context, save_preference

            language = (call.get("args") or {}).get("language")
            if language == "auto":
                language = ""
            languages = {"", "English", "Hebrew", "Yiddish", "Arabic", "Russian", "French"}
            if (not self.business or "~" not in self.start.call_id or not isinstance(language, str)
                    or language not in languages):
                return False
            if load_context(self.business, self.start.call_id).get("quick_entry") != "translation":
                return False
            # Update both the current segment and parent call for later transfers.
            values = {"language": language}
            save_context(self.business, self.start.call_id, values)
            save_context(self.business, self.start.call_id.rsplit("~", 1)[0], values)
            save_preference(self.business, self.customer_id, values)
            return True
        if call.get("name") == "record_lesson_summary":
            return self._record_summary(call)
        if call.get("name") != "record_learning_observation":
            return False
        try:
            arguments = call.get("args") or {}
            observation = Observation(
                skill=str(arguments["skill"])[:40],
                result=str(arguments["result"])[:160],
                correction=str(arguments["correction"])[:160],
                score=max(1, min(5, int(arguments["score"]))),
            )
        except (KeyError, TypeError, ValueError):
            LOGGER.warning("Ignoring malformed learning observation")
            return False
        self.observations.append(observation)
        return True

    def _record_summary(self, call: dict) -> bool:
        try:
            arguments = call.get("args") or {}
            self.lesson_summary = LessonSummary(
                summary_he=str(arguments["summary_he"]).strip()[:500],
                success_he=str(arguments["success_he"]).strip()[:300],
                next_step_he=str(arguments["next_step_he"]).strip()[:300],
                points=max(0, min(100, int(arguments["points"]))),
            )
        except (KeyError, TypeError, ValueError):
            LOGGER.warning("Ignoring malformed lesson summary")
            return False
        return True

    @staticmethod
    def _modality_tokens(details: object, modality: str) -> int:
        if not isinstance(details, list):
            return 0
        total = 0
        for item in details:
            if not isinstance(item, dict):
                continue
            if str(item.get("modality", "")).upper() == modality:
                total += TutorSession._safe_nonnegative_int(item.get("tokenCount"))
        return total

    @staticmethod
    def _safe_nonnegative_int(value: object) -> int:
        try:
            return max(0, int(value))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0

    def _record_usage(self, usage: dict) -> None:
        self.input_text_tokens += self._modality_tokens(usage.get("promptTokensDetails"), "TEXT")
        self.input_audio_tokens += self._modality_tokens(usage.get("promptTokensDetails"), "AUDIO")
        self.output_text_tokens += self._modality_tokens(usage.get("responseTokensDetails"), "TEXT")
        self.output_audio_tokens += self._modality_tokens(
            usage.get("responseTokensDetails"), "AUDIO"
        )
        self.thoughts_tokens += self._safe_nonnegative_int(usage.get("thoughtsTokenCount"))

    def _fallback_summary(self) -> LessonSummary:
        points = min(
            100,
            self.learner_turns * 5
            + sum(observation.score * 2 for observation in self.observations),
        )
        if self.observations:
            best = max(self.observations, key=lambda item: item.score)
            correction = next(
                (item.correction for item in reversed(self.observations) if item.correction),
                "להמשיך לתרגל משפטים קצרים בקול.",
            )
            return LessonSummary(
                summary_he=f"בשיחה תורגלו {len(self.observations)} מיומנויות באנגלית.",
                success_he=best.result or "הייתה השתתפות טובה בתרגול.",
                next_step_he=correction,
                points=points,
            )
        return LessonSummary(
            summary_he="השיחה הסתיימה לפני שנאסף מספיק מידע לסיכום מלא.",
            success_he="עצם הכניסה לתרגול היא התחלה טובה.",
            next_step_he="בשיחה הבאה נתחיל ממשפט אנגלי קצר אחד.",
            points=points,
        )

    def _usage_totals(self) -> UsageTotals:
        if any(
            (
                self.input_text_tokens,
                self.input_audio_tokens,
                self.output_text_tokens,
                self.output_audio_tokens,
                self.thoughts_tokens,
            )
        ):
            cost = (
                self.input_text_tokens * self.settings.gemini_input_text_usd_per_million
                + self.input_audio_tokens * self.settings.gemini_input_audio_usd_per_million
                + (self.output_text_tokens + self.thoughts_tokens)
                * self.settings.gemini_output_text_usd_per_million
                + self.output_audio_tokens * self.settings.gemini_output_audio_usd_per_million
            ) / 1_000_000
            basis = "gemini_usage_metadata"
        else:
            input_minutes = self.input_audio_bytes / (16_000 * 2 * 60)
            output_minutes = self.output_audio_bytes / (24_000 * 2 * 60)
            cost = (
                input_minutes * self.settings.gemini_input_audio_usd_per_minute
                + output_minutes * self.settings.gemini_output_audio_usd_per_minute
            )
            basis = "audio_duration_estimate" if cost else "none"
        return UsageTotals(
            input_text_tokens=self.input_text_tokens,
            input_audio_tokens=self.input_audio_tokens,
            output_text_tokens=self.output_text_tokens,
            output_audio_tokens=self.output_audio_tokens,
            thoughts_tokens=self.thoughts_tokens,
            estimated_cost_usd=round(cost, 8),
            cost_basis=basis,
        )

