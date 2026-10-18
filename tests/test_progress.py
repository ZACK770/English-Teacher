from datetime import UTC, datetime

import pytest

from app.config import Settings
from app.controls import TutorControls
from app.progress import LessonSummary, Observation, ProgressStore, UsageTotals


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
    await store.save_tutor_controls(changed)
    loaded = await store.load_tutor_controls(defaults)
    assert loaded.learning_goal == "מילים למסעדה"
    assert loaded.vad_silence_ms == 900

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
