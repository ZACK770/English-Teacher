import logging
import urllib.parse

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.pbx import CallbackLogFilter, IVRCopy, PBXClient, PBXError, ivr_response, runtime_context


@pytest.fixture
def client(tmp_path):
    app = create_app(
        Settings(
            gemini_api_key=SecretStr("test"),
            admin_bearer_secret=SecretStr("a" * 32),
            database_path=tmp_path / "db.sqlite",
            tlivr_project_enabled=True,
            tlivr_callback_secret=SecretStr("c" * 64),
            tlivr_system_api_key=SecretStr("private-api"),
            tlivr_basic_channel="basic-token",
            tlivr_advanced_channel="advanced-token",
            tlivr_translator_channel="translator-token",
        )
    )
    with TestClient(app) as test_client:
        yield test_client


def callback(client, route="main", **params):
    data = {
        "PBXnum": "0765673575",
        "PBXcallId": "call-one",
        "PBXphone": "0501234567",
        "PBXextensionPath": "/99",
        "PBXcallStatus": "CALL",
        **params,
    }
    return client.post(
        "/v1/technoline/ivr/" + route + "?key=" + "c" * 64,
        content=urllib.parse.urlencode(data),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )


def test_auth_and_scope(client):
    assert client.get("/v1/admin/pbx/config").status_code == 401
    assert client.get("/v1/technoline/ivr/main").status_code == 401
    assert callback(client, PBXnum="100101").status_code == 400
    assert callback(client, PBXextensionPath="/1").status_code == 403
    assert callback(client, PBXextensionPath="/990").status_code == 403
    assert callback(client, "missing").status_code == 404


def test_menus_and_language_context_are_real_and_idempotent(client):
    assert callback(client).json()["name"] == "isaacMain"
    assert callback(client, isaacMain="2").json()["goTo"] == "/99/2"
    response = callback(client, "languages", isaacLanguage="5")
    assert response.json()["goTo"] == "/99/2/1"
    assert "isaacLanguage" in response.json()["removeParams"]
    assert "Russian" in runtime_context(client.app.state.business, "call-one")
    assert callback(client, "basic", isaacBasicMode="2").json()["goTo"] == "/99/1/1/1"
    assert "free conversation" in runtime_context(client.app.state.business, "call-one")
    callback(client, "basic", isaacBasicMode="2")
    events = client.app.state.business.list("ivr-events")
    assert len([e for e in events if e["route"] == "basic"]) == 1
    assert events[0]["latency_ms"] >= 0


def test_no_fake_payment_and_no_sensitive_fields_in_logs(client):
    callback(client, "sales", creditCard="OK", CONFIRM_payment="123", cardNumber="1234567890123456")
    events = str(client.app.state.business.list("ivr-events"))
    assert "1234567890123456" not in events and "CONFIRM_payment" not in events
    assert client.app.state.business.summary()["gross_receipts_ils"] == 0
    assert client.app.state.business.list("packages") == []


def test_live_copy_edit_and_seed_does_not_change_legacy_bots(client):
    headers = {"Authorization": "Bearer " + "a" * 32}
    payload = client.get("/v1/admin/pbx/config", headers=headers).json()
    assert "key" not in payload and payload["payment_configured"] is False
    copy = payload["copy"]
    copy["welcome"] = "שלום, נוסח חדש שנשמר עכשיו עבור המערכת."
    assert client.put("/v1/admin/pbx/config", headers=headers, json=copy).status_code == 200
    assert callback(client).json()["files"][0]["text"] == copy["welcome"]
    bots = client.get("/v1/admin/profiles", headers=headers).json()["profiles"]
    assert next(b for b in bots if b["id"] == "isaac-translator")["role"] == "translator"
    assert next(b for b in bots if b["id"] == "student")["channel_id"] != "basic-token"


def test_service_and_hangup():
    assert ivr_response("service", {}, IVRCopy(), "/99")["type"] == "record"
    assert (
        ivr_response("service", {"FILEID_isaacMessage": "42"}, IVRCopy(), "/99")["name"]
        == "isaacThanks"
    )
    assert ivr_response("main", {"PBXcallStatus": "HANGUP"}, IVRCopy(), "/99") == {"type": "hangup"}
    assert ivr_response("main", {"isaacMain": "ERROR"}, IVRCopy(), "/99")["type"] == "hangup"


def test_provider_auth_in_query_and_errors_redacted(monkeypatch):
    seen = []

    def fail(request, **kwargs):
        seen.append(request)
        raise OSError(request.full_url)

    monkeypatch.setattr("urllib.request.urlopen", fail)
    settings = Settings(
        gemini_api_key="x", admin_bearer_secret="a" * 32, tlivr_system_api_key="private-api"
    )
    with pytest.raises(PBXError) as error:
        PBXClient(settings).request("extensionSet", {"path": "/99"}, write=True)
    assert "private-api" not in str(error.value)
    assert "apiKey=private-api" in seen[0].full_url
    assert seen[0].data == b"path=%2F99"


def test_callback_access_log_redaction():
    record = logging.LogRecord(
        "uvicorn.access",
        20,
        "",
        0,
        "%s %s",
        ("GET", "/v1/technoline/ivr/main?key=secret&PBXphone=0501234567"),
        None,
    )
    CallbackLogFilter().filter(record)
    assert "secret" not in record.getMessage() and "0501234567" not in record.getMessage()


def test_anonymous_identity_stable_within_callback_and_stream(client):
    store = client.app.state.business
    first = store.identify_call("private", "hidden-call", "ivr")
    assert first == store.identify_call("private", "hidden-call", "isaac-basic")
    with store.connect() as db:
        assert (
            db.execute("SELECT bot_id FROM call_customers WHERE call_id='hidden-call'").fetchone()[
                0
            ]
            == "isaac-basic"
        )
