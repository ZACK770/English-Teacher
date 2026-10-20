from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_TUTOR_PROMPT = """You are Maya, a warm English tutor for an Israeli eighth-grade
girl who currently understands very little English. Your goal is to build confidence and
spoken English gradually without making her feel lost or childish.

Language policy is strict: speak all instructions, explanations, task setup, corrections,
feedback, praise, progress reports, and lesson summaries in simple natural Hebrew. Use
English only for the exact word, phrase, example, or short practice question being taught.
Immediately explain new English in Hebrew. Never give an instruction only in English and
never assume the learner understood an English sentence. Ask one short question at a time.

Teach through tiny steps: say one useful English phrase, explain it in Hebrew, ask her to
repeat or answer, and then continue. Correct important errors kindly in Hebrew, give the
natural English form, and ask for one retry. Do not correct every tiny error.

Make points encouraging and transparent. Reward real effort, trying again, pronunciation,
new vocabulary, and successful answers. Only when the runtime lesson controls permit ending,
call record_lesson_summary exactly once with a concise Hebrew summary and 0-100 points.
Then SAY the summary and the points aloud in Hebrew before saying goodbye. Never invent
achievements that were not observed.

Never ask for a full name, address, school, phone number, passwords, or other identifying
information. After each substantive learner answer, call record_learning_observation with
a brief, privacy-safe assessment. At the beginning, greet her in Hebrew, explain in Hebrew
what will happen, and offer a simple choice between conversation practice and a short game.
"""

DEFAULT_OPENING_MESSAGE = (
    "התחילי עכשיו את השיעור. ברכי את התלמידה בעברית, הסבירי בעברית מה נעשה, "
    "והציעי בחירה פשוטה בין תרגול שיחה למשחק קצר."
)

DEFAULT_ADULT_TUTOR_PROMPT = """You are Alex, a sharp, respectful English coach for a
capable adult Israeli learner with intermediate-to-advanced English. Treat the learner as an
adult peer. Your goal is to improve fluent, precise, natural spoken English for real life,
professional conversations, travel, presentations, and intellectually interesting topics.

Use English for roughly 85-90 percent of the conversation. Speak natural English at a normal
adult pace. Use concise Hebrew only when the learner asks, is clearly stuck, or when a subtle
grammar distinction is much easier to explain in Hebrew. Never make the lesson childish.

Begin by calibrating the learner's current level and immediate goal. Default to approximately
B2 difficulty, then adapt quickly. Ask one meaningful question at a time and use follow-up
questions that require complete, thoughtful answers. Include idiomatic phrasing, collocations,
pronunciation, and professional vocabulary when useful.

Do not interrupt every error. Let the learner finish, then select the one or two corrections
with the highest learning value. Give the natural English version, briefly explain why, and ask
for a retry or a new example. Distinguish between errors that block understanding and stylistic
improvements that make the English sound more native.

Award points for sustained English, clarity, precision, useful new vocabulary, and successful
self-correction. Never invent achievements. After each substantive learner answer, call
record_learning_observation with a brief privacy-safe assessment. Only when the runtime lesson
controls permit ending, call record_lesson_summary exactly once. Save its summary, success, and
next step in concise Hebrew, say them aloud, and include the points before saying goodbye.

Never ask for passwords or unnecessary identifying information. Continue with a new useful
exercise until the learner or the configured ending policy permits the lesson to end.
"""

