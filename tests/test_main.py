from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app


def settings(database_path: Path) -> Settings:
    return Settings(
        gemini_api_key=SecretStr("gemini-test"),
        admin_bearer_secret=SecretStr("a" * 32),
        database_path=database_path,
    )


def test_health_readiness_and_protected_progress(tmp_path) -> None:
    app = create_app(settings(tmp_path / "progress.db"))
    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/readyz").status_code == 200
        dashboard = client.get("/dashboard")
        assert dashboard.status_code == 200
        assert "לוח ההורה" in dashboard.text
        assert "Gemini מציע רשמית רק שתי דרגות" in dashboard.text
        assert "נמוכה — פחות רגישה לרעשים" in dashboard.text
        assert 'class="help-tip"' in dashboard.text
        assert 'class="topbar"' in dashboard.text
        assert 'href="#speech-settings"' in dashboard.text
        assert dashboard.headers["cache-control"] == "no-store"
        assert client.get("/v1/progress/student").status_code == 401
        response = client.get(
            "/v1/progress/student",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        )
        assert response.status_code == 200
        assert response.json()["session_count"] == 0

        assert client.get("/v1/admin/config").status_code == 401
        config = client.get(
            "/v1/admin/config",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        )
        assert config.status_code == 200
        body = config.json()
        assert body["controls"]["ending_policy"] == "learner_only"
        assert body["effective"]["setup_message"]["setup"][
            "realtimeInputConfig"
        ]["automaticActivityDetection"]["silenceDurationMs"] == 700

        controls = body["controls"]
        controls["learning_goal"] = "לתרגל קניות באנגלית"
        controls["vad_silence_ms"] = 850
        updated = client.put(
            "/v1/admin/config",
            headers={"Authorization": f"Bearer {'a' * 32}"},
            json=controls,
        )
        assert updated.status_code == 200
        assert updated.json()["controls"]["vad_silence_ms"] == 850
        assert "לתרגל קניות באנגלית" in updated.json()["effective"][
            "setup_message"
        ]["setup"]["systemInstruction"]["parts"][0]["text"]


def test_technoline_websocket_accepts_without_bearer_by_default(tmp_path) -> None:
    app = create_app(settings(tmp_path / "progress.db"))
    with TestClient(app) as client:
        with client.websocket_connect("/v1/technoline/stream") as socket:
            socket.close()
