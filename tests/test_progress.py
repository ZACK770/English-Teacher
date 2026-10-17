from datetime import UTC, datetime

import pytest

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
