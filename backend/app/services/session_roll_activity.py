"""Gancho DRA-05: registra rolagens autenticadas como atividade da cronica.

As rotas de rolagem chamam :func:`record_session_roll` depois de gerar o resultado.
O gancho nunca derruba a rolagem: qualquer falha volta como ``status`` textual.
A funcao SQL ``rpg_record_roll_activity`` confirma que a ficha pertence a campanha
do usuario (dono da ficha ou narrador), filtra os tracos para campos numericos do
modelo aprovado, evita duplicar pela ``roll_key`` e respeita o limite de 500
atividades por campanha.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

from app.services.supabase_rpc import call_rpc


logger = logging.getLogger(__name__)
ROLL_ACTIVITY_STATUSES = {
    "recorded", "duplicate", "limit_reached", "no_traits", "not_in_campaign",
    "not_allowed", "unapproved_template", "error",
}


class RollChronicleContext(BaseModel):
    """Contexto opcional que uma rota de rolagem aceita para registrar a crônica."""

    model_config = ConfigDict(extra="forbid")

    sheet_id: uuid.UUID
    campaign_id: uuid.UUID | None = None
    trait_ids: list[StrictStr] = Field(default_factory=list, max_length=50)
    roll_key: StrictStr | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("trait_ids")
    @classmethod
    def bounded_ids(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > 80 for item in value):
            raise ValueError("ids de traços precisam ter entre 1 e 80 caracteres")
        return value


class RollActivityResult(BaseModel):
    status: str
    activity_id: str | None = None
    used_trait_ids: list[str] = Field(default_factory=list)


async def record_session_roll(
    authorization: str | None,
    *,
    sheet_id: uuid.UUID | str,
    trait_ids: list[str],
    roll_key: str | None = None,
    campaign_id: uuid.UUID | str | None = None,
    occurred_on: date | None = None,
) -> RollActivityResult:
    """Registra a rolagem e devolve o status; não lança exceção para a rota."""
    key = roll_key or f"roll:{uuid.uuid4()}"
    payload: dict[str, Any] = {
        "p_sheet_id": str(sheet_id),
        "p_roll_key": key,
        "p_trait_ids": list(dict.fromkeys(trait_ids))[:50],
        "p_campaign_id": str(campaign_id) if campaign_id else None,
        "p_occurred_on": occurred_on.isoformat() if occurred_on else None,
    }
    try:
        result = await call_rpc("rpg_record_roll_activity", authorization or "", payload)
    except HTTPException as error:
        logger.info("roll activity not recorded: %s", error.detail)
        return RollActivityResult(status="error")
    if not isinstance(result, dict) or result.get("status") not in ROLL_ACTIVITY_STATUSES:
        return RollActivityResult(status="error")
    traits = result.get("used_trait_ids")
    return RollActivityResult(
        status=str(result["status"]),
        activity_id=str(result["activity_id"]) if result.get("activity_id") else None,
        used_trait_ids=[str(item) for item in traits] if isinstance(traits, list) else [],
    )


async def record_from_context(authorization: str | None, context: RollChronicleContext | None) -> RollActivityResult | None:
    """Atalho para rotas que recebem ``chronicle: RollChronicleContext | None``."""
    if context is None:
        return None
    return await record_session_roll(
        authorization, sheet_id=context.sheet_id, trait_ids=context.trait_ids,
        roll_key=context.roll_key, campaign_id=context.campaign_id,
    )
