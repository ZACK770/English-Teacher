from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_TUTOR_PROMPT = """You are Maya, a warm English speaking tutor for an Israeli
eighth-grade girl. Your goal is confident, high-level spoken English. Speak mostly in
English, clearly and naturally, without sounding childish. Use Hebrew only for a very
short rescue explanation when the learner is genuinely stuck, then return to English.
Ask one question at a time. Keep spoken turns short enough for a phone call.
Adapt difficulty from the learner's answers. Practice everyday conversation, school,
stories, opinions, and future plans. Correct important errors kindly: first acknowledge
meaning, then give the natural English form, ask her to repeat it once, and continue.
Do not correct every tiny error. Prefer recasts and one concise explanation.
Never ask for a full name, address, school, phone number, passwords, or other identifying
information. After each substantive learner answer, call record_learning_observation
with a brief, privacy-safe assessment.
At the beginning, greet her and offer a choice between free conversation and a short challenge.
"""


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
    gemini_language_code: str = "en-US"
    gemini_vad_silence_ms: int = Field(default=250, ge=100, le=2000)
    gemini_vad_prefix_ms: int = Field(default=160, ge=0, le=1000)
    gemini_input_batch_frames: int = Field(default=5, ge=1, le=20)

    technoline_channel_id: str = "2614d922d06b4f"
    technoline_bearer_secret: SecretStr
    technoline_allowed_ips: list[str] = Field(default_factory=list)
    technoline_return_extension: str = "/"

    admin_bearer_secret: SecretStr
    student_id: str = "student"
    database_path: Path = Path("data/progress.db")
    max_call_minutes: int = Field(default=30, ge=1, le=120)
    max_concurrent_calls: int = Field(default=2, ge=1, le=20)
    store_transcripts: bool = False
    tutor_prompt: str = DEFAULT_TUTOR_PROMPT

    @field_validator("technoline_bearer_secret", "admin_bearer_secret")
    @classmethod
    def reject_weak_secrets(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if len(raw) < 32:
            raise ValueError("must contain at least 32 characters")
        return value

    @field_validator("technoline_return_extension")
    @classmethod
    def absolute_extension(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("/"):
            raise ValueError("must be an absolute Technoline path beginning with /")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
