import asyncio
import base64
import json
import sqlite3
import struct
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.controls import TutorControls
from app.gemini_live import GeminiLive, build_setup_payload
from app.main import create_app
from app.progress import ProgressStore
from app.prompting import compile_prompt
from app.session import CallEnded, TutorSession
from app.technoline import StartFrame


def make_session(tmp_path):
    settings = Settings(
        gemini_api_key="test", admin_bearer_secret="a" * 32, database_path=tmp_path / "lifecycle.db"
    )
    return TutorSession(
        pbx=None,
        start=StartFrame("call-close", "", "channel", 8000, 1),
        settings=settings,
        progress=ProgressStore(settings.database_path),
    )


def test_every_prompt_and_setup_contains_the_same_end_session_tool(tmp_path):
    session = make_session(tmp_path)
    controls = TutorControls(
        base_prompt="A custom translator prompt. " * 4,
        idle_timeout_seconds=45,
        session_end_action="return_to_menu",
    )
    artifact = compile_prompt(
        controls=controls, history_context="", settings=session.settings, profile_id="custom-bot"
    )
    assert "call end_session" in artifact.system_instruction
    tools = artifact.setup_message["setup"]["tools"][0]["functionDeclarations"]
    assert "end_session" in [tool["name"] for tool in tools]
    assert artifact.runtime_settings.session_idle_timeout_seconds == 45
    assert artifact.runtime_settings.session_end_action == "return_to_menu"
    assert "end_session" in str(build_setup_payload(session.settings))
    for tool in tools:
        for parameter in tool.get("parameters", {}).get("properties", {}).values():
            assert "" not in parameter.get("enum", []), "Provider rejects empty enum members"


@pytest.mark.asyncio
async def test_goodbye_longer_than_two_seconds_and_partial_frame_play_before_hangup(
    tmp_path, monkeypatch,
):
    session = make_session(tmp_path)
    await session.progress.initialize()
    frames = [struct.pack("<160h", *([i + 1] * 160)) for i in range(160)]
    partial = b"\x33\x01" * 79
    session._out.extend((1, frame) for frame in frames)
    session._partial = partial
    session._end_reason = "model:caller_requested"
    sent = []
    waits = []

    class PBX:
        async def send_bytes(self, frame):
            sent.append(frame)

        async def send_text(self, command):
            assert sent[:160] == frames
            assert sent[160] == partial.ljust(320, b"\0")
            assert sum(waits) > 3.2
            sent.append(json.loads(command))

    async def fake_sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr("app.session.asyncio.sleep", fake_sleep)
    session.pbx = PBX()
    await session._finish_pbx()
    await session._finish_pbx()
    assert len(sent) == 172  # 160 full frames + partial + 10 tail frames + one hangup.
    assert sent[-1] == {"type": "hangup"}
    assert not session._out and session._partial == b""


@pytest.mark.asyncio
async def test_audio_and_transcript_in_terminal_tool_packet_are_delivered_first(tmp_path):
    session = make_session(tmp_path)
    ai = GeminiLive(session.settings)

    class Socket:
        def __aiter__(self):
            return self.messages()

        async def messages(self):
            yield json.dumps({
                "toolCall": {"functionCalls": [{"name": "end_session", "args": {}}]},
                "serverContent": {
                    "outputTranscription": {"text": "ביי, להתראות"},
                    "modelTurn": {"parts": [{"inlineData": {
                        "data": base64.b64encode(b"final goodbye audio").decode(),
                    }}]},
                    "turnComplete": True,
                },
            })

    ai.socket = Socket()
    events = [event async for event in ai.events()]
    assert [event["type"] for event in events] == [
        "transcript", "audio", "turn_complete", "tool_call",
    ]
    assert events[1]["pcm24k"] == b"final goodbye audio"


@pytest.mark.asyncio
@pytest.mark.parametrize("destination", [None, "main", "school", "translator", "options"])
async def test_model_end_closes_google_before_phone_and_leaves_no_bridge_tasks(
    tmp_path, monkeypatch, destination
):
    session = make_session(tmp_path)
    await session.progress.initialize()
    if destination:
        from app.business import BusinessStore

        session.business = BusinessStore(session.settings.database_path)
        session.business.initialize()
        session.start = StartFrame("parent~segment", "", "channel", 8000, 1)
    order = []

    class PBX:
        async def receive(self):
            await asyncio.Event().wait()

        async def send_bytes(self, frame):
            pass

        async def send_text(self, text):
            with sqlite3.connect(session.settings.database_path) as db:
                assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
            order.append(json.loads(text)["type"])

    class AI:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            order.append("google_closed")

        async def start_greeting(self):
            pass

        async def submit_tool_result(self, call, saved):
            assert saved is True

        async def events(self):
            yield {
                "type": "tool_call",
                "calls": [
                    {"name": "end_session", "id": "end", "args": {
                        "reason": "caller_requested",
                        **({"destination": destination} if destination else {}),
                    }}
                ],
            }
            pytest.fail("Must not keep reading Google after end_session")

    session.pbx = PBX()
    monkeypatch.setattr("app.session.GeminiLive", AI)
    await asyncio.wait_for(session.run(), timeout=2)
    assert order == ["google_closed", "transfer_extension" if destination else "hangup"]
    if destination:
        assert session._return_path == "/99" + {
            "main": "", "school": "/1", "translator": "/2", "options": "/9",
        }[destination]
    assert session._end_reason == "model:caller_requested"
    assert not any(
        t.get_name()
        in {
            "pbx-to-gemini",
            "gemini-to-pbx-queue",
            "paced-pbx-output",
            "session-idle-watchdog",
            "session-stop-watchdog",
        }
        for t in asyncio.all_tasks()
        if not t.done()
    )
    traces = await session.progress.recent_diagnostics("student")
    assert any(t["event_type"] == "session_saved" for t in traces)


