from datetime import UTC, datetime

import pytest

from app.config import Settings
from app.controls import TutorControls
from app.progress import LessonSummary, Observation, ProgressStore, UsageTotals
from app.prompting import compile_prompt


@pytest.mark.asyncio
async def test_progress_round_trip_without_transcript(tmp_path) -> None:
    store = ProgressStore(tmp_path / "progress.db")
    await store.initialize()
    await store.save_session(
        student_id="student",
        call_id="call-1",
        started_at=datetime.now(UTC),
        learner_turns=3,
        tutor_turns=4,
        observations=[Observation("grammar", "Good past tense", "Use went", 4)],
        transcript=None,
        summary=LessonSummary("תרגול זמן עבר", "שימוש טוב במשפט", "לתרגל went", 42),
        usage=UsageTotals(
            input_audio_tokens=100,
            output_audio_tokens=50,
            estimated_cost_usd=0.0009,
            cost_basis="gemini_usage_metadata",
        ),
        model="models/gemini-3.8-live",
    )
    report = await store.report("student")
    assert report["session_count"] == 1
    assert report["average_score"] == 4
    assert report["total_points"] == 42
    assert report["estimated_cost_usd"] == 0.0009
    assert report["skill_averages"] == {"grammar": 4.0}
    assert report["sessions"][0]["learner_turns"] == 3
    assert report["sessions"][0]["summary_he"] == "תרגול זמן עבר"


@pytest.mark.asyncio
async def test_controls_and_lifetime_context_are_persistent(tmp_path) -> None:
    store = ProgressStore(tmp_path / "progress.db")
    await store.initialize()
    defaults = TutorControls.from_settings(
        Settings(
            gemini_api_key="gemini-test",
            admin_bearer_secret="a" * 32,
            database_path=tmp_path / "progress.db",
        )
    )
    changed = defaults.model_copy(
        update={"learning_goal": "מילים למסעדה", "vad_silence_ms": 900}
    )
    await store.save_tutor_controls("student", changed)
    loaded = await store.load_tutor_controls("student", defaults)
    assert loaded.learning_goal == "מילים למסעדה"
    assert loaded.vad_silence_ms == 900
    adult = await store.load_tutor_controls("adult", defaults)
    assert adult.learning_goal == defaults.learning_goal

    for index in range(6):
        await store.save_session(
            student_id="student",
            call_id=f"call-{index}",
            started_at=datetime.now(UTC),
            learner_turns=1,
            tutor_turns=1,
            observations=[Observation("vocabulary", "טוב", "לתרגל שוב", 3)],
            transcript=None,
            summary=LessonSummary("סיכום", "הצלחה", f"צעד {index}", 10),
            usage=UsageTotals(),
            model="models/gemini-3.8-live",
        )
    context = await store.lesson_context("student", limit=5)
    assert '"total_points": 60' in context
    assert '"completed_calls": 6' in context
    assert "צעד 5" in context
    report = await store.report("student", limit=2)
    assert report["session_count"] == 6
    assert report["displayed_session_count"] == 2
    assert report["total_points"] == 60


@pytest.mark.asyncio
async def test_active_call_lease_blocks_duplicates_and_completed_calls(tmp_path) -> None:
    store = ProgressStore(tmp_path / "progress.db")
    await store.initialize()
    second_instance = ProgressStore(tmp_path / "progress.db")
    await second_instance.initialize()
    assert await store.claim_call(
        call_id="same-call", profile_id="student", owner_id="owner-1"
    )
    assert not await second_instance.claim_call(
        call_id="same-call", profile_id="student", owner_id="owner-2"
    )
    assert await store.renew_call_lease("same-call", "owner-1")
    await store.release_call("same-call", "owner-1")
    assert await store.claim_call(
        call_id="same-call", profile_id="student", owner_id="owner-2"
    )
    await store.release_call("same-call", "owner-2")

    await store.save_session(
        student_id="student",
        call_id="same-call",
        started_at=datetime.now(UTC),
        learner_turns=0,
        tutor_turns=1,
        observations=[],
        transcript=None,
        summary=LessonSummary("סיכום", "", "", 0),
        usage=UsageTotals(),
        model="test-model",
    )
    assert not await store.claim_call(
        call_id="same-call", profile_id="student", owner_id="owner-3"
    )


@pytest.mark.asyncio
async def test_diagnostic_log_is_profile_scoped(tmp_path) -> None:
    store = ProgressStore(tmp_path / "progress.db")
    await store.initialize()
    await store.log_diagnostic(
        profile_id="student",
        call_id="call-1",
        event_type="tutor_turn_complete",
        details={"tutor_turn": 1},
    )
    assert len(await store.recent_diagnostics("student")) == 1
    assert await store.recent_diagnostics("adult") == []


@pytest.mark.asyncio
async def test_prompt_turn_and_latency_trace_share_one_call(tmp_path) -> None:
    database = tmp_path / "progress.db"
    active = Settings(
        gemini_api_key="gemini-test",
        admin_bearer_secret="a" * 32,
        database_path=database,
    )
    controls = TutorControls.from_settings(active)
    store = ProgressStore(database)
    await store.initialize()
    await store.seed_bot(
        bot_id="student",
        label="מורה",
        audience="child",
        channel_id="channel",
        controls=controls,
    )
    artifact = compile_prompt(
        controls=controls,
        history_context="history",
        settings=active,
        profile_id="student",
    )
    await store.save_prompt_snapshot(
        profile_id="student", call_id="trace-call", artifact=artifact
    )
    await store.log_conversation_turn(
        profile_id="student",
        call_id="trace-call",
        direction="input",
        text="Hello",
    )
    await store.log_conversation_turn(
        profile_id="student",
        call_id="trace-call",
        direction="output",
        text="Hi there",
    )
    await store.log_latency(
        profile_id="student",
        call_id="trace-call",
        event_name="first_gemini_audio",
        since_call_start_ms=320.5,
        since_previous_ms=110.25,
    )
    traces = await store.recent_traces("student")
    assert traces[0]["fingerprint"] == artifact.fingerprint
    assert [turn["direction"] for turn in traces[0]["turns"]] == ["input", "output"]
    assert traces[0]["latency"][0]["since_call_start_ms"] == 320.5
