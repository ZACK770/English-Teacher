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
            tlivr_router_channel="router-token",
            public_base_url="https://example.test",
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
    assert callback(client, isaacMain="2").json()["goTo"] == "/99/7"
    response = callback(client, "languages", isaacLanguage="5")
    assert response.json()["goTo"] == "/99/7"
    assert "isaacLanguage" in response.json()["removeParams"]
    assert "Russian" in runtime_context(client.app.state.business, "call-one")
    assert callback(client, "basic", isaacBasicMode="2").json()["goTo"] == "/99/1/1/1"
    assert "free conversation" in runtime_context(client.app.state.business, "call-one")
    callback(client, "basic", isaacBasicMode="2")
    events = client.app.state.business.list("ivr-events")
    assert len([e for e in events if e["route"] == "basic"]) == 2
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


def test_collecting_menu_never_deletes_the_answer_it_is_collecting(client):
    first = callback(client).json()
    assert first["name"] not in first.get("removeParams", [])
    selected = callback(client, isaacMain="1").json()
    assert selected["type"] == "goTo" and selected["goTo"] == "/99/7"
    assert "isaacMain" in selected.get("removeParams", [])
    options = callback(client, "options").json()
    assert options["name"] not in options.get("removeParams", [])


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


def test_new_bot_automatically_appears_in_phone_and_can_be_disabled(client):
    headers = {"Authorization": "Bearer " + "a" * 32}
    bot = client.post(
        "/v1/admin/bots",
        headers=headers,
        json={"id": "new-teacher", "label": "New dynamic teacher"},
    ).json()["bot"]
    assert bot["phone_enabled"] and bot["web_enabled"]
    assert bot["channel_id"] is None
    response = callback(client, "teachers").json()
    assert "New dynamic teacher" in response["files"][0]["text"]
    context = client.app.state.business
    from app.pbx import load_context

    mapping = load_context(context, "call-one")["teacher_choices"]
    digit = next(k for k, v in mapping.items() if v == "new-teacher")
    assert callback(client, "teachers", isaacBotChoice=digit).json()["goTo"] == "/99/7"
    assert load_context(context, "call-one")["selected_bot"] == "new-teacher"
    assert (
        client.put(
            "/v1/admin/bots/new-teacher", headers=headers, json={**bot, "phone_enabled": False}
        ).status_code
        == 200
    )
    assert (
        "New dynamic teacher"
        not in callback(client, "teachers", PBXcallId="another-call").json()["files"][0]["text"]
    )


def test_portal_preferences_and_telephone_use_the_same_identity(client):
    headers = {"Authorization": "Bearer " + "a" * 32}
    callback(client)
    customer = client.app.state.business.list("customers")[0]
    invite = client.post(
        f"/v1/admin/business/customers/{customer['id']}/invite", headers=headers
    ).json()
    learner = {"Authorization": "Bearer " + invite["token"]}
    assert (
        client.post(
            "/v1/portal/preferences",
            headers=learner,
            json={
                "selected_bot": "isaac-advanced",
                "mode": "free",
                "language": "Russian",
            },
        ).status_code
        == 200
    )
    assert callback(client, "school", isaacTeacher="1").json()["goTo"] == "/99/7"
    from app.pbx import load_context

    assert load_context(client.app.state.business, "call-one")["selected_bot"] == "isaac-advanced"
    assert (
        client.get("/v1/portal/me", headers=learner).json()["preferences"]["language"] == "Russian"
    )


def test_managed_stream_loads_selected_bot_without_private_channel(client, monkeypatch):
    from app.pbx import save_context

    seen = []

    class Session:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def run(self):
            seen.append(self.kwargs["settings"].student_id)
            await self.kwargs["pbx"].close()

    monkeypatch.setattr("app.main.TutorSession", Session)
    save_context(client.app.state.business, "managed-call", {"selected_bot": "isaac-basic"})
    client.app.state.business.identify_call("0501234567", "managed-call", "ivr")
    with client.websocket_connect("/v1/technoline/router") as ws:
        ws.send_json(
            {
                "type": "start",
                "callId": "managed-call",
                "caller": "0501234567",
                "token": "router-token",
                "format": "pcm16;rate=8000;ch=1",
            }
        )
        assert ws.receive()["type"] == "websocket.close"
    assert seen == ["isaac-basic"]


