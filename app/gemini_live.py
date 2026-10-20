from __future__ import annotations

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


def build_setup_payload(settings: Settings) -> dict[str, Any]:
    generation_config: dict[str, Any] = {
        "responseModalities": ["AUDIO"],
        "speechConfig": {
            "languageCode": settings.gemini_language_code,
            "voiceConfig": {
                "prebuiltVoiceConfig": {"voiceName": settings.gemini_voice}
            },
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
                {"functionDeclarations": [OBSERVATION_TOOL, LESSON_SUMMARY_TOOL]}
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
        self.socket = await connect(
            f"{self.settings.gemini_live_url}?key={key}",
            max_size=None,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=5,
        )
        await self._send(self.setup_payload)
        await self.socket.recv()  # setupComplete
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self.socket is not None:
            await self.socket.close()

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
                            "parts": [
                                {
                                    "text": self.settings.tutor_opening_message
                                }
                            ],
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
