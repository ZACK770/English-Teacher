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
                    transcript_json TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_student_started
                ON sessions(student_id, started_at DESC);
                """
            )

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
        )

    def _save_sync(self, *values: Any) -> None:
        with self._connect() as db:
            db.execute(
                """
                INSERT OR IGNORE INTO sessions (
                    student_id, call_id, started_at, ended_at, duration_seconds,
                    learner_turns, tutor_turns, observations_json, transcript_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                SELECT observations_json FROM sessions WHERE student_id = ?
                ORDER BY started_at DESC LIMIT ?
                """,
                (student_id, limit),
            ).fetchall()
        observations: list[dict[str, Any]] = []
        for row in reversed(rows):
            observations.extend(json.loads(row["observations_json"]))
        if not observations:
            return ""
        compact = observations[-12:]
        return (
            "\nPrevious privacy-safe learning notes. Use them only to adapt the lesson; "
            "do not read them aloud verbatim:\n" + json.dumps(compact, ensure_ascii=False)
        )

    def _report_sync(self, student_id: str, limit: int) -> dict[str, Any]:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT started_at, duration_seconds, learner_turns, tutor_turns,
                       observations_json
                FROM sessions WHERE student_id = ?
                ORDER BY started_at DESC LIMIT ?
                """,
                (student_id, limit),
            ).fetchall()
        sessions = []
        scores: list[int] = []
        for row in rows:
            observations = json.loads(row["observations_json"])
            scores.extend(int(item["score"]) for item in observations)
            sessions.append(
                {
                    "started_at": row["started_at"],
                    "duration_seconds": row["duration_seconds"],
                    "learner_turns": row["learner_turns"],
                    "tutor_turns": row["tutor_turns"],
                    "observations": observations,
                }
            )
        return {
            "student_id": student_id,
            "session_count": len(sessions),
            "total_minutes": round(sum(x["duration_seconds"] for x in sessions) / 60, 1),
            "average_score": round(sum(scores) / len(scores), 2) if scores else None,
            "sessions": sessions,
        }