def test_only_approved_current_narration_is_published(client):
    import hashlib

    from app.business import Narration

    headers = {"Authorization": "Bearer " + "a" * 32}
    store = client.app.state.business
    record = store.save(
        "narrations",
        Narration(
            name="Welcome",
            placement="welcome",
            text="ברוכים הבאים לקו הלימוד החדש.",
            status="approved",
        ).model_dump(),
    )
    store.save_audio(record["id"], hashlib.sha256(record["text"].encode()).hexdigest(), b"RIFFtest")
    path = f"/v1/admin/narrations/{record['id']}/publish-to-ivr"
    assert client.post(path, headers=headers, json={"slot": "welcome"}).json()["published"]
    link = callback(client).json()["files"][0]["fileLink"]
    assert client.get(link).content == b"RIFFtest"
    copy = client.get("/v1/admin/pbx/config", headers=headers).json()["copy"]
    copy["welcome"] = "נוסח אחר לגמרי, ללא ההקלטה הישנה."
    client.put("/v1/admin/pbx/config", headers=headers, json=copy)
    assert callback(client).json()["files"][0]["text"] == copy["welcome"]
    assert client.get(link).status_code == 404


def test_reconcile_refuses_to_overwrite_occupied_extension(client, monkeypatch):
    from app.pbx import reconcile_project

    def request(self, action, params=None, **kwargs):
        if action == "folderSettings":
            return {"id": 1, "num": "0765673575"}
        if action == "foldersList":
            return {
                "1": {
                    "id": 1,
                    "children": {
                        "2": {"id": 2, "extension": "99", "name": "Existing other service"}
                    },
                }
            }
        pytest.fail("Must not perform a write")

    monkeypatch.setattr(PBXClient, "request", request)
    with pytest.raises(PBXError, match="99"):
        reconcile_project(client.app.state.settings, client.app.state.business)


def test_first_time_and_direct_entry_need_no_more_choices(client):
    from app.pbx import load_context, quick_opening

    assert "דיבורא" in callback(client).json()["files"][0]["text"]
    assert "5" not in callback(client).json()["files"][0]["text"]
    assert callback(client, isaacMain="1").json()["goTo"] == "/99/7"
    context = load_context(client.app.state.business, "call-one")
    assert context["selected_bot"] == "isaac-basic" and context["mode"] == "free"
    assert "לתפריט" in quick_opening(client.app.state.business, "call-one")
    assert callback(client, "school", PBXcallId="direct-school").json()["goTo"] == "/99/7"
    assert callback(client, "translator", PBXcallId="direct-translation").json()["goTo"] == "/99/7"
    assert load_context(client.app.state.business, "direct-translation")["mode"] == "translation"
    assert client.app.state.business.summary()["gross_receipts_ils"] == 0
    with client.app.state.business.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM usage_allocations").fetchone()[0] == 0


def test_one_time_intro_is_independent_per_service_and_only_after_audio(client):
    from app.pbx import mark_quick_intro, quick_opening

    store = client.app.state.business
    callback(client, "translator")
    customer_id = store.list("customers")[0]["id"]
    assert "לתפריט" in quick_opening(store, "call-one")
    callback(client, "translator", PBXcallId="not-connected-yet")
    assert "לתפריט" in quick_opening(store, "not-connected-yet")
    mark_quick_intro(store, "call-one", customer_id)
    callback(client, "translator", PBXcallId="return-translation")
    assert "לתפריט" not in quick_opening(store, "return-translation")
    callback(client, "school", PBXcallId="first-school")
    assert "לתפריט" in quick_opening(store, "first-school")
    callback(client, "translator", PBXcallId="other-person", PBXphone="0507654321")
    assert "לתפריט" in quick_opening(store, "other-person")


