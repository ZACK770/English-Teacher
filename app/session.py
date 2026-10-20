from __future__ import annotations

import asyncio
import collections
import json
import logging
import time
from datetime import UTC, datetime

from fastapi import WebSocket, WebSocketDisconnect

from .audio import downsample_24k_to_8k, upsample_8k_to_16k
from .business import BusinessStore
from .config import Settings
from .controls import TutorControls
from .gemini_live import GeminiLive
from .progress import LessonSummary, Observation, ProgressStore, UsageTotals
from .prompting import compile_prompt
from .technoline import StartFrame, transfer_command

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

    async def run(self) -> None:
        try:
            await self._latency("session_started")
            if self.business:
                self.customer_id = await asyncio.to_thread(
                    self.business.identify_call, self.start.caller,
                    self.start.call_id, self.settings.student_id,
                )
            defaults = (
                TutorControls.adult_from_settings(self.settings)
                if self.settings.student_id == self.settings.adult_student_id
                else TutorControls.from_settings(self.settings)
            )
            controls = await self.progress.load_tutor_controls(
                self.settings.student_id, defaults
            )
            await self._latency("configuration_loaded")
            history = await self.progress.lesson_context(self.customer_id)
            if self.business:
                history += await asyncio.to_thread(
                    self.business.lesson_context, self.customer_id, self.settings.student_id,
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
                    self.business.reserve_call, self.customer_id, self.settings.student_id,
                    self.start.call_id, allowed_seconds,
                )
                allowed_seconds = allowance["seconds"]
                await self._latency("access_checked", {"mode": allowance["mode"]})
                if not allowed_seconds:
                    await self.pbx.send_text(transfer_command(allowance["extension"]))
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
                async with GeminiLive(
                    self.settings, setup_payload=artifact.setup_message
                ) as ai:
                    await self._latency("gemini_connected")
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
        except (TimeoutError, CallEnded, WebSocketDisconnect):
            pass
        finally:
            if self.business:
                billed = (time.monotonic() - self._meter_started) if self._meter_started else 0
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

    async def _bridge(self, ai: GeminiLive) -> None:
        tasks = {
            asyncio.create_task(self._pbx_to_ai(ai), name="pbx-to-gemini"),
            asyncio.create_task(self._ai_to_queue(ai), name="gemini-to-pbx-queue"),
            asyncio.create_task(self._paced_output(), name="paced-pbx-output"),
        }
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

    async def _pbx_to_ai(self, ai: GeminiLive) -> None:
        batch: list[bytes] = []
        while True:
            message = await self.pbx.receive()
            if message.get("type") == "websocket.disconnect":
                raise CallEnded
            audio = message.get("bytes")
            if audio is not None:
                if len(audio) > 128 * 1024:
                    raise CallEnded("oversized audio frame")
                if len(audio) % 2:
                    LOGGER.warning("Dropping odd-length PCM frame for call %s", self.start.call_id)
                    continue
                if not self._first_pbx_audio_seen:
                    self._first_pbx_audio_seen = True
                    await self._latency("first_pbx_audio")
                batch.append(audio)
                if len(batch) >= self.settings.gemini_input_batch_frames:
                    pcm16k = upsample_8k_to_16k(b"".join(batch))
                    self.input_audio_bytes += len(pcm16k)
                    await ai.send_audio(pcm16k)
                    batch.clear()
                continue
            text = message.get("text")
            if not text:
                continue
            try:
                control = json.loads(text)
            except json.JSONDecodeError:
                continue
            if str(control.get("type", "")).lower() in {"stop", "hangup", "end"}:
                raise CallEnded

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
                    details={
                        "names": [str(call.get("name", "")) for call in event["calls"]]
                    },
                )
                for call in event["calls"]:
                    saved = self._record_tool_call(call)
                    await ai.submit_tool_result(call, saved)
            elif kind == "usage":
                self._record_usage(event["usage"])
            elif kind == "go_away":
                LOGGER.warning("Gemini requested session close: %s", event.get("detail"))
                raise CallEnded
        raise CallEnded

    async def _latency(
        self, event_name: str, details: dict[str, object] | None = None
    ) -> None:
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
                await self._latency(
                    "first_audio_sent_to_phone",
                    {"queue_frames": len(self._out), "customer_id": self.customer_id,
                     "tutor_turn": turn},
                )

    def _enqueue(self, pcm8: bytes) -> None:
        data = self._partial + pcm8
        whole = len(data) - (len(data) % FRAME_BYTES)
        for offset in range(0, whole, FRAME_BYTES):
            self._out.append((self.tutor_turns + 1, data[offset : offset + FRAME_BYTES]))
        self._partial = data[whole:]

    def _record_tool_call(self, call: dict) -> bool:
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
        self.input_text_tokens += self._modality_tokens(
            usage.get("promptTokensDetails"), "TEXT"
        )
        self.input_audio_tokens += self._modality_tokens(
            usage.get("promptTokensDetails"), "AUDIO"
        )
        self.output_text_tokens += self._modality_tokens(
            usage.get("responseTokensDetails"), "TEXT"
        )
        self.output_audio_tokens += self._modality_tokens(
            usage.get("responseTokensDetails"), "AUDIO"
        )
        self.thoughts_tokens += self._safe_nonnegative_int(
            usage.get("thoughtsTokenCount")
        )

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
