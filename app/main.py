from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse

from .auth import bearer_value, ip_is_allowed, secure_equal
from .config import Settings, get_settings
from .dashboard import dashboard_html
from .progress import ProgressStore
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
        store = ProgressStore(active_settings.database_path)
        await store.initialize()
        app.state.settings = active_settings
        app.state.progress = store
        app.state.call_slots = asyncio.Semaphore(active_settings.max_concurrent_calls)
        yield

    app = FastAPI(title="Technoline English Tutor", version="1.0.0", lifespan=lifespan)

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
            dashboard_html(app.state.settings.student_id),
            headers={
                "Cache-Control": "no-store",
                "Content-Security-Policy": (
                    "default-src 'none'; style-src 'unsafe-inline'; "
                    "script-src 'unsafe-inline'; connect-src 'self'; "
                    "base-uri 'none'; form-action 'none'"
                ),
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
            },
        )

    @app.get("/v1/progress/{student_id}")
    async def progress_report(
        student_id: str, authorization: str | None = Header(default=None)
    ) -> dict:
        active: Settings = app.state.settings
        token = bearer_value(authorization)
        if not secure_equal(token, active.admin_bearer_secret.get_secret_value()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
        if student_id != active.student_id:
            raise HTTPException(status_code=404, detail="Student not found")
        return await app.state.progress.report(student_id)

    @app.websocket("/v1/technoline/stream")
    async def technoline_stream(websocket: WebSocket) -> None:
        active: Settings = app.state.settings
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
        try:
            first = await asyncio.wait_for(websocket.receive_text(), timeout=10)
            start = parse_start_frame(first, active.technoline_channel_id)
            LOGGER.info("Accepted Technoline call %s", start.call_id)
            session = TutorSession(
                pbx=websocket,
                start=start,
                settings=active,
                progress=app.state.progress,
            )
            await session.run()
        except (ProtocolError, TimeoutError) as exc:
            LOGGER.warning("Rejected Technoline stream: %s", exc)
            await websocket.close(code=1008, reason="Invalid start frame")
        except WebSocketDisconnect:
            pass
        except Exception:
            LOGGER.exception("Call failed")
            try:
                await websocket.close(code=1011, reason="Call failed")
            except RuntimeError:
                pass
        finally:
            slots.release()

    return app


app = create_app()
