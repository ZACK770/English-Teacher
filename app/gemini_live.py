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


class GeminiLive:
    """Small server-to-server Gemini Live client with normalized events."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
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
        await self._send(
            {
                "setup": {
                    "model": self.settings.gemini_live_model,
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {
                            "languageCode": self.settings.gemini_language_code,
                            "voiceConfig": {
                                "prebuiltVoiceConfig": {"voiceName": self.settings.gemini_voice}
                            },
                        },
                    },
                    "systemInstruction": {
                        "parts": [{"text": self.settings.tutor_prompt}]
                    },
                    "inputAudioTranscription": {},
                    "outputAudioTranscription": {},
                    "tools": [{"functionDeclarations": [OBSERVATION_TOOL]}],
                    "contextWindowCompression": {
                        "triggerTokens": 12000,
                        "slidingWindow": {"targetTokens": 6000},
                    },
                    "realtimeInputConfig": {
                        "automaticActivityDetection": {
                            "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
                            "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
                            "prefixPaddingMs": self.settings.gemini_vad_prefix_ms,
                            "silenceDurationMs": self.settings.gemini_vad_silence_ms,
                        },
                        "activityHandling": "START_OF_ACTIVITY_INTERRUPTS",
                    },
                }
            }
        )
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
                                    "text": (
                                        "Start the lesson now. Greet the learner briefly and offer "
                                        "free conversation or a short challenge."
                                    )
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
