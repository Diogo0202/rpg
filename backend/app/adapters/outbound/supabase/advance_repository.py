"""Implementação de ``AdvanceRepository`` sobre as RPCs de avanço do Supabase."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.rest_client import SqlStateErrors, SupabaseRest
from app.application.experience.ports import AdvanceOrder, AdvanceQuote, ExperiencePolicy, Row
from app.domain.errors import Conflict, Forbidden, InvalidInput, NotFound

ADVANCE_ERRORS: SqlStateErrors = {
    "42501": (Forbidden, "operação não permitida nesta ficha"),
    "40001": (Conflict, "a ficha mudou desde a prévia; recarregue e confira o custo de novo"),
    "23505": (Conflict, "ID da operação já foi usado para outra compra"),
    "22023": (InvalidInput, "este avanço não é válido para esta ficha"),
    "23514": (InvalidInput, "o traço sairia do limite permitido"),
    "XP001": (InvalidInput, "XP insuficiente para este avanço"),
    "P0002": (NotFound, "avanço não encontrado"),
}
ADVANCE_COLUMNS = (
    "id,sheet_id,actor_id,system_key,trait,category,item_name,item_value,from_level,to_level,cost,status,"
    "xp_before,xp_after,sheet_version,reason,reviewed_by,reviewed_at,review_note,created_at"
)
POLICY_TABLE = "campaign_experience_settings"


class SupabaseAdvanceRepository:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def quote(self, sheet_id: UUID, quote: AdvanceQuote) -> Row:
        return await self._rpc("quote_advance", {"p_sheet_id": str(sheet_id), **_quote_params(quote)})

    async def purchase(self, sheet_id: UUID, order: AdvanceOrder) -> Row:
        return await self._rpc("purchase_advance", {
            "p_sheet_id": str(sheet_id),
            "p_trait": order.quote.trait,
            "p_target_level": order.quote.target_level,
            "p_expected_version": order.expected_version,
            "p_operation_id": str(order.operation_id),
            "p_item_name": order.quote.item_name,
            "p_reason": order.reason,
        })

    async def history(self, sheet_id: UUID, limit: int) -> list[Row]:
        return await self._rest.request("GET", "character_advances", params={
            "select": ADVANCE_COLUMNS, "sheet_id": f"eq.{sheet_id}", "order": "created_at.desc", "limit": str(limit),
        })

    async def review(self, advance_id: UUID, approve: bool, note: str | None) -> Row:
        return await self._rpc("review_advance", {"p_advance_id": str(advance_id), "p_approve": approve, "p_note": note})

    async def refund(self, advance_id: UUID, note: str | None) -> Row:
        return await self._rpc("refund_advance", {"p_advance_id": str(advance_id), "p_note": note})

    async def policy(self, campaign_id: UUID) -> Row | None:
        rows = await self._rest.request("GET", POLICY_TABLE, params={
            "select": "campaign_id,requires_approval,updated_at", "campaign_id": f"eq.{campaign_id}",
        })
        return rows[0] if rows else None

    async def save_policy(self, campaign_id: UUID, policy: ExperiencePolicy) -> Row | None:
        """O PostgREST desta API não faz upsert: atualiza primeiro e insere quando nada mudou."""
        body = {
            "requires_approval": policy.requires_approval,
            "updated_by": policy.updated_by,
            "updated_at": policy.updated_at.isoformat(),
        }
        rows = await self._rest.request("PATCH", POLICY_TABLE, params={"campaign_id": f"eq.{campaign_id}"}, payload=body)
        if not rows:
            rows = await self._rest.request("POST", POLICY_TABLE, payload={"campaign_id": str(campaign_id), **body})
        return rows[0] if rows else None

    async def _rpc(self, function: str, payload: dict[str, Any]) -> Row:
        return await self._rest.rpc(function, payload, errors=ADVANCE_ERRORS)


def _quote_params(quote: AdvanceQuote) -> dict[str, Any]:
    return {"p_trait": quote.trait, "p_target_level": quote.target_level, "p_item_name": quote.item_name}
