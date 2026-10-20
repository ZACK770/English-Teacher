from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from .config import Settings
from .controls import TutorControls
from .gemini_live import build_setup_payload


@dataclass(frozen=True)
class PromptArtifact:
    """The single compiled representation used by previews and live sessions."""

    system_instruction: str
    opening_message: str
    setup_message: dict[str, Any]
    history_context: str
    fingerprint: str
    runtime_settings: Settings

    def public_payload(self) -> dict[str, Any]:
        return {
            "system_instruction": self.system_instruction,
            "opening_message": self.opening_message,
            "setup_message": self.setup_message,
            "history_context": self.history_context,
            "fingerprint": self.fingerprint,
        }


def compile_prompt(
    *,
    controls: TutorControls,
    history_context: str,
    settings: Settings,
    profile_id: str,
) -> PromptArtifact:
    """Compile the exact outgoing prompt and Gemini setup from one source of truth."""

    system_instruction = controls.build_system_instruction(history_context)
    runtime = settings.model_copy(
        update={
            **controls.settings_updates(system_instruction),
            "student_id": profile_id,
        }
    )
    setup = build_setup_payload(runtime)
    canonical = json.dumps(
        {
            "profile_id": profile_id,
            "setup": setup,
            "opening_message": controls.opening_message,
            "history_context": history_context,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return PromptArtifact(
        system_instruction=system_instruction,
        opening_message=controls.opening_message,
        setup_message=setup,
        history_context=history_context,
        fingerprint=fingerprint,
        runtime_settings=runtime,
    )
