import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.business import AccessPolicy, BusinessStore, Customer, Package, Receipt
from app.config import Settings
from app.main import create_app
from app.progress import ProgressStore


def make_store(tmp_path):
    path = tmp_path / "business.db"
    asyncio.run(ProgressStore(path).initialize())
    store = BusinessStore(path)
    store.initialize()
    return store


def test_caller_identity_is_independent_from_bot_and_anonymous_is_isolated(tmp_path):
    store = make_store(tmp_path)
    first = store.identify_call("+972501234567", "call-a", "teacher-a")
    assert first == store.identify_call("0501234567", "call-b", "teacher-b")
    assert first != store.identify_call("0507654321", "call-c", "teacher-a")
    assert store.identify_call("private", "call-d", "teacher-a") != store.identify_call(
        "private", "call-e", "teacher-a"
    )


def test_paid_wallet_reservations_prevent_concurrent_double_spend(tmp_path):
    store = make_store(tmp_path)
    customer = store.save("customers", Customer(name="Test", phone="0501234567").model_dump())
    package = store.save("packages", Package(
        name="One minute", product="school", minutes=1, price_ils=20, active=True,
    ).model_dump())
    store.receipt(Receipt(customer_id=customer["id"], package_id=package["id"],
                          reference="payment-one", amount_ils=20))
    store.save("policies", AccessPolicy(enabled=True).model_dump(), "teacher-a")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda call: store.reserve_call(
            customer["id"], "teacher-a", call, 60
        ), ["first", "second"]))
    assert sorted(r["seconds"] for r in results) == [0, 60]
    call_id = "first" if results[0]["seconds"] else "second"
    store.settle_call(call_id, 15)
    assert store.reserve_call(customer["id"], "teacher-a", "third", 60)["seconds"] == 45
    store.settle_call(call_id, 59)  # settling is idempotent
    assert store.customer_detail(customer["id"])["receipts"][0]["spent_seconds"] == 60


def test_monthly_free_limit_and_anonymous_rejection(tmp_path):
    store = make_store(tmp_path)
    store.save("policies", AccessPolicy(
        enabled=True, product="translator", free_calls_month=2, free_call_seconds=30,
    ).model_dump(), "translator-a")
    for n in range(2):
        assert store.reserve_call("customer-a", "translator-a", str(n), 120)["seconds"] == 30
        store.settle_call(str(n), 5)
    assert store.reserve_call("customer-a", "translator-a", "extra", 120)["seconds"] == 0
    assert store.reserve_call("anonymous-1", "translator-a", "hidden", 120)["seconds"] == 0


def test_receipt_reference_is_unique_and_amount_not_invented(tmp_path):
    store = make_store(tmp_path)
    customer = store.save("customers", Customer(name="Test", phone="0501234567").model_dump())
    package = store.save("packages", Package(
        name="Package", product="school", minutes=100, price_ils=100, active=True,
    ).model_dump())
    receipt = Receipt(customer_id=customer["id"], package_id=package["id"],
                      reference="unique-payment", amount_ils=80)
    store.receipt(receipt)
    assert store.summary()["gross_receipts_ils"] == 80
    with pytest.raises(sqlite3.IntegrityError):
        store.receipt(receipt)
    assert len(store.summary()["receipts"]) == 1


def test_business_and_customer_portal_authorization_and_persistence(tmp_path):
    app = create_app(Settings(
        gemini_api_key=SecretStr("test"), admin_bearer_secret=SecretStr("a" * 32),
        database_path=tmp_path / "progress.db",
    ))
    headers = {"Authorization": "Bearer " + "a" * 32}
    with TestClient(app) as client:
        assert client.get("/v1/admin/business/overview").status_code == 401
        customer = client.post("/v1/admin/business/customers", headers=headers, json={
            "name": "Test", "phone": "0501234567", "notes": "internal admin note",
        }).json()
        invite = client.post(
            f"/v1/admin/business/customers/{customer['id']}/invite", headers=headers,
        ).json()
        portal_headers = {"Authorization": "Bearer " + invite["token"]}
        me = client.get("/v1/portal/me", headers=portal_headers)
        assert me.status_code == 200
        assert me.json()["customer"]["name"] == "Test"
        assert "notes" not in me.json()["customer"]
        assert client.get("/v1/admin/business/overview", headers=portal_headers).status_code == 401
        assert client.get("/v1/portal/me", headers=headers).status_code == 401
        client.post(f"/v1/admin/business/customers/{customer['id']}/invite", headers=headers)
        assert client.get("/v1/portal/me", headers=portal_headers).status_code == 401
        assert client.get("/learn").status_code == 200


