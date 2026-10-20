from __future__ import annotations

import asyncio
import logging
import secrets
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .auth import bearer_value, ip_is_allowed, secure_equal
from .bots import BotCreate, BotUpdate
from .business import BusinessStore, install_business_api
from .config import Settings, get_settings
from .controls import VOICE_OPTIONS, TutorControls
from .dashboard import dashboard_html
from .narration import install_narration_api
from .pbx import install_pbx_api, seed_project
from .portal import install_portal_api
from .progress import ProgressStore
from .prompting import compile_prompt
from .session import TutorSession
from .technoline import ProtocolError, parse_start_frame

LOGGER = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        active_settings = configured or get_settings()
        logging.basicConfig(
            level=getattr(logging, active_settings.log_level.upper(), logging.INFO),
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
        store = ProgressStore(
            active_settings.database_path,
            legacy_profile_id=active_settings.student_id,
        )
        await store.initialize()
        app.state.business = BusinessStore(active_settings.database_path)
        await asyncio.to_thread(app.state.business.initialize)
        await store.seed_bot(
            bot_id=active_settings.student_id,
            label="המורה של הבת",
            audience="child",
            channel_id=active_settings.technoline_channel_id,
            controls=TutorControls.from_settings(active_settings),
        )
        await store.seed_bot(
            bot_id=active_settings.adult_student_id,
            label="המורה שלי",
            audience="adult",
            channel_id=active_settings.technoline_adult_channel_id,
            controls=TutorControls.adult_from_settings(active_settings),
        )
        app.state.settings = active_settings
        app.state.progress = store
        await seed_project(app, active_settings, store)
        app.state.call_slots = asyncio.Semaphore(active_settings.max_concurrent_calls)
        yield

    app = FastAPI(title="Technoline English Tutor", version="1.0.0", lifespan=lifespan)
    static_path = Path(__file__).parent / "static"
    app.mount("/console-assets", StaticFiles(directory=static_path), name="console-assets")

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> dict[str, str]:
        active: Settings = app.state.settings
        if not active.gemini_api_key.get_secret_value():
            raise HTTPException(status_code=503, detail="Gemini is not configured")
        return {"status": "ready"}

    @app.get("/dashboard", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        return HTMLResponse(
            (static_path / "console.html").read_text(encoding="utf-8"),
            headers={
                "Cache-Control": "no-store",
                "Content-Security-Policy": (
                    "default-src 'none'; style-src 'self' 'unsafe-inline'; "
                    "script-src 'self'; connect-src 'self'; img-src 'self' data:; "
                    "media-src 'self' blob:; "
                    "base-uri 'none'; form-action 'none'"
                ),
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
            },
        )

    @app.get("/dashboard/legacy", response_class=HTMLResponse)
    async def legacy_dashboard():
        return HTMLResponse(dashboard_html(), headers={"Cache-Control": "no-store"})

    def require_admin(authorization: str | None) -> None:
        active: Settings = app.state.settings
        token = bearer_value(authorization)
        if not secure_equal(token, active.admin_bearer_secret.get_secret_value()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    install_business_api(app, require_admin)
    install_narration_api(app, require_admin)
    install_portal_api(app, static_path)
    install_pbx_api(app, require_admin)

    async def require_profile(profile_id: str) -> dict[str, object]:
        profile = await app.state.progress.get_bot(profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="Tutor profile not found")
        return profile

    def default_controls(profile_id: str) -> TutorControls:
        active: Settings = app.state.settings
        if profile_id == active.adult_student_id:
            return TutorControls.adult_from_settings(active)
        return TutorControls.from_settings(active)

    async def admin_config_payload(profile_id: str) -> dict:
        active: Settings = app.state.settings
        profile = await require_profile(profile_id)
        defaults = default_controls(profile_id)
        controls = await app.state.progress.load_tutor_controls(profile_id, defaults)
        history = ""
        artifact = compile_prompt(
            controls=controls,
            history_context=history,
            settings=active,
            profile_id=profile_id,
        )
        return {
            "profile": profile,
            "controls": controls.model_dump(),
            "options": {
                "voices": VOICE_OPTIONS,
                "vad_start_sensitivity": [
                    "START_SENSITIVITY_LOW",
                    "START_SENSITIVITY_HIGH",
                ],
                "vad_end_sensitivity": [
                    "END_SENSITIVITY_LOW",
                    "END_SENSITIVITY_HIGH",
                ],
                "activity_handling": [
                    "START_OF_ACTIVITY_INTERRUPTS",
                    "NO_INTERRUPTION",
                ],
                "turn_coverage": [
                    "TURN_COVERAGE_UNSPECIFIED",
                    "TURN_INCLUDES_ONLY_ACTIVITY",
                    "TURN_INCLUDES_ALL_INPUT",
                    "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO",
                ],
                "transcription_mode": ["VERBATIM", "SMART"],
            },
            "effective": {
                "setup_message": artifact.setup_message,
                "opening_client_message": {
                    "clientContent": {
                        "turns": [
                            {
                                "role": "user",
                                "parts": [{"text": controls.opening_message}],
                            }
                        ],
                        "turnComplete": True,
                    }
                },
                "history_context": history,
                "prompt_fingerprint": artifact.fingerprint,
                "read_only_runtime": {
                    "profile_id": profile_id,
                    "profile_label": profile["label"],
                    "technoline_websocket_path": profile["websocket_path"],
                    "technoline_channel_configured": profile["channel_configured"],
                    "websocket_endpoint": active.gemini_live_url,
                    "automatic_activity_detection": "enabled",
                    "automatic_activity_detection_editable": False,
                    "reason_not_editable": (
                        "Disabling it requires a client-side VAD implementation that sends "
                        "activityStart and activityEnd signals."
                    ),
                    "pbx_input": "PCM16LE mono 8000Hz",
                    "gemini_input": "PCM16LE mono 16000Hz",
                    "gemini_output": "PCM16LE mono 24000Hz",
                    "pbx_output": "PCM16LE mono 8000Hz, paced in 20ms frames",
                    "speaking_rate_control": "not exposed by Gemini Live",
                    "session_resumption": "not implemented",
                },
            },
        }

    @app.get("/v1/admin/profiles")
    async def get_admin_profiles(
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        profiles = await app.state.progress.list_bots()
        return {
            "profiles": profiles
        }

    @app.post("/v1/admin/bots", status_code=201)
    async def create_admin_bot(
        bot: BotCreate,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        active: Settings = app.state.settings
        controls = TutorControls.from_settings(active)
        if bot.role == "translator":
            controls = controls.model_copy(update={
                "base_prompt": (
                    "You are a concise telephone translator. Translate Hebrew speech to English "
                    "and other languages to Hebrew unless the caller selects another target. "
                    "Return only the translation. Do not add lessons, commentary or quizzes. "
                    "Ask briefly for clarification only if the input cannot be understood."
                ),
                "opening_message": "אמרו למתקשר בעברית: שלום, נא לומר את המשפט לתרגום.",
                "max_call_minutes": 5,
            })
        try:
            created = await app.state.progress.create_bot(
                bot, controls
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Bot id already exists") from exc
        return {"bot": created, "config": await admin_config_payload(bot.id)}

    @app.post("/v1/admin/bots/{bot_id}/duplicate", status_code=201)
    async def duplicate_bot(
        bot_id: str, bot: BotCreate,
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        await require_profile(bot_id)
        controls = await app.state.progress.load_tutor_controls(bot_id, default_controls(bot_id))
        try:
            created = await app.state.progress.create_bot(bot, controls)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Bot id already exists") from exc
        return {"bot": created}

    @app.put("/v1/admin/bots/{bot_id}")
    async def update_admin_bot(
        bot_id: str,
        update: BotUpdate,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        await require_profile(bot_id)
        try:
            bot = await app.state.progress.update_bot(bot_id, update)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Bot not found") from exc
        return {"bot": bot}

    @app.get("/v1/admin/bots/{bot_id}/versions")
    async def get_bot_versions(
        bot_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        await require_profile(bot_id)
        return {"bot_id": bot_id, "versions": await app.state.progress.bot_versions(bot_id)}

    @app.post("/v1/admin/bots/{bot_id}/restore/{version}")
    async def restore_bot(
        bot_id: str, version: int, authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        await require_profile(bot_id)
        versions = await app.state.progress.bot_versions(bot_id, limit=100)
        selected = next((v for v in versions if v["version"] == version), None)
        if selected is None:
            raise HTTPException(404, "Version not found")
        await app.state.progress.save_tutor_controls(
            bot_id, TutorControls.model_validate(selected["controls"])
        )
        return await admin_config_payload(bot_id)

    @app.post("/v1/admin/bots/{bot_id}/preview")
    async def preview_bot(
        bot_id: str, controls: TutorControls,
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        await require_profile(bot_id)
        return compile_prompt(
            controls=controls, history_context="", settings=app.state.settings,
            profile_id=bot_id,
        ).public_payload()

    @app.get("/v1/admin/config")
    async def get_admin_config(
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        return await admin_config_payload(app.state.settings.student_id)

    @app.get("/v1/admin/config/{profile_id}")
    async def get_profile_admin_config(
        profile_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        return await admin_config_payload(profile_id)

    @app.put("/v1/admin/config")
    async def update_admin_config(
        controls: TutorControls,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        profile_id = app.state.settings.student_id
        await app.state.progress.save_tutor_controls(profile_id, controls)
        return await admin_config_payload(profile_id)

    @app.put("/v1/admin/config/{profile_id}")
    async def update_profile_admin_config(
        profile_id: str,
        controls: TutorControls,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        await require_profile(profile_id)
        await app.state.progress.save_tutor_controls(profile_id, controls)
        return await admin_config_payload(profile_id)

    @app.delete("/v1/admin/config")
    async def reset_admin_config(
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        profile_id = app.state.settings.student_id
        await app.state.progress.save_tutor_controls(
            profile_id, default_controls(profile_id)
        )
        return await admin_config_payload(profile_id)

    @app.delete("/v1/admin/config/{profile_id}")
    async def reset_profile_admin_config(
        profile_id: str,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        await require_profile(profile_id)
        await app.state.progress.save_tutor_controls(
            profile_id, default_controls(profile_id)
        )
        return await admin_config_payload(profile_id)

    @app.get("/v1/progress/{student_id}")
    async def progress_report(
        student_id: str, authorization: str | None = Header(default=None)
    ) -> dict:
        require_admin(authorization)
        await require_profile(student_id)
        return await app.state.progress.report(student_id)

    @app.get("/v1/admin/diagnostics/{profile_id}")
    async def diagnostic_report(
        profile_id: str,
        limit: int = 100,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        await require_profile(profile_id)
        return {
            "profile_id": profile_id,
            "privacy": "Metadata only; no audio or transcript text is stored here.",
            "events": await app.state.progress.recent_diagnostics(profile_id, limit),
        }

    @app.get("/v1/admin/traces/{profile_id}")
    async def trace_report(
        profile_id: str,
        limit: int = 20,
        authorization: str | None = Header(default=None),
    ) -> dict:
        require_admin(authorization)
        await require_profile(profile_id)
        return {
            "profile_id": profile_id,
            "traces": await app.state.progress.recent_traces(profile_id, limit),
        }

    async def maintain_call_lease(
        call_id: str, profile_id: str, owner_id: str
    ) -> None:
        while True:
            await asyncio.sleep(5)
            renewed = await app.state.progress.renew_call_lease(call_id, owner_id)
            if not renewed:
                LOGGER.error("Lost active-call lease for %s", call_id)
                await app.state.progress.log_diagnostic(
                    profile_id=profile_id,
                    call_id=call_id,
                    event_type="call_lease_lost",
                )
                return

    async def handle_technoline_stream(
        websocket: WebSocket, profile_id: str
    ) -> None:
        active: Settings = app.state.settings
        profile = await app.state.progress.get_bot(profile_id)
        if profile is None:
            await websocket.close(code=1008, reason="Unknown tutor profile")
            return
        if not profile["enabled"]:
            await websocket.close(code=1008, reason="Tutor profile is disabled")
            return
        expected_channel_id = profile["channel_id"]
        if not expected_channel_id:
            await websocket.close(code=1013, reason="Tutor channel is not configured")
            return
        remote_ip = websocket.client.host if websocket.client else None
        if active.technoline_enforce_bearer:
            supplied = bearer_value(websocket.headers.get("authorization"))
            configured_secret = active.technoline_bearer_secret
            expected = configured_secret.get_secret_value() if configured_secret else ""
            if not expected or not secure_equal(supplied, expected):
                LOGGER.warning(
                    "Rejected Technoline WebSocket: bearer authentication failed"
                )
                await websocket.close(code=1008, reason="Unauthorized")
                return
        if not ip_is_allowed(remote_ip, active.technoline_allowed_ips):
            await websocket.close(code=1008, reason="Forbidden")
            return

        await websocket.accept()
        slots: asyncio.Semaphore = app.state.call_slots
        if slots.locked():
            await websocket.close(code=1013, reason="All tutor lines are busy")
            return

        await slots.acquire()
        owner_id: str | None = None
        active_call_id: str | None = None
        heartbeat: asyncio.Task[None] | None = None
        try:
            first = await asyncio.wait_for(websocket.receive_text(), timeout=10)
            start = parse_start_frame(first, str(expected_channel_id))
            owner_id = secrets.token_urlsafe(18)
            active_call_id = start.call_id
            claimed = await app.state.progress.claim_call(
                call_id=start.call_id,
                profile_id=profile_id,
                owner_id=owner_id,
            )
            if not claimed:
                LOGGER.warning(
                    "Rejected duplicate Technoline call %s profile=%s",
                    start.call_id,
                    profile_id,
                )
                await app.state.progress.log_diagnostic(
                    profile_id=profile_id,
                    call_id=start.call_id,
                    event_type="duplicate_connection_rejected",
                )
                await websocket.close(code=1008, reason="Duplicate call connection")
                return
            heartbeat = asyncio.create_task(
                maintain_call_lease(start.call_id, profile_id, owner_id),
                name=f"call-lease-{start.call_id[:12]}",
            )
            LOGGER.info(
                "Accepted Technoline call %s profile=%s", start.call_id, profile_id
            )
            await app.state.progress.log_diagnostic(
                profile_id=profile_id,
                call_id=start.call_id,
                event_type="call_accepted",
                details={"endpoint": profile["websocket_path"]},
            )
            session_settings = active.model_copy(update={"student_id": profile_id})
            session = TutorSession(
                pbx=websocket,
                start=start,
                settings=session_settings,
                progress=app.state.progress,
                business=app.state.business,
            )
            await session.run()
        except (ProtocolError, TimeoutError) as exc:
            LOGGER.warning("Rejected Technoline stream: %s", exc)
            await websocket.close(code=1008, reason="Invalid start frame")
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            LOGGER.exception("Call failed")
            if active_call_id is not None:
                await app.state.progress.log_diagnostic(
                    profile_id=profile_id,
                    call_id=active_call_id,
                    event_type="call_failed",
                    details={"error_type": type(exc).__name__},
                )
            try:
                await websocket.close(code=1011, reason="Call failed")
            except RuntimeError:
                pass
        finally:
            if heartbeat is not None:
                heartbeat.cancel()
                await asyncio.gather(heartbeat, return_exceptions=True)
            if owner_id is not None and active_call_id is not None:
                await app.state.progress.release_call(active_call_id, owner_id)
            slots.release()

    @app.websocket("/v1/technoline/stream")
    async def technoline_stream(websocket: WebSocket) -> None:
        await handle_technoline_stream(websocket, app.state.settings.student_id)

    @app.websocket("/v1/technoline/stream/{profile_id}")
    async def profile_technoline_stream(websocket: WebSocket, profile_id: str) -> None:
        resolved_profile_id = (
            app.state.settings.adult_student_id if profile_id == "adult" else profile_id
        )
        await handle_technoline_stream(websocket, resolved_profile_id)

    @app.websocket("/v1/technoline/stream/bots/{bot_id}")
    async def bot_technoline_stream(websocket: WebSocket, bot_id: str) -> None:
        await handle_technoline_stream(websocket, bot_id)

    return app


app = create_app()
