from pathlib import Path

from pydantic import SecretStr

from app.config import Settings
from app.progress import ProgressStore
from app.session import TutorSession
from app.technoline import StartFrame


def make_session(tmp_path: Path) -> TutorSession:
    settings = Settings(
        gemini_api_key=SecretStr("gemini-test"),
        admin_bearer_secret=SecretStr("a" * 32),
        database_path=tmp_path / "progress.db",
    )
    return TutorSession(
        pbx=None,  # type: ignore[arg-type]
        start=StartFrame("call-1", "", "2614d922d06b4f", 8000, 1),
        settings=settings,
        progress=ProgressStore(settings.database_path),
    )


def test_usage_metadata_cost_is_accumulated_by_modality(tmp_path) -> None:
    session = make_session(tmp_path)
    session._record_usage(
        {
            "promptTokensDetails": [
                {"modality": "TEXT", "tokenCount": 100},
                {"modality": "AUDIO", "tokenCount": 200},
            ],
            "responseTokensDetails": [
                {"modality": "TEXT", "tokenCount": 20},
                {"modality": "AUDIO", "tokenCount": 50},
            ],
            "thoughtsTokenCount": 10,
        }
    )
    usage = session._usage_totals()
    assert usage.input_text_tokens == 100
    assert usage.input_audio_tokens == 200
    assert usage.output_text_tokens == 20
    assert usage.output_audio_tokens == 50
    assert usage.thoughts_tokens == 10
    assert usage.cost_basis == "gemini_usage_metadata"
    assert usage.estimated_cost_usd == 0.00141


def test_lesson_summary_points_are_clamped(tmp_path) -> None:
    session = make_session(tmp_path)
    assert session._record_tool_call(
        {
            "name": "record_lesson_summary",
            "args": {
                "summary_he": "סיכום",
                "success_he": "הצלחה",
                "next_step_he": "המשך",
                "points": 140,
            },
        }
    )
    assert session.lesson_summary is not None
    assert session.lesson_summary.points == 100
