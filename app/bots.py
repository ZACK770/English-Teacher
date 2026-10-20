from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

BOT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{1,62}$")


class BotCreate(BaseModel):
    id: str = Field(min_length=2, max_length=63)
    label: str = Field(min_length=2, max_length=100)
    role: Literal["teacher", "translator", "sales", "service", "custom"] = "teacher"
    description: str = Field(default="", max_length=1000)
    channel_id: str | None = Field(default=None, max_length=200)
    enabled: bool = True
    audience: str = Field(default="general", max_length=40)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        value = value.strip().lower()
        if not BOT_ID_PATTERN.fullmatch(value):
            raise ValueError(
                "use lowercase Latin letters, digits and hyphens; start with a letter"
            )
        return value

    @field_validator("channel_id")
    @classmethod
    def clean_channel_id(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else ""
        return cleaned or None


class BotUpdate(BaseModel):
    label: str = Field(min_length=2, max_length=100)
    role: Literal["teacher", "translator", "sales", "service", "custom"]
    description: str = Field(default="", max_length=1000)
    channel_id: str | None = Field(default=None, max_length=200)
    enabled: bool = True
    audience: str = Field(default="general", max_length=40)

    @field_validator("channel_id")
    @classmethod
    def clean_channel_id(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else ""
        return cleaned or None
