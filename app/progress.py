from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Observation:
    skill: str
    result: str
    correction: str
    score: int


@dataclass(frozen=True)
class LessonSummary:
    summary_he: str
    success_he: str
    next_step_he: str
    points: int


@dataclass(frozen=True)
class UsageTotals:
    input_text_tokens: int = 0
    input_audio_tokens: int = 0
    output_text_tokens: int = 0
    output_audio_tokens: int = 0
    thoughts_tokens: int = 0
    estimated_cost_usd: float = 0.0
    cost_basis: str = "none"


class ProgressStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    async def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(self._initialize_sync)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _initialize_sync(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL,
                    call_id TEXT NOT NULL UNIQUE,
                    started_at TEXT NOT NULL,
                    ended_at TEXT NOT NULL,
                    duration_seconds INTEGER NOT NULL,
                    learner_turns INTEGER NOT NULL,
                    tutor_turns INTEGER NOT NULL,
                    observations_json TEXT NOT NULL,
                    transcript_json TEXT,
                    summary_he TEXT NOT NULL DEFAULT '',
                    success_he TEXT NOT NULL DEFAULT '',
                    next_step_he TEXT NOT NULL DEFAULT '',
                    points INTEGER NOT NULL DEFAULT 0,
                    input_text_tokens INTEGER NOT NULL DEFAULT 0,
                    input_audio_tokens INTEGER NOT NULL DEFAULT 0,
                    output_text_tokens INTEGER NOT NULL DEFAULT 0,
                    output_audio_tokens INTEGER NOT NULL DEFAULT 0,
                    thoughts_tokens INTEGER NOT NULL DEFAULT 0,
                    estimated_cost_usd REAL NOT NULL DEFAULT 0,
                    cost_basis TEXT NOT NULL DEFAULT 'none',
                    model TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_student_started
                ON sessions(student_id, started_at DESC);
                """
            )
            existing = {
                str(row["name"]) for row in db.execute("PRAGMA table_info(sessions)").fetchall()
            }
            migrations = {
                "summary_he": "TEXT NOT NULL DEFAULT ''",
                "success_he": "TEXT NOT NULL DEFAULT ''",
                "next_step_he": "TEXT NOT NULL DEFAULT ''",
                "points": "INTEGER NOT NULL DEFAULT 0",
                "input_text_tokens": "INTEGER NOT NULL DEFAULT 0",
                "input_audio_tokens": "INTEGER NOT NULL DEFAULT 0",
                "output_text_tokens": "INTEGER NOT NULL DEFAULT 0",
                "output_audio_tokens": "INTEGER NOT NULL DEFAULT 0",
                "thoughts_tokens": "INTEGER NOT NULL DEFAULT 0",
                "estimated_cost_usd": "REAL NOT NULL DEFAULT 0",
                "cost_basis": "TEXT NOT NULL DEFAULT 'none'",
                "model": "TEXT NOT NULL DEFAULT ''",
            }
            for column, definition in migrations.items():
                if column not in existing:
                    db.execute(f"ALTER TABLE sessions ADD COLUMN {column} {definition}")

    async def save_session(
        self,
        *,
        student_id: str,
        call_id: str,
        started_at: datetime,
        learner_turns: int,
        tutor_turns: int,
        observations: list[Observation],
        transcript: list[dict[str, str]] | None,
        summary: LessonSummary,
        usage: UsageTotals,
        model: str,
    ) -> None:
        ended_at = datetime.now(UTC)
        duration = max(0, int((ended_at - started_at).total_seconds()))
        await asyncio.to_thread(
            self._save_sync,
            student_id,
            call_id,
            started_at.isoformat(),
            ended_at.isoformat(),
            duration,
            learner_turns,
            tutor_turns,
            json.dumps([asdict(item) for item in observations], ensure_ascii=False),
            json.dumps(transcript, ensure_ascii=False) if transcript is not None else None,
            summary.summary_he,
            summary.success_he,
            summary.next_step_he,
            summary.points,
            usage.input_text_tokens,
            usage.input_audio_tokens,
            usage.output_text_tokens,
            usage.output_audio_tokens,
            usage.thoughts_tokens,
            usage.estimated_cost_usd,
            usage.cost_basis,
            model,
        )

    def _save_sync(self, *values: Any) -> None:
        with self._connect() as db:
            db.execute(
                """
                INSERT OR IGNORE INTO sessions (
                    student_id, call_id, started_at, ended_at, duration_seconds,
                    learner_turns, tutor_turns, observations_json, transcript_json,
                    summary_he, success_he, next_step_he, points,
                    input_text_tokens, input_audio_tokens, output_text_tokens,
                    output_audio_tokens, thoughts_tokens, estimated_cost_usd,
                    cost_basis, model
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )

    async def report(self, student_id: str, limit: int = 20) -> dict[str, Any]:
        return await asyncio.to_thread(self._report_sync, student_id, limit)

    async def lesson_context(self, student_id: str, limit: int = 5) -> str:
        return await asyncio.to_thread(self._lesson_context_sync, student_id, limit)

    def _lesson_context_sync(self, student_id: str, limit: int) -> str:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT observations_json, summary_he, points FROM sessions WHERE student_id = ?
                ORDER BY started_at DESC LIMIT ?
                """,
                (student_id, limit),
            ).fetchall()
        observations: list[dict[str, Any]] = []
        summaries: list[dict[str, Any]] = []
        for row in reversed(rows):
            observations.extend(json.loads(row["observations_json"]))
            if row["summary_he"]:
                summaries.append({"summary_he": row["summary_he"], "points": row["points"]})
        if not observations and not summaries:
            return ""
        compact = observations[-12:]
        return (
            "\nPrevious privacy-safe learning notes. Use them only to adapt the lesson; "
            "do not read them aloud verbatim:\n"
            + json.dumps(
                {"observations": compact, "recent_summaries": summaries[-3:]},
                ensure_ascii=False,
            )
        )

    def _report_sync(self, student_id: str, limit: int) -> dict[str, Any]:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT started_at, duration_seconds, learner_turns, tutor_turns,
                       observations_json, summary_he, success_he, next_step_he,
                       points, input_text_tokens, input_audio_tokens,
                       output_text_tokens, output_audio_tokens, thoughts_tokens,
                       estimated_cost_usd, cost_basis, model
                FROM sessions WHERE student_id = ?
                ORDER BY started_at DESC LIMIT ?
                """,
                (student_id, limit),
            ).fetchall()
        sessions = []
        scores: list[int] = []
        skill_scores: dict[str, list[int]] = {}
        for row in rows:
            observations = json.loads(row["observations_json"])
            scores.extend(int(item["score"]) for item in observations)
            for item in observations:
                skill_scores.setdefault(str(item["skill"]), []).append(int(item["score"]))
            sessions.append(
                {
                    "started_at": row["started_at"],
                    "duration_seconds": row["duration_seconds"],
                    "learner_turns": row["learner_turns"],
                    "tutor_turns": row["tutor_turns"],
                    "observations": observations,
                    "summary_he": row["summary_he"],
                    "success_he": row["success_he"],
                    "next_step_he": row["next_step_he"],
                    "points": row["points"],
                    "estimated_cost_usd": round(row["estimated_cost_usd"], 6),
                    "cost_basis": row["cost_basis"],
                    "model": row["model"],
                    "usage": {
                        "input_text_tokens": row["input_text_tokens"],
                        "input_audio_tokens": row["input_audio_tokens"],
                        "output_text_tokens": row["output_text_tokens"],
                        "output_audio_tokens": row["output_audio_tokens"],
                        "thoughts_tokens": row["thoughts_tokens"],
                    },
                }
            )
        return {
            "student_id": student_id,
            "session_count": len(sessions),
            "total_minutes": round(sum(x["duration_seconds"] for x in sessions) / 60, 1),
            "average_score": round(sum(scores) / len(scores), 2) if scores else None,
            "total_points": sum(int(x["points"]) for x in sessions),
            "estimated_cost_usd": round(
                sum(float(x["estimated_cost_usd"]) for x in sessions), 6
            ),
            "skill_averages": {
                skill: round(sum(values) / len(values), 2)
                for skill, values in sorted(skill_scores.items())
            },
            "sessions": sessions,
        }
