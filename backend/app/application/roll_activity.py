"""DRA-05: rolagens autenticadas viram atividade da crônica.

Este módulo define o contrato (contexto opcional da rolagem, resultado e porta); a gravação fica
em ``app/adapters/outbound/supabase/roll_activity.py``. O registro nunca derruba a rolagem.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

ROLL_ACTIVITY_STATUSES = frozenset({
    "recorded", "duplicate", "limit_reached", "no_traits", "not_in_campaign",
    "not_allowed", "unapproved_template", "error",
})
MAX_TRAIT_IDS = 50
MAX_TRAIT_ID_LENGTH = 80


class RollChronicleContext(BaseModel):
    """Contexto opcional que uma rota de rolagem aceita para registrar a crônica."""

    model_config = ConfigDict(extra="forbid")

    sheet_id: uuid.UUID
    campaign_id: uuid.UUID | None = None
    trait_ids: list[StrictStr] = Field(default_factory=list, max_length=MAX_TRAIT_IDS)
    roll_key: StrictStr | None = Field(default=None, min_length=1, max_length=120)
    roll_field_id: StrictStr | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,63}$")

    @field_validator("trait_ids")
    @classmethod
    def bounded_ids(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > MAX_TRAIT_ID_LENGTH for item in value):
            raise ValueError("ids de traços precisam ter entre 1 e 80 caracteres")
        return value


class RollActivityResult(BaseModel):
    status: str
    activity_id: str | None = None
    used_trait_ids: list[str] = Field(default_factory=list)


class RollActivityRecorder(Protocol):
    """Registra a rolagem na crônica; nunca derruba a rolagem em caso de falha."""

    async def record(self, context: RollChronicleContext | None) -> RollActivityResult | None: ...

    async def record_field(self, context: RollChronicleContext | None, expression: str) -> RollActivityResult | None:
        """Rolagem de um campo da ficha, sem atribuir uso a traços que não participaram."""


async def chronicle_status(recorder: RollActivityRecorder, context: RollChronicleContext | None) -> str | None:
    """Status textual para o cabeçalho ``X-Chronicle-Activity``; ``None`` quando nada foi pedido."""
    activity = await recorder.record(context)
    return activity.status if activity else None
