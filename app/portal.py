from __future__ import annotations

import asyncio
import base64
import io
import secrets
import time
import wave

from fastapi import Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .auth import bearer_value
from .controls import TutorControls
from .gemini_live import GeminiLive
from .prompting import compile_prompt
from .session import TutorSession
from .technoline import StartFrame


class TextTurn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def install_portal_api(app, static_path):
    async def customer(authorization):
        token = bearer_value(authorization)
        customer_id = await asyncio.to_thread(app.state.business.portal_customer, token or "")
        if not customer_id:
            raise HTTPException(401, "קישור הכניסה אינו תקין או שפג תוקפו")
        return customer_id

    @app.get("/learn", response_class=HTMLResponse)
    async def portal_page():
        return HTMLResponse(
            (static_path / "portal.html").read_text(encoding="utf-8"),
            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                     "Content-Security-Policy": "default-src 'self'; media-src blob:; "
                     "script-src 'self'; style-src 'self'; frame-ancestors 'none'"},
        )

    @app.get("/v1/portal/me")
    async def me(authorization: str | None = Header(default=None)):
        customer_id = await customer(authorization)
        detail = await asyncio.to_thread(app.state.business.customer_detail, customer_id)
        detail["customer"] = {k: detail["customer"][k]
                              for k in ("id", "name", "phone", "preferred_bot")}
        progress = await app.state.progress.report(customer_id)
        bots = await app.state.progress.list_bots()
        detail["bots"] = [{"id": b["id"], "label": b["label"], "role": b["role"]}
                          for b in bots if b["enabled"] and b["role"] in ("teacher", "translator")]
        detail["progress"] = progress
        detail["enrollments"] = [e for e in await asyncio.to_thread(
            app.state.business.list, "enrollments"
        ) if e["customer_id"] == customer_id]
        return detail

    @app.post("/v1/bots/{bot_id}/turn")
    async def turn(
        bot_id: str, body: TextTurn, authorization: str | None = Header(default=None),
    ):
        customer_id = await customer(authorization)
        bot = await app.state.progress.get_bot(bot_id)
        if not bot or not bot["enabled"] or bot["role"] not in ("teacher", "translator"):
            raise HTTPException(404, "Bot not found")
        if app.state.call_slots.locked():
            raise HTTPException(429, "כל המורים תפוסים כרגע. נסה שוב בעוד רגע")
        async with app.state.call_slots:
            return await run_turn(bot_id, customer_id, body.text)

    async def run_turn(bot_id, customer_id, text):
        settings = app.state.settings.model_copy(update={"student_id": bot_id})
        defaults = TutorControls.from_settings(settings)
        if bot_id == settings.adult_student_id:
            defaults = TutorControls.adult_from_settings(settings)
        controls = await app.state.progress.load_tutor_controls(bot_id, defaults)
        call_id = "web-" + secrets.token_hex(12)
        allowance = await asyncio.to_thread(
            app.state.business.reserve_call, customer_id, bot_id, call_id, 120,
        )
        if not allowance["seconds"]:
            raise HTTPException(402, "אין יתרת שימוש זמינה. פנה לשירות לרכישת חבילה")
        await asyncio.to_thread(
            app.state.business.register_web_call, call_id, customer_id, bot_id,
        )
        history = await app.state.progress.lesson_context(customer_id)
        history += await asyncio.to_thread(
            app.state.business.lesson_context, customer_id, bot_id,
        )
        artifact = compile_prompt(
            controls=controls.model_copy(update={"opening_message": text}),
            history_context=history, settings=settings, profile_id=bot_id,
        )
        session = TutorSession(
            pbx=None, start=StartFrame(call_id, "", "web", 8000, 1),
            settings=artifact.runtime_settings, progress=app.state.progress,
        )
        session.customer_id = customer_id
        session.learner_turns = 1
        output = []
        audio = bytearray()
        started = None
        try:
            await app.state.progress.save_prompt_snapshot(
                profile_id=bot_id, call_id=call_id, artifact=artifact,
            )
            await app.state.progress.log_conversation_turn(
                profile_id=bot_id, call_id=call_id, direction="input", text=text,
            )
            await session._latency("session_started", {"channel": "web"})
            async with asyncio.timeout(min(120, allowance["seconds"]) + 15), GeminiLive(
                artifact.runtime_settings, setup_payload=artifact.setup_message,
            ) as ai:
                started = time.monotonic()
                await session._latency("gemini_connected")
                await ai.start_greeting()
                async for event in ai.events():
                    if event["type"] == "audio":
                        if len(audio) + len(event["pcm24k"]) > 24000 * 2 * allowance["seconds"]:
                            break
                        if not audio:
                            await session._latency("first_gemini_audio")
                        audio.extend(event["pcm24k"])
                        session.output_audio_bytes += len(event["pcm24k"])
                    elif event["type"] == "transcript" and event["role"] == "tutor":
                        output.append(event["text"])
                        await app.state.progress.log_conversation_turn(
                            profile_id=bot_id, call_id=call_id,
                            direction="output", text=event["text"],
                        )
                    elif event["type"] == "usage":
                        session._record_usage(event["usage"])
                    elif event["type"] == "tool_call":
                        for call in event["calls"]:
                            await ai.submit_tool_result(call, session._record_tool_call(call))
                    elif event["type"] == "turn_complete":
                        session.tutor_turns = 1
                        await session._latency("tutor_turn_complete")
                        break
        except Exception as exc:
            await app.state.progress.log_diagnostic(
                profile_id=bot_id, call_id=call_id, event_type="web_turn_failed",
                details={"error_type": type(exc).__name__},
            )
            raise HTTPException(502, "המורה לא הצליח להשיב כרגע. נסה שוב") from exc
        finally:
            elapsed = time.monotonic() - started if started else 0
            await asyncio.to_thread(app.state.business.settle_call, call_id, elapsed)
            await app.state.progress.save_session(
                student_id=customer_id, call_id=call_id,
                started_at=session.started_at, learner_turns=1,
                tutor_turns=session.tutor_turns, observations=session.observations,
                transcript=[{"role": "learner", "text": text},
                            {"role": "tutor", "text": " ".join(output)}],
                summary=session.lesson_summary or session._fallback_summary(),
                usage=session._usage_totals(), model=controls.model,
            )
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(bytes(audio))
        return {"call_id": call_id, "text": " ".join(output),
                "audio_wav_base64": base64.b64encode(buffer.getvalue()).decode()}
