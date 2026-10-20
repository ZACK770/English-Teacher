from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator
from types import TracebackType
from typing import Any

from websockets.asyncio.client import ClientConnection, connect

from .config import Settings

LOGGER = logging.getLogger(__name__)

OBSERVATION_TOOL = {
    "name": "record_learning_observation",
    "description": "Record one short, privacy-safe learning assessment.",
    "parameters": {
        "type": "object",
        "properties": {
            "skill": {
                "type": "string",
                "enum": ["fluency", "grammar", "vocabulary", "pronunciation", "comprehension"],
            },
            "result": {"type": "string", "description": "What the learner did well"},
            "correction": {"type": "string", "description": "A concise correction if needed"},
            "score": {"type": "integer", "minimum": 1, "maximum": 5},
        },
        "required": ["skill", "result", "correction", "score"],
    },
}

LESSON_SUMMARY_TOOL = {
    "name": "record_lesson_summary",
    "description": "Save the Hebrew end-of-lesson summary and the points awarded.",
    "parameters": {
        "type": "object",
        "properties": {
            "summary_he": {
                "type": "string",
                "description": "A short Hebrew summary of what was practiced",
            },
            "success_he": {
                "type": "string",
                "description": "A short Hebrew description of what went well",
            },
            "next_step_he": {
                "type": "string",
                "description": "One concrete next step in Hebrew",
            },
            "points": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": "Encouraging lesson points based on observed effort and success",
            },
        },
        "required": ["summary_he", "success_he", "next_step_he", "points"],
    },
}


END_SESSION_TOOL = {
    "name": "end_session",
    "description": (
        "Immediately end this AI session and release its connection. Call after saying "
        "a brief final goodbye when the caller asks to stop or the permitted task is done. "
        "Do not leave a finished conversation running. The server controls phone disposition."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "enum": [
                    "caller_requested",
                    "task_completed",
                    "no_response",
                ],
            }
        },
        "required": ["reason"],
    },
}


def build_setup_payload(settings: Settings) -> dict[str, Any]:
    generation_config: dict[str, Any] = {
        "responseModalities": ["AUDIO"],
        "speechConfig": {
            "languageCode": settings.gemini_language_code,
            "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": settings.gemini_voice}},
        },
    }
    if settings.gemini_temperature is not None:
        generation_config["temperature"] = settings.gemini_temperature

    input_transcription: dict[str, Any] = {
        "mode": settings.gemini_transcription_mode,
    }
    if settings.gemini_transcription_language_codes:
        input_transcription["languageCodes"] = settings.gemini_transcription_language_codes
    if settings.gemini_custom_vocabulary:
        input_transcription["customVocabulary"] = settings.gemini_custom_vocabulary

    return {
        "setup": {
            "model": settings.gemini_live_model,
            "generationConfig": generation_config,
            "systemInstruction": {"parts": [{"text": settings.tutor_prompt}]},
            "inputAudioTranscription": input_transcription,
            "outputAudioTranscription": {},
            "tools": [
                {"functionDeclarations": [OBSERVATION_TOOL, LESSON_SUMMARY_TOOL, END_SESSION_TOOL]}
            ],
            "contextWindowCompression": {
                "triggerTokens": settings.gemini_context_trigger_tokens,
                "slidingWindow": {"targetTokens": settings.gemini_context_target_tokens},
            },
            "realtimeInputConfig": {
                "automaticActivityDetection": {
                    "startOfSpeechSensitivity": settings.gemini_vad_start_sensitivity,
                    "endOfSpeechSensitivity": settings.gemini_vad_end_sensitivity,
                    "prefixPaddingMs": settings.gemini_vad_prefix_ms,
                    "silenceDurationMs": settings.gemini_vad_silence_ms,
                },
                "activityHandling": settings.gemini_activity_handling,
                "turnCoverage": settings.gemini_turn_coverage,
            },
        }
    }


class GeminiLive:
    """Small server-to-server Gemini Live client with normalized events."""

    def __init__(
        self,
        settings: Settings,
        *,
        setup_payload: dict[str, Any] | None = None,
    ) -> None:
        self.settings = settings
        self.setup_payload = setup_payload or build_setup_payload(settings)
        self.socket: ClientConnection | None = None

    async def __aenter__(self) -> GeminiLive:
        key = self.settings.gemini_api_key.get_secret_value()
        try:
            async with asyncio.timeout(20):
                self.socket = await connect(
                    f"{self.settings.gemini_live_url}?key={key}",
                    max_size=None,
                    open_timeout=10,
                    ping_interval=20,
                    ping_timeout=20,
                    close_timeout=3,
                )
                await self._send(self.setup_payload)
                response = json.loads(await self.socket.recv())
                if "setupComplete" not in response:
                    raise RuntimeError("Gemini setup was not acknowledged")
        except BaseException:
            # __aexit__ is NOT called if __aenter__ fails or is cancelled.
            await self.close()
            raise
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        socket, self.socket = self.socket, None
        if socket is None:
            return
        try:
            async with asyncio.timeout(4):
                await socket.close()
        finally:
            # A stuck closing handshake must not leave a transport/session alive.
            transport = getattr(socket, "transport", None)
            if transport is not None:
                transport.abort()

    async def _send(self, payload: dict[str, Any]) -> None:
        if self.socket is None:
            raise RuntimeError("Gemini Live socket is not connected")
        await self.socket.send(json.dumps(payload, separators=(",", ":")))

    async def send_audio(self, pcm16k: bytes) -> None:
        await self._send(
            {
                "realtimeInput": {
                    "audio": {
                        "mimeType": "audio/pcm;rate=16000",
                        "data": base64.b64encode(pcm16k).decode("ascii"),
                    }
                }
            }
        )

    async def start_greeting(self) -> None:
        await self._send(
            {
                "clientContent": {
                    "turns": [
                        {
                            "role": "user",
                            "parts": [{"text": self.settings.tutor_opening_message}],
                        }
                    ],
                    "turnComplete": True,
                }
            }
        )

    async def submit_tool_result(self, call: dict[str, Any], saved: bool) -> None:
        response = {
            "id": call.get("id"),
            "name": call.get("name"),
            "response": {"saved": saved},
        }
        await self._send({"toolResponse": {"functionResponses": [response]}})

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        if self.socket is None:
            raise RuntimeError("Gemini Live socket is not connected")
        async for raw in self.socket:
            text = raw if isinstance(raw, str) else raw.decode("utf-8", "replace")
            try:
                event = json.loads(text)
            except ValueError:
                LOGGER.warning("Gemini sent a non-JSON frame")
                continue
            usage = event.get("usageMetadata")
            if usage:
                yield {"type": "usage", "usage": usage}
            calls = (event.get("toolCall") or {}).get("functionCalls")
            if calls:
                yield {"type": "tool_call", "calls": calls}
            server = event.get("serverContent") or {}
            if server.get("interrupted"):
                yield {"type": "interrupted"}
            for key, role in (("inputTranscription", "learner"), ("outputTranscription", "tutor")):
                transcript = str((server.get(key) or {}).get("text", "")).strip()
                if transcript:
                    yield {"type": "transcript", "role": role, "text": transcript}
            for part in (server.get("modelTurn") or {}).get("parts", []):
                inline = part.get("inlineData")
                if inline and inline.get("data"):
                    yield {"type": "audio", "pcm24k": base64.b64decode(inline["data"])}
            if server.get("turnComplete"):
                yield {"type": "turn_complete"}
            if "goAway" in event:
                yield {"type": "go_away", "detail": event["goAway"]}