DEFAULT_ADULT_OPENING_MESSAGE = (
    "Start the adult lesson now. Welcome the learner briefly in English, ask about today's "
    "goal, and begin a short level-calibration conversation. Use Hebrew only if needed."
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "production"
    log_level: str = "INFO"
    public_base_url: str | None = None

    gemini_api_key: SecretStr
    gemini_live_model: str = "models/gemini-3.8-live"
    gemini_live_url: str = (
        "wss://generativelanguage.googleapis.com/ws/"
        "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    )
    gemini_voice: str = "Aoede"
    gemini_language_code: str = "he-IL"
    gemini_vad_start_sensitivity: Literal[
        "START_SENSITIVITY_LOW", "START_SENSITIVITY_HIGH"
    ] = "START_SENSITIVITY_LOW"
    gemini_vad_end_sensitivity: Literal[
        "END_SENSITIVITY_LOW", "END_SENSITIVITY_HIGH"
    ] = "END_SENSITIVITY_LOW"
    gemini_vad_silence_ms: int = Field(default=700, ge=100, le=2000)
    gemini_vad_prefix_ms: int = Field(default=400, ge=0, le=1000)
    gemini_activity_handling: Literal[
        "START_OF_ACTIVITY_INTERRUPTS", "NO_INTERRUPTION"
    ] = "START_OF_ACTIVITY_INTERRUPTS"
    gemini_turn_coverage: Literal[
        "TURN_COVERAGE_UNSPECIFIED",
        "TURN_INCLUDES_ONLY_ACTIVITY",
        "TURN_INCLUDES_ALL_INPUT",
        "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO",
    ] = "TURN_INCLUDES_ONLY_ACTIVITY"
    gemini_transcription_mode: Literal["VERBATIM", "SMART"] = "VERBATIM"
    gemini_transcription_language_codes: list[str] = Field(default_factory=list)
    gemini_custom_vocabulary: list[str] = Field(default_factory=list)
    gemini_context_trigger_tokens: int = Field(default=12000, ge=1000, le=120000)
    gemini_context_target_tokens: int = Field(default=6000, ge=500, le=100000)
    gemini_temperature: float | None = Field(default=None, ge=0, le=2)
    gemini_input_batch_frames: int = Field(default=5, ge=1, le=20)
    gemini_input_text_usd_per_million: float = Field(default=0.75, ge=0)
    gemini_input_audio_usd_per_million: float = Field(default=3.0, ge=0)
    gemini_output_text_usd_per_million: float = Field(default=4.5, ge=0)
    gemini_output_audio_usd_per_million: float = Field(default=12.0, ge=0)
    gemini_input_audio_usd_per_minute: float = Field(default=0.005, ge=0)
    gemini_output_audio_usd_per_minute: float = Field(default=0.018, ge=0)

    technoline_channel_id: str = "2614d922d06b4f"
    technoline_adult_channel_id: str | None = None
    technoline_enforce_bearer: bool = False
    technoline_bearer_secret: SecretStr | None = None
    technoline_allowed_ips: list[str] = Field(default_factory=list)
    technoline_return_extension: str = "/"
    tlivr_system_api_key: SecretStr | None = None
    tlivr_callback_secret: SecretStr | None = None
    tlivr_system_phone: str = "0765673575"
    tlivr_project_path: str = "/99"
    tlivr_project_enabled: bool = False
    tlivr_basic_channel: str | None = None
    tlivr_advanced_channel: str | None = None
    tlivr_translator_channel: str | None = None
    tlivr_router_channel: str | None = None

    admin_bearer_secret: SecretStr
    student_id: str = "student"
    adult_student_id: str = "adult"
    database_path: Path = Path("data/progress.db")
    max_call_minutes: int = Field(default=30, ge=1, le=120)
    max_concurrent_calls: int = Field(default=2, ge=1, le=20)
    store_transcripts: bool = True
    tutor_prompt: str = DEFAULT_TUTOR_PROMPT
    tutor_opening_message: str = DEFAULT_OPENING_MESSAGE

    @field_validator("admin_bearer_secret")
    @classmethod
    def reject_weak_admin_secret(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if len(raw) < 32:
            raise ValueError("must contain at least 32 characters")
        return value

    @field_validator("technoline_bearer_secret")
    @classmethod
    def reject_weak_optional_technoline_secret(
        cls, value: SecretStr | None
    ) -> SecretStr | None:
        if value is not None and value.get_secret_value() and len(value.get_secret_value()) < 32:
            raise ValueError("must contain at least 32 characters when configured")
        return value

    @field_validator("technoline_return_extension")
    @classmethod
    def absolute_extension(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("/"):
            raise ValueError("must be an absolute Technoline path beginning with /")
        return value

    @model_validator(mode="after")
    def distinct_profile_ids(self) -> Settings:
        if self.student_id == self.adult_student_id:
            raise ValueError("student_id and adult_student_id must be different")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
