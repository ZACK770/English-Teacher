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
        assert "מרכז הניהול" in dashboard.text
        assert '/console-assets/console.js' in dashboard.text
        assert client.get('/console-assets/console.js').status_code == 200
        assert client.get('/console-assets/console.css').status_code == 200
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

        profiles = client.get(
            "/v1/admin/profiles",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        ).json()["profiles"]
        assert [profile["id"] for profile in profiles] == ["student", "adult"]
        assert profiles[1]["channel_configured"] is False

        adult_config = client.get(
            "/v1/admin/config/adult",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        )
        assert adult_config.status_code == 200
        assert adult_config.json()["profile"]["audience"] == "adult"
        assert adult_config.json()["controls"]["target_lesson_minutes"] == 25
        assert adult_config.json()["controls"]["language_code"] == "en-US"
        assert "85-90 percent" in adult_config.json()["controls"]["base_prompt"]

        adult_progress = client.get(
            "/v1/progress/adult",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        )
        assert adult_progress.status_code == 200
        assert adult_progress.json()["session_count"] == 0
        diagnostics = client.get(
            "/v1/admin/diagnostics/adult",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        )
        assert diagnostics.status_code == 200
        assert diagnostics.json()["events"] == []

        created = client.post(
            "/v1/admin/bots",
            headers={"Authorization": f"Bearer {'a' * 32}"},
            json={
                "id": "sales-agent",
                "label": "נציג מכירות",
                "role": "sales",
                "description": "בדיקה",
                "audience": "general",
                "channel_id": "channel-2",
                "enabled": True,
            },
        )
        assert created.status_code == 201
        assert created.json()["bot"]["websocket_path"].endswith(
            "/bots/sales-agent"
        )
        new_config = created.json()["config"]
        assert new_config["effective"]["prompt_fingerprint"]
        new_controls = new_config["controls"]
        new_controls["language_code"] = "en-US"
        new_controls["model"] = "models/gemini-test-live"
        published = client.put(
            "/v1/admin/config/sales-agent",
            headers={"Authorization": f"Bearer {'a' * 32}"},
            json=new_controls,
        )
        assert published.status_code == 200
        assert published.json()["profile"]["active_version"] == 2
        assert (
            published.json()["effective"]["setup_message"]["setup"]["model"]
            == "models/gemini-test-live"
        )
        versions = client.get(
            "/v1/admin/bots/sales-agent/versions",
            headers={"Authorization": f"Bearer {'a' * 32}"},
        ).json()["versions"]
        assert [item["version"] for item in versions] == [2, 1]


def test_technoline_websocket_accepts_without_bearer_by_default(tmp_path) -> None:
    app = create_app(settings(tmp_path / "progress.db"))
    with TestClient(app) as client:
        with client.websocket_connect("/v1/technoline/stream") as socket:
            socket.close()
