from __future__ import annotations

import asyncio
import hashlib
import io
import secrets
import time
import wave
from datetime import UTC, datetime

from fastapi import Header, HTTPException
from fastapi.responses import Response

from .audio import downsample_24k_to_8k
from .controls import TutorControls
from .gemini_live import GeminiLive
from .progress import LessonSummary, UsageTotals
from .prompting import compile_prompt


def install_narration_api(app, require_admin):
    @app.post("/v1/admin/narrations/{narration_id}/audio")
    async def render_audio(
        narration_id: str, authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        business = app.state.business
        records = await asyncio.to_thread(business.list, "narrations")
        record = next((r for r in records if r["id"] == narration_id), None)
        if not record:
            raise HTTPException(404, "Narration not found")
        settings = app.state.settings
        profile_id = record["bot_id"] or settings.student_id
        controls = await app.state.progress.load_tutor_controls(
            profile_id, TutorControls.from_settings(settings),
        )
        controls = controls.model_copy(update={
            "base_prompt": (
                "You are a professional voice announcer. Read the supplied text exactly, "
                "without additions, introductions, comments, or changing any wording. "
                "Use the language of the supplied text. Do not call tools."
            ),
            "opening_message": record["text"],
            "language_code": record["language"],
            "learning_goal": "", "custom_instructions": "",
        })
        artifact = compile_prompt(
            controls=controls, history_context="", settings=settings, profile_id=profile_id,
        )
        call_id = "narration-" + secrets.token_hex(12)
        await app.state.progress.save_prompt_snapshot(
            profile_id=profile_id, call_id=call_id, artifact=artifact,
        )
        start = time.monotonic()
        audio = bytearray()
        transcript = []
        usage = {}
        try:
            async with asyncio.timeout(120), GeminiLive(
                artifact.runtime_settings, setup_payload=artifact.setup_message,
            ) as ai:
                await ai.start_greeting()
                async for event in ai.events():
                    if event["type"] == "audio":
                        if len(audio) + len(event["pcm24k"]) > 24_000 * 2 * 120:
                            raise ValueError("Narration exceeded audio limit")
                        if not audio:
                            await app.state.progress.log_latency(
                                profile_id=profile_id, call_id=call_id,
                                event_name="first_gemini_audio",
                                since_call_start_ms=(time.monotonic() - start) * 1000,
                                since_previous_ms=0,
                            )
                        audio.extend(event["pcm24k"])
                    elif event["type"] == "transcript":
                        transcript.append(event["text"])
                        await app.state.progress.log_conversation_turn(
                            profile_id=profile_id, call_id=call_id, direction="output",
                            text=event["text"],
                        )
                    elif event["type"] == "usage":
                        usage = event["usage"]
                    elif event["type"] == "tool_call":
                        for call in event["calls"]:
                            await ai.submit_tool_result(call, False)
                    elif event["type"] == "turn_complete":
                        break
            if not audio:
                raise ValueError("No audio received")
        except Exception as exc:
            await app.state.progress.log_diagnostic(
                profile_id=profile_id, call_id=call_id, event_type="narration_failed",
                details={"error_type": type(exc).__name__},
            )
            raise HTTPException(502, "לא ניתן לייצר קריינות כרגע; בדוק את לוג הבוט") from exc
        pcm8, _ = downsample_24k_to_8k(bytes(audio))
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(8000)
            wav.writeframes(pcm8)
        result = buffer.getvalue()
        fingerprint = hashlib.sha256(record["text"].encode()).hexdigest()
        await asyncio.to_thread(business.save_audio, narration_id, fingerprint, result)
        duration = len(audio) / (24000 * 2)
        cost = duration / 60 * settings.gemini_output_audio_usd_per_minute
        await app.state.progress.save_session(
            student_id="system:narration", call_id=call_id,
            started_at=datetime.now(UTC), learner_turns=1, tutor_turns=1,
            observations=[], transcript=[{"role": "tutor", "text": " ".join(transcript)}],
            summary=LessonSummary("ייצור קריינות", "", "", 0),
            usage=UsageTotals(estimated_cost_usd=cost, cost_basis="narration_duration_estimate"),
            model=controls.model,
        )
        await app.state.progress.log_diagnostic(
            profile_id=profile_id, call_id=call_id, event_type="narration_generated",
            details={"duration_seconds": duration, "usage_metadata": usage},
        )
        return Response(result, media_type="audio/wav", headers={"Cache-Control": "no-store"})

    @app.get("/v1/admin/narrations/{narration_id}/audio")
    async def get_audio(
        narration_id: str, authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        audio = await asyncio.to_thread(app.state.business.get_audio, narration_id)
        records = await asyncio.to_thread(app.state.business.list, "narrations")
        record = next((r for r in records if r["id"] == narration_id), None)
        if not audio or not record:
            raise HTTPException(404, "No generated narration")
        fingerprint = hashlib.sha256(record["text"].encode()).hexdigest()
        if audio["text_hash"] != fingerprint:
            raise HTTPException(409, "הנוסח השתנה. יש לייצר את הקריינות מחדש")
        return Response(audio["wav"], media_type="audio/wav",
                        headers={"Cache-Control": "no-store"})
