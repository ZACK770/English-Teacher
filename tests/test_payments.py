import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.business import AccessPolicy, Package
from app.config import Settings
from app.main import create_app
from app.payments import PREFIX, agorot, verify_signature


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        gemini_api_key="test",
        admin_bearer_secret="a" * 32,
        database_path=tmp_path / "db.sqlite",
        tlivr_project_enabled=True,
        tlivr_callback_secret="c" * 64,
        tlivr_router_channel="router",
        nedarim_mosad_id="7019554",
        nedarim_phone_terminal="7019554",
        nedarim_api_key="test-api",
        nedarim_webhook_secret="test-secret",
        nedarim_phone_enabled=True,
    )
    with TestClient(create_app(settings)) as c:
        yield c


def phone(client, **params):
    return client.post(
        "/v1/technoline/ivr/sales?key=" + "c" * 64,
        data={
            "PBXnum": "0765673575",
            "PBXcallId": "call",
            "PBXphone": "0501234567",
            "PBXextensionPath": "/99/3",
            "PBXcallStatus": "CALL",
            **params,
        },
    )


def purchase(client, product="school"):
    b = client.app.state.business
    package = b.save(
        "packages",
        Package(
            name="Test",
            product=product,
            minutes=100,
            price_ils=49,
            validity_days=30,
            active=True,
        ).model_dump(),
    )
    assert phone(client).json()["name"] == "isaacPackage"
    assert phone(client, isaacPackage="1").json()["name"] == "isaacPayConfirm"
    assert phone(client, isaacPackage="1", isaacPayConfirm="1").json()["type"] == "creditCard"
    return package, client.app.state.payments.order_for_call("call")


def settlement(order, **updates):
    return {
        "MosadNumber": "7019554",
        "Groupe": PREFIX + order["id"],
        "TransactionId": "123",
        "Confirmation": "567",
        "Amount": "49",
        "Currency": "1",
        **updates,
    }


def webhook(client, data, *, secret="test-secret", timestamp=None):
    raw = json.dumps(data, ensure_ascii=False).encode()
    ts = str(int(time.time()) if timestamp is None else timestamp)
    sig = hmac.new(secret.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return client.post(
        "/v1/payments/nedarim/webhook",
        content=raw,
        headers={"x-nedarim-timestamp": ts, "x-nedarim-signature": "v1=" + sig},
    )


def test_only_signed_settlement_unlocks_and_retries_grant_once(client):
    _, order = purchase(client)
    command_retry = phone(client, isaacPackage="1", isaacPayConfirm="1").json()
    assert command_retry["type"] != "creditCard"
    phone(client, isaacPayStatus="OK", CONFIRM_isaacPayStatus="567")
    b = client.app.state.business
    assert not b.customer_detail(order["customer_id"])["receipts"]
    data = settlement(order)
    assert webhook(client, data, secret="wrong").status_code == 401
    assert webhook(client, data, timestamp=int(time.time()) - 400).status_code == 401
    assert webhook(client, data).json()["paid"]
    assert webhook(client, data).json()["duplicate"]
    assert len(b.customer_detail(order["customer_id"])["receipts"]) == 1
    assert "נפתחה" in phone(client).json()["files"][0]["text"]


@pytest.mark.parametrize(
    "changes",
    [
        {"Amount": "48"},
        {"Amount": "0"},
        {"Amount": "-49"},
        {"Currency": "2"},
        {"MosadNumber": "7000000"},
        {"TransactionId": ""},
        {"Confirmation": ""},
        {"KevaId": "123"},
    ],
)
def test_mismatched_or_nonfinal_settlement_never_grants(client, changes):
    _, order = purchase(client)
    assert webhook(client, settlement(order, **changes)).status_code == 400
    assert not client.app.state.business.customer_detail(order["customer_id"])["receipts"]


def test_refusal_and_unrelated_event_do_not_grant(client):
    _, order = purchase(client)
    assert webhook(client, settlement(order, Status="Error")).json()["ignored"]
    assert webhook(client, settlement(order, Groupe="other")).json()["ignored"]
    phone(client, isaacPayStatus="DECLINE")
    assert client.app.state.payments.order_for_call("call")["state"] == "failed"
    assert not client.app.state.business.customer_detail(order["customer_id"])["receipts"]


def test_snapshot_survives_price_change_and_credit_stays_in_product(client):
    package, order = purchase(client, product="translator")
    b = client.app.state.business
    package.update(price_ils=99, minutes=500, active=False)
    b.save("packages", package, package["id"])
    assert webhook(client, settlement(order)).status_code == 200
    receipts = b.customer_detail(order["customer_id"])["receipts"]
    assert receipts[0]["amount_ils"] == 49 and receipts[0]["minutes"] == 100
    b.save("policies", AccessPolicy(enabled=True, product="school").model_dump(), "school")
    b.save("policies", AccessPolicy(enabled=True, product="translator").model_dump(), "tr")
    assert b.reserve_call(order["customer_id"], "school", "school-call", 60)["seconds"] == 0
    assert b.reserve_call(order["customer_id"], "tr", "tr-call", 60)["seconds"] == 60


def test_concurrent_callbacks_credit_once(client):
    _, order = purchase(client)
    store = client.app.state.payments
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: store.settle(settlement(order), "7019554"), range(2)))
    assert all(r["paid"] for r in results)
    assert len(client.app.state.business.customer_detail(order["customer_id"])["receipts"]) == 1


def test_unknown_caller_and_inactive_packages_cannot_purchase(client):
    assert phone(client).json()["name"] == "isaacPayExit"
    assert phone(client, PBXphone="private").json()["type"] != "creditCard"
    assert client.get("/v1/admin/payments/status").status_code == 401


def test_signature_uses_exact_bytes_and_money_is_exact():
    raw = b'{"Amount":49}'
    ts = "1000"
    signature = "v1=" + hmac.new(b"s", b"1000." + raw, hashlib.sha256).hexdigest()
    headers = {"x-nedarim-timestamp": ts, "x-nedarim-signature": signature}
    assert verify_signature(raw, headers, "s", 1000)
    assert not verify_signature(raw + b" ", headers, "s", 1000)
    assert agorot("49.90") == 4990
    for invalid in ("nan", "Infinity", "0", "1.001"):
        with pytest.raises(ValueError):
            agorot(invalid)
