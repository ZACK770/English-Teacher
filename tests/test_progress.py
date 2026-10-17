from datetime import UTC, datetime

import pytest

from app.progress import Observation, ProgressStore


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
    )
    report = await store.report("student")
    assert report["session_count"] == 1
    assert report["average_score"] == 4
    assert report["sessions"][0]["learner_turns"] == 3
