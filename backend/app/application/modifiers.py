"""Rolagem de uma parada ajustada por efeitos, com registro opcional na crônica."""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.application.roll_activity import RollActivityRecorder, RollChronicleContext, chronicle_status
from app.domain.errors import InvalidInput
from app.services.modifiers import ModifierPreview, ModifierRequest, preview_modifiers


class ModifierRollRequest(ModifierRequest):
    die_sides: StrictInt = Field(ge=2, le=100)
    chronicle: RollChronicleContext | None = None


class ModifierRollResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preview: ModifierPreview
    rolls: list[int]
    total: int


@dataclass(frozen=True)
class ModifierRollOutcome:
    result: ModifierRollResult
    chronicle_status: str | None


def roll_dice(count: int, sides: int) -> list[int]:
    """Dados gerados no servidor com fonte criptográfica."""
    return [secrets.randbelow(sides) + 1 for _ in range(count)]


class ModifierRollService:
    def __init__(self, activity: RollActivityRecorder) -> None:
        self._activity = activity

    async def roll(self, request: ModifierRollRequest) -> ModifierRollOutcome:
        preview = preview_modifiers(request)
        if preview.adjusted_pool == 0:
            raise InvalidInput("pool ajustado precisa conter ao menos um dado")
        rolls = roll_dice(preview.adjusted_pool, request.die_sides)
        status = await chronicle_status(self._activity, request.chronicle)
        return ModifierRollOutcome(ModifierRollResult(preview=preview, rolls=rolls, total=sum(rolls)), status)
