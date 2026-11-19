"""Gravação da atividade da crônica (DRA-05) pelas RPCs do Supabase.

A função ``rpg_record_roll_activity`` confirma que a ficha é da campanha do usuário (dono da
ficha ou narrador), filtra os traços para campos numéricos do modelo aprovado, evita duplicar
pela ``roll_key`` e respeita o limite de 500 atividades por campanha. Qualquer falha volta como
``status`` textual: a rolagem nunca cai por causa do registro.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any

from app.adapters.outbound.supabase.campaign_rpc import call_rpc
from app.application.roll_activity import ROLL_ACTIVITY_STATUSES, MAX_TRAIT_IDS, RollActivityResult, RollChronicleContext
from app.domain.errors import DomainError

logger = logging.getLogger(__name__)
FAILED = "error"


def _activity_id(result: dict[str, Any]) -> str | None:
    return str(result["activity_id"]) if result.get("activity_id") else None


def _valid(result: Any) -> bool:
    return isinstance(result, dict) and result.get("status") in ROLL_ACTIVITY_STATUSES


async def record_session_roll(
    authorization: str | None,
    *,
    sheet_id: uuid.UUID | str,
    trait_ids: list[str],
    roll_key: str | None = None,
    campaign_id: uuid.UUID | str | None = None,
    occurred_on: date | None = None,
) -> RollActivityResult:
    payload: dict[str, Any] = {
        "p_sheet_id": str(sheet_id),
        "p_roll_key": roll_key or f"roll:{uuid.uuid4()}",
        "p_trait_ids": list(dict.fromkeys(trait_ids))[:MAX_TRAIT_IDS],
        "p_campaign_id": str(campaign_id) if campaign_id else None,
        "p_occurred_on": occurred_on.isoformat() if occurred_on else None,
    }
    try:
        result = await call_rpc("rpg_record_roll_activity", authorization or "", payload)
    except DomainError as error:
        logger.info("roll activity not recorded: %s", error.message)
        return RollActivityResult(status=FAILED)
    if not _valid(result):
        return RollActivityResult(status=FAILED)
    traits = result.get("used_trait_ids")
    return RollActivityResult(
        status=str(result["status"]),
        activity_id=_activity_id(result),
        used_trait_ids=[str(item) for item in traits] if isinstance(traits, list) else [],
    )


async def record_from_context(authorization: str | None, context: RollChronicleContext | None) -> RollActivityResult | None:
    if context is None:
        return None
    return await record_session_roll(
        authorization, sheet_id=context.sheet_id, trait_ids=context.trait_ids,
        roll_key=context.roll_key, campaign_id=context.campaign_id,
    )


async def record_field_roll(authorization: str | None, context: RollChronicleContext | None, expression: str) -> RollActivityResult | None:
    """Rolagem de um campo da ficha, sem atribuir uso a traços numéricos que não participaram."""
    if context is None:
        return None
    if context.roll_field_id is None:
        return await record_from_context(authorization, context)
    try:
        result = await call_rpc("rpg_record_sheet_field_roll", authorization or "", {
            "p_sheet_id": str(context.sheet_id), "p_campaign_id": str(context.campaign_id) if context.campaign_id else None,
            "p_field_id": context.roll_field_id, "p_expression": expression,
            "p_roll_key": context.roll_key or f"field:{uuid.uuid4()}",
        })
    except DomainError:
        return RollActivityResult(status=FAILED)
    if not _valid(result):
        return RollActivityResult(status=FAILED)
    return RollActivityResult(status=result["status"], activity_id=_activity_id(result))


class ChronicleRollRecorder:
    """Implementação de ``RollActivityRecorder`` ligada ao token de uma requisição."""

    def __init__(self, authorization: str | None) -> None:
        self._authorization = authorization

    async def record(self, context: RollChronicleContext | None) -> RollActivityResult | None:
        return await record_from_context(self._authorization, context)

    async def record_field(self, context: RollChronicleContext | None, expression: str) -> RollActivityResult | None:
        return await record_field_roll(self._authorization, context, expression)