def test_active_course_resumes_with_its_teacher_unless_explicit_free_mode(client):
    from app.business import Course, Enrollment
    from app.pbx import load_context

    store = client.app.state.business
    callback(client)
    customer_id = store.list("customers")[0]["id"]
    course = store.save("courses", Course(
        name="קורס", bot_id="isaac-advanced", active=True,
        lessons=[{"title": "ראשון"}, {"title": "שני"}],
    ).model_dump())
    store.save("enrollments", Enrollment(customer_id=customer_id, course_id=course["id"],
                                         lesson_index=1).model_dump())
    callback(client, "school")
    context = load_context(store, "call-one")
    assert context["selected_bot"] == "isaac-advanced" and context["mode"] == "course"
    assert "שני" in store.lesson_context(customer_id, context["selected_bot"])
    assert callback(client, "mode", isaacMode="2").json()["goTo"] == "/99/7"
    callback(client, "school", PBXcallId="next-day")
    context = load_context(store, "next-day")
    assert context["mode"] == "free" and context["selected_bot"] == "isaac-basic"


def test_website_translation_does_not_overwrite_teacher_or_school_mode(client):
    from app.pbx import load_context, save_preference

    store = client.app.state.business
    callback(client)
    customer_id = store.list("customers")[0]["id"]
    save_preference(store, customer_id, {"selected_bot": "isaac-advanced", "mode": "free"})
    save_preference(store, customer_id, {
        "selected_bot": "isaac-translator", "mode": "translation", "language": "Russian",
    })
    assert store.list("customers")[0]["preferred_bot"] == "isaac-advanced"
    callback(client, "school")
    context = load_context(store, "call-one")
    assert context["selected_bot"] == "isaac-advanced" and context["mode"] == "free"
    callback(client, "translator", PBXcallId="translate")
    assert load_context(store, "translate")["language"] == "Russian"
    callback(client, "languages", isaacLanguage="7", PBXcallId="translate")
    callback(client, "translator", PBXcallId="later-translate")
    assert load_context(store, "later-translate")["language"] == ""


def test_unavailable_service_back_and_hangup_do_not_create_loops(client):
    headers = {"Authorization": "Bearer " + "a" * 32}
    for bot in client.get("/v1/admin/profiles", headers=headers).json()["profiles"]:
        client.put("/v1/admin/bots/" + bot["id"], headers=headers,
                   json={**bot, "phone_enabled": False})
    response = callback(client, "translator").json()
    assert response["type"] == "simpleMenu" and response["name"] == "isaacTranslation"
    assert callback(client, "translator", isaacTranslation="0").json()["goTo"] == "/99"
    assert callback(client, "school").json()["type"] == "simpleMenu"
    assert callback(client, "school", isaacTeacher="9").json()["goTo"] == "/99/9"
    for route in ["school", "translator", "options", "start-translation", "teachers"]:
        assert callback(client, route, PBXcallStatus="HANGUP").json() == {"type": "hangup"}


def test_voice_language_cookie_is_shared_with_phone_and_rejects_arbitrary_values(client):
    from app.pbx import load_context
    from app.session import TutorSession
    from app.technoline import StartFrame

    callback(client, "translator")
    business = client.app.state.business
    customer_id = business.list("customers")[0]["id"]
    business.link_call_segment("call-one", "call-one~voice", "isaac-translator")
    from app.pbx import save_context

    save_context(business, "call-one~voice", load_context(business, "call-one"))
    session = TutorSession(pbx=None, start=StartFrame("call-one~voice", "", "", 8000, 1),
                           settings=client.app.state.settings, progress=client.app.state.progress,
                           business=business)
    session.customer_id = customer_id
    assert session._record_tool_call({"name": "save_translation_language",
                                      "args": {"language": "Russian"}})
    callback(client, "translator", PBXcallId="after-voice")
    assert load_context(business, "after-voice")["language"] == "Russian"
    assert load_context(business, "call-one")["language"] == "Russian"
    assert session._record_tool_call({"name": "save_translation_language",
                                      "args": {"language": "auto"}})
    callback(client, "translator", PBXcallId="after-auto")
    assert load_context(business, "after-auto")["language"] == ""
    assert not session._record_tool_call({"name": "save_translation_language",
                                          "args": {"language": "arbitrary-value"}})
    assert not session._record_tool_call({"name": "save_translation_language",
                                          "args": {"language": []}})
    callback(client, "school", PBXcallId="school-only")
    session.start = StartFrame("school-only~voice", "", "", 8000, 1)
    assert not session._record_tool_call({"name": "save_translation_language",
                                          "args": {"language": "French"}})


