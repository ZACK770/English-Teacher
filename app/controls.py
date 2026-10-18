from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .config import (
    DEFAULT_ADULT_OPENING_MESSAGE,
    DEFAULT_ADULT_TUTOR_PROMPT,
    DEFAULT_OPENING_MESSAGE,
    DEFAULT_TUTOR_PROMPT,
)

if TYPE_CHECKING:
    from .config import Settings


VOICE_OPTIONS = [
    "Zephyr",
    "Puck",
    "Charon",
    "Kore",
    "Fenrir",
    "Leda",
    "Orus",
    "Aoede",
    "Callirrhoe",
    "Autonoe",
    "Enceladus",
    "Iapetus",
    "Umbriel",
    "Algieba",
    "Despina",
    "Erinome",
    "Algenib",
    "Rasalgethi",
    "Laomedeia",
    "Achernar",
    "Alnilam",
    "Schedar",
    "Gacrux",
    "Pulcherrima",
    "Achird",
    "Zubenelgenubi",
    "Vindemiatrix",
    "Sadachbia",
    "Sadaltager",
    "Sulafat",
]


class TutorControls(BaseModel):
    base_prompt: str = Field(default=DEFAULT_TUTOR_PROMPT, min_length=50, max_length=16000)
    opening_message: str = Field(
        default=DEFAULT_OPENING_MESSAGE, min_length=10, max_length=2000
    )
    learning_goal: str = Field(default="", max_length=2000)
    custom_instructions: str = Field(default="", max_length=5000)
    target_lesson_minutes: int = Field(default=15, ge=1, le=120)
    ending_policy: Literal[
        "learner_only", "after_target_with_permission", "model_discretion"
    ] = "learner_only"

    voice: str = "Aoede"
    language_code: str = Field(default="he-IL", min_length=2, max_length=20)
    temperature: float | None = Field(default=None, ge=0, le=2)

    vad_start_sensitivity: Literal[
        "START_SENSITIVITY_LOW", "START_SENSITIVITY_HIGH"
    ] = "START_SENSITIVITY_LOW"
    vad_end_sensitivity: Literal[
        "END_SENSITIVITY_LOW", "END_SENSITIVITY_HIGH"
    ] = "END_SENSITIVITY_LOW"
    vad_prefix_ms: int = Field(default=400, ge=0, le=1000)
    vad_silence_ms: int = Field(default=700, ge=100, le=2000)
    activity_handling: Literal[
        "START_OF_ACTIVITY_INTERRUPTS", "NO_INTERRUPTION"
    ] = "START_OF_ACTIVITY_INTERRUPTS"
    turn_coverage: Literal[
        "TURN_COVERAGE_UNSPECIFIED",
        "TURN_INCLUDES_ONLY_ACTIVITY",
        "TURN_INCLUDES_ALL_INPUT",
        "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO",
    ] = "TURN_INCLUDES_ONLY_ACTIVITY"
    input_batch_frames: int = Field(default=5, ge=1, le=20)

    transcription_mode: Literal["VERBATIM", "SMART"] = "VERBATIM"
    transcription_language_codes: list[str] = Field(default_factory=list, max_length=10)
    custom_vocabulary: list[str] = Field(default_factory=list, max_length=100)
    store_transcripts: bool = False

    context_trigger_tokens: int = Field(default=12000, ge=1000, le=120000)
    context_target_tokens: int = Field(default=6000, ge=500, le=100000)
    max_call_minutes: int = Field(default=30, ge=1, le=120)

    @field_validator("voice")
    @classmethod
    def supported_voice(cls, value: str) -> str:
        value = value.strip()
        if value not in VOICE_OPTIONS:
            raise ValueError("unsupported voice")
        return value

    @field_validator("transcription_language_codes", "custom_vocabulary")
    @classmethod
    def compact_string_lists(cls, values: list[str]) -> list[str]:
        compact: list[str] = []
        for value in values:
            cleaned = value.strip()
            if cleaned and cleaned not in compact:
                compact.append(cleaned[:120])
        return compact

    @model_validator(mode="after")
    def valid_context_window(self) -> TutorControls:
        if self.context_target_tokens >= self.context_trigger_tokens:
            raise ValueError("context target must be smaller than trigger")
        return self

    @classmethod
    def from_settings(cls, settings: Settings) -> TutorControls:
        return cls(
            base_prompt=settings.tutor_prompt,
            opening_message=settings.tutor_opening_message,
            voice=settings.gemini_voice,
            language_code=settings.gemini_language_code,
            temperature=settings.gemini_temperature,
            vad_start_sensitivity=settings.gemini_vad_start_sensitivity,
            vad_end_sensitivity=settings.gemini_vad_end_sensitivity,
            vad_prefix_ms=settings.gemini_vad_prefix_ms,
            vad_silence_ms=settings.gemini_vad_silence_ms,
            activity_handling=settings.gemini_activity_handling,
            turn_coverage=settings.gemini_turn_coverage,
            input_batch_frames=settings.gemini_input_batch_frames,
            transcription_mode=settings.gemini_transcription_mode,
            transcription_language_codes=settings.gemini_transcription_language_codes,
            custom_vocabulary=settings.gemini_custom_vocabulary,
            store_transcripts=settings.store_transcripts,
            context_trigger_tokens=settings.gemini_context_trigger_tokens,
            context_target_tokens=settings.gemini_context_target_tokens,
            max_call_minutes=settings.max_call_minutes,
        )

    @classmethod
    def adult_from_settings(cls, settings: Settings) -> TutorControls:
        return cls.from_settings(settings).model_copy(
            update={
                "base_prompt": DEFAULT_ADULT_TUTOR_PROMPT,
                "opening_message": DEFAULT_ADULT_OPENING_MESSAGE,
                "learning_goal": (
                    "לשפר שטף, דיוק וניסוח טבעי באנגלית ברמה בינונית־מתקדמת"
                ),
                "target_lesson_minutes": 25,
                "language_code": "en-US",
                "transcription_language_codes": ["en-US", "he-IL"],
            }
        )

    def build_system_instruction(self, history: str) -> str:
        policy = {
            "learner_only": (
                "The learner controls when the lesson ends. Never suggest, imply, or "
                "initiate ending. After completing an exercise, continue to a new useful "
                "exercise. End only when the learner explicitly asks to stop."
            ),
            "after_target_with_permission": (
                "Do not suggest ending before the target duration. After the target duration, "
                "you may ask once whether the learner wants to continue. End only if the "
                "learner agrees."
            ),
            "model_discretion": (
                "You may suggest ending when a meaningful lesson unit has been completed, but "
                "continue immediately if the learner wants more practice."
            ),
        }[self.ending_policy]
        controls = [
            "Runtime lesson controls (authoritative):",
            f"- Target lesson duration: {self.target_lesson_minutes} minutes.",
            f"- Ending policy: {policy}",
        ]
        if self.learning_goal.strip():
            controls.append(f"- Current learning goal: {self.learning_goal.strip()}")
        if self.custom_instructions.strip():
            controls.append(
                f"- Additional administrator instructions: {self.custom_instructions.strip()}"
            )
        parts = (self.base_prompt.strip(), "\n".join(controls), history.strip())
        return "\n\n".join(
            part for part in parts if part
        )

    def settings_updates(self, system_instruction: str) -> dict[str, object]:
        return {
            "tutor_prompt": system_instruction,
            "tutor_opening_message": self.opening_message,
            "gemini_voice": self.voice,
            "gemini_language_code": self.language_code,
            "gemini_temperature": self.temperature,
            "gemini_vad_start_sensitivity": self.vad_start_sensitivity,
            "gemini_vad_end_sensitivity": self.vad_end_sensitivity,
            "gemini_vad_prefix_ms": self.vad_prefix_ms,
            "gemini_vad_silence_ms": self.vad_silence_ms,
            "gemini_activity_handling": self.activity_handling,
            "gemini_turn_coverage": self.turn_coverage,
            "gemini_input_batch_frames": self.input_batch_frames,
            "gemini_transcription_mode": self.transcription_mode,
            "gemini_transcription_language_codes": self.transcription_language_codes,
            "gemini_custom_vocabulary": self.custom_vocabulary,
            "gemini_context_trigger_tokens": self.context_trigger_tokens,
            "gemini_context_target_tokens": self.context_target_tokens,
            "max_call_minutes": self.max_call_minutes,
            "store_transcripts": self.store_transcripts,
        }
