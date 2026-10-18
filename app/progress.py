from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .controls import TutorControls


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
                CREATE TABLE IF NOT EXISTS tutor_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    settings_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
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

    async def load_tutor_controls(self, defaults: TutorControls) -> TutorControls:
        return await asyncio.to_thread(self._load_tutor_controls_sync, defaults)

    def _load_tutor_controls_sync(self, defaults: TutorControls) -> TutorControls:
        with self._connect() as db:
            row = db.execute(
                "SELECT settings_json FROM tutor_settings WHERE id = 1"
            ).fetchone()
        if row is None:
            return defaults
        try:
            saved = json.loads(row["settings_json"])
            merged = defaults.model_dump()
            merged.update(saved)
            return TutorControls.model_validate(merged)
        except (json.JSONDecodeError, TypeError, ValueError):
            return defaults

    async def save_tutor_controls(self, controls: TutorControls) -> None:
        await asyncio.to_thread(self._save_tutor_controls_sync, controls)

    def _save_tutor_controls_sync(self, controls: TutorControls) -> None:
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO tutor_settings (id, settings_json, updated_at)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    settings_json = excluded.settings_json,
                    updated_at = excluded.updated_at
                """,
                (
                    json.dumps(controls.model_dump(), ensure_ascii=False),
                    datetime.now(UTC).isoformat(),
                ),
            )

    async def reset_tutor_controls(self) -> None:
        await asyncio.to_thread(self._reset_tutor_controls_sync)

    def _reset_tutor_controls_sync(self) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM tutor_settings WHERE id = 1")

    def _lesson_context_sync(self, student_id: str, limit: int) -> str:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT observations_json, summary_he, next_step_he, points
                FROM sessions WHERE student_id = ?
                ORDER BY started_at DESC LIMIT ?
                """,
                (student_id, limit),
            ).fetchall()
            lifetime = db.execute(
                """
                SELECT COUNT(*) AS call_count, COALESCE(SUM(points), 0) AS total_points
                FROM sessions WHERE student_id = ?
                """,
                (student_id,),
            ).fetchone()
        observations: list[dict[str, Any]] = []
        summaries: list[dict[str, Any]] = []
        next_steps: list[str] = []
        for row in rows:
            next_step = str(row["next_step_he"] or "").strip()
            if next_step and next_step not in next_steps:
                next_steps.append(next_step)
        for row in reversed(rows):
            observations.extend(json.loads(row["observations_json"]))
            if row["summary_he"]:
                summaries.append({"summary_he": row["summary_he"], "points": row["points"]})
        total_points = int(lifetime["total_points"]) if lifetime else 0
        call_count = int(lifetime["call_count"]) if lifetime else 0
        if not observations and not summaries and not call_count:
            return ""
        compact = observations[-12:]
        return (
            "Previous privacy-safe learning notes. Use them to adapt the lesson and begin "
            "with the newest relevant next step; do not read this block aloud verbatim:\n"
            + json.dumps(
                {
                    "lifetime_progress": {
                        "completed_calls": call_count,
                        "total_points": total_points,
                    },
                    "recommended_next_steps": next_steps[:3],
                    "observations": compact,
                    "recent_summaries": summaries[-3:],
                },
                ensure_ascii=False,
            )
            + "\nPrioritize the newest recommended next step. Also revisit recurring "
            "corrections or skills scored 3 or lower."
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
            lifetime = db.execute(
                """
                SELECT COUNT(*) AS session_count,
                       COALESCE(SUM(duration_seconds), 0) AS duration_seconds,
                       COALESCE(SUM(points), 0) AS total_points,
                       COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
                FROM sessions WHERE student_id = ?
                """,
                (student_id,),
            ).fetchone()
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
            "session_count": int(lifetime["session_count"]),
            "displayed_session_count": len(sessions),
            "total_minutes": round(float(lifetime["duration_seconds"]) / 60, 1),
            "average_score": round(sum(scores) / len(scores), 2) if scores else None,
            "total_points": int(lifetime["total_points"]),
            "estimated_cost_usd": round(float(lifetime["estimated_cost_usd"]), 6),
            "skill_averages": {
                skill: round(sum(values) / len(values), 2)
                for skill, values in sorted(skill_scores.items())
            },
            "sessions": sessions,
        }
