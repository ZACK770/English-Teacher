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
        assert dashboard.headers["cache-control"] == "no-store"
        assert client.get("/v1/progress/student").status_code == 401
        response = client.get(
            "/v1/progress/student",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        )
        assert response.status_code == 200
        assert response.json()["session_count"] == 0


def test_technoline_websocket_accepts_without_bearer_by_default(tmp_path) -> None:
    app = create_app(settings(tmp_path / "progress.db"))
    with TestClient(app) as client:
        with client.websocket_connect("/v1/technoline/stream") as socket:
            socket.close()
