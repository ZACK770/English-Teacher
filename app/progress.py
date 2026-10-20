from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .bots import BotCreate, BotUpdate
from .controls import TutorControls
from .prompting import PromptArtifact


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
    def __init__(self, path: Path, legacy_profile_id: str = "student") -> None:
        self.path = path
        self.legacy_profile_id = legacy_profile_id

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
                CREATE TABLE IF NOT EXISTS tutor_profile_settings (
                    profile_id TEXT PRIMARY KEY,
                    settings_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS active_calls (
                    call_id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    acquired_at REAL NOT NULL,
                    lease_expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS diagnostic_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    call_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    details_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_diagnostics_profile_created
                ON diagnostic_events(profile_id, id DESC);
                CREATE TABLE IF NOT EXISTS bots (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    role TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    audience TEXT NOT NULL DEFAULT 'general',
                    channel_id TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    active_version INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS bot_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bot_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    settings_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(bot_id) REFERENCES bots(id),
                    UNIQUE(bot_id, version)
                );
                CREATE INDEX IF NOT EXISTS idx_bot_versions_bot
                ON bot_versions(bot_id, version DESC);
                CREATE TABLE IF NOT EXISTS prompt_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    call_id TEXT NOT NULL UNIQUE,
                    bot_version INTEGER NOT NULL DEFAULT 0,
                    fingerprint TEXT NOT NULL,
                    system_instruction TEXT NOT NULL,
                    opening_message TEXT NOT NULL,
                    history_context TEXT NOT NULL,
                    setup_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_prompt_snapshots_profile
                ON prompt_snapshots(profile_id, id DESC);
                CREATE TABLE IF NOT EXISTS conversation_turns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    call_id TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    text TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_turns_call
                ON conversation_turns(call_id, id);
                CREATE TABLE IF NOT EXISTS latency_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    call_id TEXT NOT NULL,
                    event_name TEXT NOT NULL,
                    since_call_start_ms REAL NOT NULL,
                    since_previous_ms REAL NOT NULL,
                    details_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_latency_call
                ON latency_events(call_id, id);
                """
            )
            legacy = db.execute(
                "SELECT settings_json, updated_at FROM tutor_settings WHERE id = 1"
            ).fetchone()
            if legacy is not None:
                db.execute(
                    """
                    INSERT OR IGNORE INTO tutor_profile_settings (
                        profile_id, settings_json, updated_at
                    ) VALUES (?, ?, ?)
                    """,
                    (
                        self.legacy_profile_id,
                        legacy["settings_json"],
                        legacy["updated_at"],
                    ),
                )
            db.execute("DELETE FROM active_calls WHERE lease_expires_at <= ?", (time.time(),))
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

    async def load_tutor_controls(
        self, profile_id: str, defaults: TutorControls
    ) -> TutorControls:
        return await asyncio.to_thread(
            self._load_tutor_controls_sync, profile_id, defaults
        )

    def _load_tutor_controls_sync(
        self, profile_id: str, defaults: TutorControls
    ) -> TutorControls:
        with self._connect() as db:
            row = db.execute(
                "SELECT settings_json FROM tutor_profile_settings WHERE profile_id = ?",
                (profile_id,),
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

    async def save_tutor_controls(
        self, profile_id: str, controls: TutorControls
    ) -> int:
        return await asyncio.to_thread(
            self._save_tutor_controls_sync, profile_id, controls
        )

    def _save_tutor_controls_sync(
        self, profile_id: str, controls: TutorControls
    ) -> int:
        now = datetime.now(UTC).isoformat()
        settings_json = json.dumps(controls.model_dump(), ensure_ascii=False)
        with self._connect() as db:
            bot = db.execute(
                "SELECT active_version FROM bots WHERE id = ?", (profile_id,)
            ).fetchone()
            if bot is None:
                db.execute(
                    """
                    INSERT INTO bots (
                        id, label, role, description, audience, channel_id,
                        enabled, active_version, created_at, updated_at
                    ) VALUES (?, ?, 'teacher', '', 'general', NULL, 1, 0, ?, ?)
                    """,
                    (profile_id, profile_id, now, now),
                )
                bot = {"active_version": 0}
            version = int(bot["active_version"]) + 1
            db.execute(
                """
                INSERT INTO tutor_profile_settings (profile_id, settings_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(profile_id) DO UPDATE SET
                    settings_json = excluded.settings_json,
                    updated_at = excluded.updated_at
                """,
                (
                    profile_id,
                    settings_json,
                    now,
                ),
            )
            db.execute(
                """
                INSERT INTO bot_versions (bot_id, version, settings_json, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (profile_id, version, settings_json, now),
            )
            db.execute(
                """
                UPDATE bots SET active_version = ?, updated_at = ? WHERE id = ?
                """,
                (version, now, profile_id),
            )
        return version

    async def reset_tutor_controls(self, profile_id: str) -> None:
        await asyncio.to_thread(self._reset_tutor_controls_sync, profile_id)

    def _reset_tutor_controls_sync(self, profile_id: str) -> None:
        with self._connect() as db:
            db.execute(
                "DELETE FROM tutor_profile_settings WHERE profile_id = ?",
                (profile_id,),
            )

    async def seed_bot(
        self,
        *,
        bot_id: str,
        label: str,
        audience: str,
        channel_id: str | None,
        controls: TutorControls,
    ) -> None:
        await asyncio.to_thread(
            self._seed_bot_sync,
            bot_id,
            label,
            audience,
            channel_id,
            controls,
        )

    def _seed_bot_sync(
        self,
        bot_id: str,
        label: str,
        audience: str,
        channel_id: str | None,
        controls: TutorControls,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO bots (
                    id, label, role, description, audience, channel_id,
                    enabled, active_version, created_at, updated_at
                ) VALUES (?, ?, 'teacher', '', ?, ?, 1, 0, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    channel_id = COALESCE(bots.channel_id, excluded.channel_id)
                """,
                (bot_id, label, audience, channel_id, now, now),
            )
            saved = db.execute(
                "SELECT settings_json FROM tutor_profile_settings WHERE profile_id = ?",
                (bot_id,),
            ).fetchone()
            if saved is None:
                settings_json = json.dumps(controls.model_dump(), ensure_ascii=False)
                db.execute(
                    """
                    INSERT INTO tutor_profile_settings (
                        profile_id, settings_json, updated_at
                    ) VALUES (?, ?, ?)
                    """,
                    (bot_id, settings_json, now),
                )
                db.execute(
                    """
                    INSERT OR IGNORE INTO bot_versions (
                        bot_id, version, settings_json, created_at
                    ) VALUES (?, 1, ?, ?)
                    """,
                    (bot_id, settings_json, now),
                )
                db.execute(
                    "UPDATE bots SET active_version = 1 WHERE id = ?",
                    (bot_id,),
                )
            else:
                version = db.execute(
                    "SELECT active_version FROM bots WHERE id = ?", (bot_id,)
                ).fetchone()
                if version is not None and int(version["active_version"]) == 0:
                    db.execute(
                        """
                        INSERT OR IGNORE INTO bot_versions (
                            bot_id, version, settings_json, created_at
                        ) VALUES (?, 1, ?, ?)
                        """,
                        (bot_id, saved["settings_json"], now),
                    )
                    db.execute(
                        "UPDATE bots SET active_version = 1 WHERE id = ?",
                        (bot_id,),
                    )

    async def list_bots(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_bots_sync)

    def _list_bots_sync(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT id, label, role, description, audience, channel_id,
                       enabled, active_version, created_at, updated_at
                FROM bots ORDER BY created_at, id
                """
            ).fetchall()
        return [self._bot_row(row) for row in rows]

    async def get_bot(self, bot_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_bot_sync, bot_id)

    def _get_bot_sync(self, bot_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                """
                SELECT id, label, role, description, audience, channel_id,
                       enabled, active_version, created_at, updated_at
                FROM bots WHERE id = ?
                """,
                (bot_id,),
            ).fetchone()
        return self._bot_row(row) if row is not None else None

    @staticmethod
    def _bot_row(row: sqlite3.Row) -> dict[str, Any]:
        bot_id = str(row["id"])
        return {
            "id": bot_id,
            "label": row["label"],
            "role": row["role"],
            "description": row["description"],
            "audience": row["audience"],
            "channel_id": row["channel_id"],
            "channel_configured": bool(row["channel_id"]),
            "enabled": bool(row["enabled"]),
            "active_version": int(row["active_version"]),
            "websocket_path": f"/v1/technoline/stream/bots/{bot_id}",
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    async def create_bot(
        self, bot: BotCreate, controls: TutorControls
    ) -> dict[str, Any]:
        await asyncio.to_thread(self._create_bot_sync, bot, controls)
        created = await self.get_bot(bot.id)
        if created is None:
            raise RuntimeError("bot creation failed")
        return created

    def _create_bot_sync(self, bot: BotCreate, controls: TutorControls) -> None:
        now = datetime.now(UTC).isoformat()
        settings_json = json.dumps(controls.model_dump(), ensure_ascii=False)
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO bots (
                    id, label, role, description, audience, channel_id,
                    enabled, active_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    bot.id,
                    bot.label,
                    bot.role,
                    bot.description,
                    bot.audience,
                    bot.channel_id,
                    int(bot.enabled),
                    now,
                    now,
                ),
            )
            db.execute(
                """
                INSERT INTO tutor_profile_settings (
                    profile_id, settings_json, updated_at
                ) VALUES (?, ?, ?)
                """,
                (bot.id, settings_json, now),
            )
            db.execute(
                """
                INSERT INTO bot_versions (bot_id, version, settings_json, created_at)
                VALUES (?, 1, ?, ?)
                """,
                (bot.id, settings_json, now),
            )

    async def update_bot(self, bot_id: str, update: BotUpdate) -> dict[str, Any] | None:
        await asyncio.to_thread(self._update_bot_sync, bot_id, update)
        return await self.get_bot(bot_id)

    def _update_bot_sync(self, bot_id: str, update: BotUpdate) -> None:
        with self._connect() as db:
            cursor = db.execute(
                """
                UPDATE bots SET label = ?, role = ?, description = ?, audience = ?,
                    channel_id = ?, enabled = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    update.label,
                    update.role,
                    update.description,
                    update.audience,
                    update.channel_id,
                    int(update.enabled),
                    datetime.now(UTC).isoformat(),
                    bot_id,
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(bot_id)

    async def bot_versions(self, bot_id: str, limit: int = 50) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            self._bot_versions_sync, bot_id, max(1, min(limit, 100))
        )

    def _bot_versions_sync(self, bot_id: str, limit: int) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT version, settings_json, created_at
                FROM bot_versions WHERE bot_id = ?
                ORDER BY version DESC LIMIT ?
                """,
                (bot_id, limit),
            ).fetchall()
        return [
            {
                "version": int(row["version"]),
                "created_at": row["created_at"],
                "controls": json.loads(row["settings_json"]),
            }
            for row in rows
        ]

    async def claim_call(
        self,
        *,
        call_id: str,
        profile_id: str,
        owner_id: str,
        lease_seconds: int = 20,
    ) -> bool:
        return await asyncio.to_thread(
            self._claim_call_sync,
            call_id,
            profile_id,
            owner_id,
            lease_seconds,
        )

    def _claim_call_sync(
        self,
        call_id: str,
        profile_id: str,
        owner_id: str,
        lease_seconds: int,
    ) -> bool:
        now = time.time()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM active_calls WHERE lease_expires_at <= ?", (now,))
            completed = db.execute(
                "SELECT 1 FROM sessions WHERE call_id = ? LIMIT 1", (call_id,)
            ).fetchone()
            if completed is not None:
                return False
            try:
                db.execute(
                    """
                    INSERT INTO active_calls (
                        call_id, profile_id, owner_id, acquired_at, lease_expires_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (call_id, profile_id, owner_id, now, now + lease_seconds),
                )
            except sqlite3.IntegrityError:
                return False
        return True

    async def renew_call_lease(
        self, call_id: str, owner_id: str, lease_seconds: int = 20
    ) -> bool:
        return await asyncio.to_thread(
            self._renew_call_lease_sync, call_id, owner_id, lease_seconds
        )

    def _renew_call_lease_sync(
        self, call_id: str, owner_id: str, lease_seconds: int
    ) -> bool:
        with self._connect() as db:
            cursor = db.execute(
                """
                UPDATE active_calls SET lease_expires_at = ?
                WHERE call_id = ? AND owner_id = ?
                """,
                (time.time() + lease_seconds, call_id, owner_id),
            )
            return cursor.rowcount == 1

    async def release_call(self, call_id: str, owner_id: str) -> None:
        await asyncio.to_thread(self._release_call_sync, call_id, owner_id)

    def _release_call_sync(self, call_id: str, owner_id: str) -> None:
        with self._connect() as db:
            db.execute(
                "DELETE FROM active_calls WHERE call_id = ? AND owner_id = ?",
                (call_id, owner_id),
            )

    async def log_diagnostic(
        self,
        *,
        profile_id: str,
        call_id: str,
        event_type: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        await asyncio.to_thread(
            self._log_diagnostic_sync,
            profile_id,
            call_id,
            event_type,
            details or {},
        )

    def _log_diagnostic_sync(
        self,
        profile_id: str,
        call_id: str,
        event_type: str,
        details: dict[str, Any],
    ) -> None:
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO diagnostic_events (
                    created_at, profile_id, call_id, event_type, details_json
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(UTC).isoformat(),
                    profile_id,
                    call_id,
                    event_type[:80],
                    json.dumps(details, ensure_ascii=False, separators=(",", ":")),
                ),
            )
            db.execute(
                """
                DELETE FROM diagnostic_events
                WHERE id <= COALESCE((SELECT MAX(id) - 5000 FROM diagnostic_events), 0)
                """
            )

    async def recent_diagnostics(
        self, profile_id: str, limit: int = 100
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            self._recent_diagnostics_sync, profile_id, max(1, min(limit, 300))
        )

    def _recent_diagnostics_sync(
        self, profile_id: str, limit: int
    ) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT created_at, call_id, event_type, details_json
                FROM diagnostic_events WHERE profile_id = ?
                ORDER BY id DESC LIMIT ?
                """,
                (profile_id, limit),
            ).fetchall()
        return [
            {
                "created_at": row["created_at"],
                "call_id": row["call_id"],
                "event_type": row["event_type"],
                "details": json.loads(row["details_json"]),
            }
            for row in rows
        ]

    async def save_prompt_snapshot(
        self,
        *,
        profile_id: str,
        call_id: str,
        artifact: PromptArtifact,
    ) -> None:
        await asyncio.to_thread(
            self._save_prompt_snapshot_sync,
            profile_id,
            call_id,
            artifact,
        )

    def _save_prompt_snapshot_sync(
        self,
        profile_id: str,
        call_id: str,
        artifact: PromptArtifact,
    ) -> None:
        with self._connect() as db:
            bot = db.execute(
                "SELECT active_version FROM bots WHERE id = ?", (profile_id,)
            ).fetchone()
            version = int(bot["active_version"]) if bot is not None else 0
            db.execute(
                """
                INSERT INTO prompt_snapshots (
                    created_at, profile_id, call_id, bot_version, fingerprint,
                    system_instruction, opening_message, history_context, setup_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(call_id) DO UPDATE SET
                    bot_version = excluded.bot_version,
                    fingerprint = excluded.fingerprint,
                    system_instruction = excluded.system_instruction,
                    opening_message = excluded.opening_message,
                    history_context = excluded.history_context,
                    setup_json = excluded.setup_json
                """,
                (
                    datetime.now(UTC).isoformat(),
                    profile_id,
                    call_id,
                    version,
                    artifact.fingerprint,
                    artifact.system_instruction,
                    artifact.opening_message,
                    artifact.history_context,
                    json.dumps(
                        artifact.setup_message,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                ),
            )

    async def log_conversation_turn(
        self,
        *,
        profile_id: str,
        call_id: str,
        direction: str,
        text: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await asyncio.to_thread(
            self._log_conversation_turn_sync,
            profile_id,
            call_id,
            direction,
            text,
            metadata or {},
        )

    def _log_conversation_turn_sync(
        self,
        profile_id: str,
        call_id: str,
        direction: str,
        text: str,
        metadata: dict[str, Any],
    ) -> None:
        cleaned = text.strip()
        if not cleaned:
            return
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO conversation_turns (
                    created_at, profile_id, call_id, direction, text, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(UTC).isoformat(),
                    profile_id,
                    call_id,
                    direction[:30],
                    cleaned[:20000],
                    json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                ),
            )

    async def log_latency(
        self,
        *,
        profile_id: str,
        call_id: str,
        event_name: str,
        since_call_start_ms: float,
        since_previous_ms: float,
        details: dict[str, Any] | None = None,
    ) -> None:
        await asyncio.to_thread(
            self._log_latency_sync,
            profile_id,
            call_id,
            event_name,
            since_call_start_ms,
            since_previous_ms,
            details or {},
        )

    def _log_latency_sync(
        self,
        profile_id: str,
        call_id: str,
        event_name: str,
        since_call_start_ms: float,
        since_previous_ms: float,
        details: dict[str, Any],
    ) -> None:
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO latency_events (
                    created_at, profile_id, call_id, event_name,
                    since_call_start_ms, since_previous_ms, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(UTC).isoformat(),
                    profile_id,
                    call_id,
                    event_name[:80],
                    round(max(0.0, since_call_start_ms), 3),
                    round(max(0.0, since_previous_ms), 3),
                    json.dumps(details, ensure_ascii=False, separators=(",", ":")),
                ),
            )

    async def recent_traces(
        self, profile_id: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            self._recent_traces_sync, profile_id, max(1, min(limit, 50))
        )

    def _recent_traces_sync(
        self, profile_id: str, limit: int
    ) -> list[dict[str, Any]]:
        with self._connect() as db:
            snapshots = db.execute(
                """
                SELECT created_at, call_id, bot_version, fingerprint,
                       system_instruction, opening_message, history_context, setup_json
                FROM prompt_snapshots WHERE profile_id = ?
                ORDER BY id DESC LIMIT ?
                """,
                (profile_id, limit),
            ).fetchall()
            result: list[dict[str, Any]] = []
            for snapshot in snapshots:
                call_id = str(snapshot["call_id"])
                turns = db.execute(
                    """
                    SELECT created_at, direction, text, metadata_json
                    FROM conversation_turns WHERE call_id = ? ORDER BY id
                    """,
                    (call_id,),
                ).fetchall()
                latency = db.execute(
                    """
                    SELECT created_at, event_name, since_call_start_ms,
                           since_previous_ms, details_json
                    FROM latency_events WHERE call_id = ? ORDER BY id
                    """,
                    (call_id,),
                ).fetchall()
                result.append(
                    {
                        "created_at": snapshot["created_at"],
                        "call_id": call_id,
                        "bot_version": int(snapshot["bot_version"]),
                        "fingerprint": snapshot["fingerprint"],
                        "system_instruction": snapshot["system_instruction"],
                        "opening_message": snapshot["opening_message"],
                        "history_context": snapshot["history_context"],
                        "setup_message": json.loads(snapshot["setup_json"]),
                        "turns": [
                            {
                                "created_at": row["created_at"],
                                "direction": row["direction"],
                                "text": row["text"],
                                "metadata": json.loads(row["metadata_json"]),
                            }
                            for row in turns
                        ],
                        "latency": [
                            {
                                "created_at": row["created_at"],
                                "event_name": row["event_name"],
                                "since_call_start_ms": row["since_call_start_ms"],
                                "since_previous_ms": row["since_previous_ms"],
                                "details": json.loads(row["details_json"]),
                            }
                            for row in latency
                        ],
                    }
                )
        return result

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