def test_portal_turn_and_narration_share_prompt_compiler_and_real_storage(tmp_path, monkeypatch):
    from app import narration, portal

    captured = []

    class FakeGemini:
        def __init__(self, settings, *, setup_payload):
            self.settings = settings
            captured.append(setup_payload)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def start_greeting(self):
            pass

        async def events(self):
            yield {"type": "audio", "pcm24k": b"\x00\x00" * 2400}
            yield {"type": "transcript", "role": "tutor", "text": "Test response"}
            yield {"type": "turn_complete"}

    monkeypatch.setattr(portal, "GeminiLive", FakeGemini)
    monkeypatch.setattr(narration, "GeminiLive", FakeGemini)
    app = create_app(Settings(
        gemini_api_key=SecretStr("test"), admin_bearer_secret=SecretStr("a" * 32),
        database_path=tmp_path / "progress.db",
    ))
    headers = {"Authorization": "Bearer " + "a" * 32}
    with TestClient(app) as client:
        customer = client.post("/v1/admin/business/customers", headers=headers, json={
            "name": "Student A", "phone": "0501234567",
        }).json()
        course = client.post("/v1/admin/business/courses", headers=headers, json={
            "name": "Shopping", "bot_id": "student", "active": True,
            "lessons": [{"title": "Shop", "instructions": "Practice buying oranges"}],
        }).json()
        assert client.post("/v1/admin/business/enrollments", headers=headers, json={
            "customer_id": customer["id"], "course_id": course["id"],
        }).status_code == 201
        invite = client.post(
            f"/v1/admin/business/customers/{customer['id']}/invite", headers=headers,
        ).json()
        token = {"Authorization": "Bearer " + invite["token"]}
        result = client.post("/v1/bots/student/turn", headers=token, json={"text": "Hello"})
        assert result.status_code == 200
        assert result.json()["audio_wav_base64"].startswith("UklGR")
        assert "Practice buying oranges" in captured[0]["setup"]["systemInstruction"]["parts"][0][
            "text"
        ]
        me = client.get("/v1/portal/me", headers=token).json()
        assert me["progress"]["session_count"] == 1
        traces = client.get("/v1/admin/traces/student", headers=headers).json()["traces"]
        assert traces[0]["turns"][0]["text"] == "Hello"
        assert traces[0]["turns"][1]["text"] == "Test response"
        script = client.post("/v1/admin/business/narrations", headers=headers, json={
            "name": "Welcome", "placement": "welcome", "text": "שלום וברוכים הבאים",
        }).json()
        rendered = client.post(f"/v1/admin/narrations/{script['id']}/audio", headers=headers)
        assert rendered.status_code == 200
        assert rendered.content.startswith(b"RIFF")
        assert client.get(
            f"/v1/admin/narrations/{script['id']}/audio", headers=headers,
        ).content == rendered.content
        script["text"] = "הודעת פתיחה חדשה"
        client.put(f"/v1/admin/business/narrations/{script['id']}", headers=headers, json=script)
        assert client.get(
            f"/v1/admin/narrations/{script['id']}/audio", headers=headers,
        ).status_code == 409


def test_preview_does_not_publish_and_restore_publishes_new_version(tmp_path):
    app = create_app(Settings(
        gemini_api_key=SecretStr("test"), admin_bearer_secret=SecretStr("a" * 32),
        database_path=tmp_path / "progress.db",
    ))
    headers = {"Authorization": "Bearer " + "a" * 32}
    with TestClient(app) as client:
        controls = client.get("/v1/admin/config/student", headers=headers).json()["controls"]
        controls["language_code"] = "en-US"
        preview = client.post(
            "/v1/admin/bots/student/preview", headers=headers, json=controls,
        )
        assert preview.status_code == 200
        assert client.get("/v1/admin/config/student", headers=headers).json()[
            "controls"
        ]["language_code"] == "he-IL"
        client.put("/v1/admin/config/student", headers=headers, json=controls)
        restored = client.post("/v1/admin/bots/student/restore/1", headers=headers)
        assert restored.json()["profile"]["active_version"] == 3
        assert restored.json()["controls"]["language_code"] == "he-IL"


def test_basic_translator_after_free_quota(tmp_path):
    store = make_store(tmp_path)
    store.save("policies", AccessPolicy(
        enabled=True, product="translator", free_calls_month=1, free_call_seconds=30,
        basic_enabled=True, basic_calls_day=2, basic_call_seconds=60, basic_month_seconds=100,
        basic_intro_text="hi", blocked_extension="/sales",
    ).model_dump(), "translator-a")
    assert store.reserve_call("customer-a", "translator-a", "free", 120)["mode"] == "free"
    store.settle_call("free", 30)
    first = store.reserve_call("customer-a", "translator-a", "b1", 120)
    assert first == {"seconds": 60, "mode": "basic", "intro": "hi"}
    store.settle_call("b1", 60)
    assert store.reserve_call("customer-a", "translator-a", "b2", 120)["seconds"] == 40
    store.settle_call("b2", 40)
    assert store.reserve_call("customer-b", "translator-a", "b3", 120)["mode"] == "free"
    store.settle_call("b3", 30)
    assert store.reserve_call("customer-b", "translator-a", "b4", 120)["mode"] == "blocked"
    assert store.reserve_call("anonymous-1", "translator-a", "b4", 120)["mode"] == "blocked"


def test_basic_translator_daily_cap(tmp_path):
    store = make_store(tmp_path)
    store.save("policies", AccessPolicy(
        enabled=True, product="translator", basic_enabled=True, basic_calls_day=1,
    ).model_dump(), "translator-a")
    assert store.reserve_call("customer-a", "translator-a", "b1", 120)["mode"] == "basic"
    store.settle_call("b1", 20)
    assert store.reserve_call("customer-a", "translator-a", "b2", 120)["mode"] == "blocked"
    assert store.reserve_call("customer-b", "translator-a", "b3", 120)["mode"] == "basic"