def test_reconcile_renames_only_project_and_is_idempotent(client, monkeypatch):
    from copy import deepcopy

    from app.pbx import reconcile_project

    folders = {"/": {"id": 1, "num": "0765673575", "name": "Taxi root"},
               "/99": {"id": 2, "name": "אייזיק · כניסה", "type": "api", "settings": {}},
               "/2": {"id": 3, "name": "Taxi branch", "type": "menu", "settings": {}}}
    untouched = deepcopy({k: v for k, v in folders.items() if k in {"/", "/2"}})
    writes = []

    def request(self, action, params=None, **kwargs):
        params = params or {}
        if action == "foldersList":
            nodes = {p: {**v, "extension": p.rsplit("/", 1)[-1], "children": {}}
                     for p, v in folders.items()}
            for p, node in nodes.items():
                if p != "/":
                    parent = p.rpartition("/")[0] or "/"
                    nodes[parent]["children"][str(node["id"])] = node
            return {"1": nodes["/"]}
        if action == "folderSettings":
            if "path" in params:
                return deepcopy(folders[params["path"]])
            return deepcopy(next(v for v in folders.values()
                                 if str(v["id"]) == str(params["extensionId"])))
        assert action == "extensionSet" and kwargs["write"]
        parent = next(p for p, v in folders.items()
                      if str(v["id"]) == str(params["belowExtension"]))
        path = parent.rstrip("/") + "/" + params["extension"]
        assert path == "/99" or path.startswith("/99/")
        folders[path] = {
            "id": folders.get(path, {}).get("id", len(folders) + 1),
            "name": params["name"], "type": params["type"],
            "settings": {k[9:-1]: v for k, v in params.items() if k.startswith("settings[")},
        }
        writes.append(path)
        return {"status": "OK"}

    monkeypatch.setattr(PBXClient, "request", request)
    first = reconcile_project(client.app.state.settings, client.app.state.business)
    assert "/99/9" in first["changed"] and folders["/99"]["name"] == "דיבורא · כניסה"
    assert {k: folders[k] for k in untouched} == untouched
    assert all(p == "/99" or p.startswith("/99/") for p in writes)
    writes.clear()
    assert reconcile_project(client.app.state.settings, client.app.state.business)["changed"] == []
    assert writes == []


def test_transfer_releases_old_lease_and_capacity_before_next_segment(client, monkeypatch):
    from app.pbx import save_context

    store = client.app.state.business
    store.identify_call("0501234567", "handoff", "ivr")
    save_context(store, "handoff", {"selected_bot": "isaac-basic"})
    seen = []

    class Session:
        def __init__(self, **kwargs):
            self.before_transfer = kwargs["before_transfer"]
            self.pbx = kwargs["pbx"]

        async def run(self):
            capacity_before = client.app.state.call_slots._value
            await self.before_transfer()
            assert client.app.state.call_slots._value == capacity_before + 1
            assert "handoff" not in client.app.state.live_ai_sessions
            assert await client.app.state.progress.claim_call(
                call_id="handoff", profile_id="isaac-translator", owner_id="new-owner",
            )
            seen.append(True)
            await self.pbx.close()

    monkeypatch.setattr("app.main.TutorSession", Session)
    capacity = client.app.state.call_slots._value
    with client.websocket_connect("/v1/technoline/router") as ws:
        ws.send_json({"type": "start", "callId": "handoff", "caller": "0501234567",
                      "token": "router-token", "format": "pcm16;rate=8000;ch=1"})
        assert ws.receive()["type"] == "websocket.close"
    assert seen == [True]
    assert client.app.state.call_slots._value == capacity
    with store.connect() as db:
        owner = db.execute(
            "SELECT owner_id FROM active_calls WHERE call_id='handoff'",
        ).fetchone()[0]
        assert owner == "new-owner"


def test_copy_migration_does_not_undo_subsequent_panel_edits(client):
    headers = {"Authorization": "Bearer " + "a" * 32}
    copy = client.get("/v1/admin/pbx/config", headers=headers).json()["copy"]
    copy["options"] = "נוסח אפשרויות מותאם שנשמר בידי המנהל. לחזרה הקישו 0."
    client.put("/v1/admin/pbx/config", headers=headers, json=copy)
    with TestClient(create_app(client.app.state.settings)) as restarted:
        assert restarted.get("/v1/admin/pbx/config", headers=headers).json()["copy"] == copy