@pytest.mark.asyncio
async def test_idle_guard_is_independent_of_ai_activity(tmp_path):
    session = make_session(tmp_path)
    await session.progress.initialize()
    session._last_human_activity = time.monotonic() - 61
    assert not session._has_voice_activity(b"\0" * 320)
    assert session._has_voice_activity(struct.pack("<160h", *([2000] * 160)))
    with pytest.raises(CallEnded):
        await asyncio.wait_for(session._idle_watchdog(), 0.2)
    assert session._end_reason == "idle_timeout"


@pytest.mark.asyncio
async def test_constant_pcm_silence_does_not_refresh_idle_clock(tmp_path):
    session = make_session(tmp_path)
    await session.progress.initialize()
    stamp = session._last_human_activity

    class PBX:
        n = 0

        async def receive(self):
            self.n += 1
            if self.n > 10:
                return {"type": "websocket.disconnect"}
            return {"bytes": b"\0" * 320}

    class AI:
        async def send_audio(self, audio):
            pass

    session.pbx = PBX()
    with pytest.raises(CallEnded):
        await session._pbx_to_ai(AI())
    assert session._last_human_activity == stamp
    assert session._pbx_disconnected


@pytest.mark.asyncio
async def test_return_to_menu_is_not_a_live_ai_session(tmp_path):
    session = make_session(tmp_path)
    await session.progress.initialize()
    commands = []

    class PBX:
        async def send_text(self, text):
            commands.append(json.loads(text))

    session.pbx = PBX()
    session.settings.session_end_action = "return_to_menu"
    session.start = StartFrame("parent~segment", "", "channel", 8000, 1)
    session._end_reason = "idle_timeout"
    await session._finish_pbx()
    await session._finish_pbx()
    assert commands == [{"type": "transfer_extension", "target": "/99"}]


@pytest.mark.asyncio
async def test_admin_stop_wakes_and_stops_session(tmp_path):
    session = make_session(tmp_path)
    session.request_stop()
    with pytest.raises(CallEnded):
        await asyncio.wait_for(session._stop_watchdog(), 0.2)
    assert session._end_reason == "admin_requested"


@pytest.mark.asyncio
async def test_failed_setup_closes_socket_even_before_context_entered(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    closed = []

    class Socket:
        async def send(self, payload):
            pass

        async def recv(self):
            return json.dumps({"error": {"message": "invalid setup"}})

        async def close(self):
            closed.append(True)

    async def connect(*args, **kwargs):
        return Socket()

    monkeypatch.setattr("app.gemini_live.connect", connect)
    ai = GeminiLive(session.settings)
    with pytest.raises(RuntimeError, match="acknowledged"):
        await ai.__aenter__()
    assert closed == [True] and ai.socket is None


@pytest.mark.asyncio
async def test_cancellation_during_setup_closes_socket(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    waiting = asyncio.Event()
    closed = []

    class Socket:
        async def send(self, payload):
            pass

        async def recv(self):
            waiting.set()
            await asyncio.Event().wait()

        async def close(self):
            closed.append(True)

    async def connect(*args, **kwargs):
        return Socket()

    monkeypatch.setattr("app.gemini_live.connect", connect)
    ai = GeminiLive(session.settings)
    task = asyncio.create_task(ai.__aenter__())
    await waiting.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed == [True] and ai.socket is None


def test_active_sessions_controls_require_admin(tmp_path):
    session = make_session(tmp_path)
    with TestClient(create_app(session.settings)) as client:
        assert client.get("/v1/admin/active-ai-sessions").status_code == 401
        headers = {"Authorization": "Bearer " + "a" * 32}
        assert client.get("/v1/admin/active-ai-sessions", headers=headers).json() == {
            "sessions": []
        }
        client.app.state.live_ai_sessions["active-one"] = session
        assert client.post("/v1/admin/active-ai-sessions/active-one/stop").status_code == 401
        assert (
            client.post("/v1/admin/active-ai-sessions/active-one/stop", headers=headers).status_code
            == 202
        )
        assert session._stop_requested.is_set()


def test_web_turn_end_session_exits_google_without_waiting_for_another_event(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    closed = []

    class AI:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            closed.append(True)

        async def start_greeting(self):
            pass

        async def submit_tool_result(self, call, saved):
            assert saved is True

        async def events(self):
            yield {
                "type": "tool_call",
                "calls": [
                    {"name": "end_session", "id": "end-web", "args": {"reason": "task_completed"}}
                ],
            }
            pytest.fail("Web session must not continue after end_session")

    monkeypatch.setattr("app.portal.GeminiLive", AI)
    with TestClient(create_app(session.settings)) as client:
        headers = {"Authorization": "Bearer " + "a" * 32}
        customer = client.post(
            "/v1/admin/business/customers",
            headers=headers,
            json={"name": "Lifecycle test", "phone": "0501234567"},
        ).json()
        invite = client.post(
            f"/v1/admin/business/customers/{customer['id']}/invite", headers=headers
        ).json()
        learner = {"Authorization": "Bearer " + invite["token"]}
        assert (
            client.post(
                "/v1/bots/student/turn", headers=learner, json={"text": "סיימתי, תודה"}
            ).status_code
            == 200
        )
    assert closed == [True]

