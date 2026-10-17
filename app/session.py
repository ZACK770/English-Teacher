from __future__ import annotations

import asyncio
import collections
import json
import logging
import time
from datetime import UTC, datetime

from fastapi import WebSocket, WebSocketDisconnect

from .audio import downsample_24k_to_8k, upsample_8k_to_16k
from .config import Settings
from .gemini_live import GeminiLive
from .progress import Observation, ProgressStore
from .technoline import StartFrame

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
    ) -> None:
        self.pbx = pbx
        self.start = start
        self.settings = settings
        self.progress = progress
        self.started_at = datetime.now(UTC)
        self.learner_turns = 0
        self.tutor_turns = 0
        self.observations: list[Observation] = []
        self.transcript: list[dict[str, str]] = []
        self._out: collections.deque[bytes] = collections.deque()
        self._partial = b""
        self._resample_carry = b""
        self._learner_seen_this_turn = False

    async def run(self) -> None:
        try:
            async with asyncio.timeout(self.settings.max_call_minutes * 60):
                history = await self.progress.lesson_context(self.settings.student_id)
                live_settings = self.settings.model_copy(
                    update={"tutor_prompt": self.settings.tutor_prompt + history}
                )
                async with GeminiLive(live_settings) as ai:
                    await ai.start_greeting()
                    await self._bridge(ai)
        except (TimeoutError, CallEnded, WebSocketDisconnect):
            pass
        finally:
            await self.progress.save_session(
                student_id=self.settings.student_id,
                call_id=self.start.call_id,
                started_at=self.started_at,
                learner_turns=self.learner_turns,
                tutor_turns=self.tutor_turns,
                observations=self.observations,
                transcript=self.transcript if self.settings.store_transcripts else None,
            )

    async def _bridge(self, ai: GeminiLive) -> None:
        tasks = {
            asyncio.create_task(self._pbx_to_ai(ai), name="pbx-to-gemini"),
            asyncio.create_task(self._ai_to_queue(ai), name="gemini-to-pbx-queue"),
            asyncio.create_task(self._paced_output(), name="paced-pbx-output"),
        }
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            exception = task.exception()
            if exception and not isinstance(exception, (CallEnded, WebSocketDisconnect)):
                raise exception

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
                batch.append(audio)
                if len(batch) >= self.settings.gemini_input_batch_frames:
                    await ai.send_audio(upsample_8k_to_16k(b"".join(batch)))
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
                pcm8, self._resample_carry = downsample_24k_to_8k(
                    event["pcm24k"], self._resample_carry
                )
                self._enqueue(pcm8)
            elif kind == "interrupted":
                self._out.clear()
                self._partial = b""
                self._resample_carry = b""
            elif kind == "transcript":
                role = str(event["role"])
                transcript = str(event["text"]).strip()
                if not transcript:
                    continue
                self.transcript.append({"role": role, "text": transcript})
                if role == "learner" and not self._learner_seen_this_turn:
                    self.learner_turns += 1
                    self._learner_seen_this_turn = True
            elif kind == "turn_complete":
                self.tutor_turns += 1
                self._learner_seen_this_turn = False
            elif kind == "tool_call":
                for call in event["calls"]:
                    saved = self._record_observation(call)
                    await ai.submit_tool_result(call, saved)
            elif kind == "go_away":
                LOGGER.warning("Gemini requested session close: %s", event.get("detail"))
                raise CallEnded
        raise CallEnded

    async def _paced_output(self) -> None:
        next_tick = time.monotonic()
        while True:
            next_tick += FRAME_SECONDS
            await asyncio.sleep(max(0, next_tick - time.monotonic()))
            frame = self._out.popleft() if self._out else SILENCE_FRAME
            await self.pbx.send_bytes(frame)

    def _enqueue(self, pcm8: bytes) -> None:
        data = self._partial + pcm8
        whole = len(data) - (len(data) % FRAME_BYTES)
        for offset in range(0, whole, FRAME_BYTES):
            self._out.append(data[offset : offset + FRAME_BYTES])
        self._partial = data[whole:]

    def _record_observation(self, call: dict) -> bool:
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
