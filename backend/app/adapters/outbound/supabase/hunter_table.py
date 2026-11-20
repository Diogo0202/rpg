"""Implementação de ``HunterTable`` sobre as RPCs do Caçador: A Revanche."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.errors import RpcErrors
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.domain.errors import Conflict, Forbidden, InvalidInput, ServiceUnavailable, Unauthenticated

HUNTER_ERRORS = RpcErrors(
    by_code={
        "42501": (Forbidden, "operação não permitida nesta ficha ou célula"),
        "22023": (InvalidInput, "pedido inválido para esta rolagem"),
        "23505": (Conflict, "esta ação já foi aplicada de outra forma"),
        "23514": (InvalidInput, "o valor sairia do limite (0 a 5, ou Vontade cheia)"),
        "55000": (Conflict, "o caçador está em Desespero: sem dados de Desesperação nem Triunfos"),
    },
    by_status={401: (Unauthenticated, "sessão inválida")},
    otherwise=(ServiceUnavailable, "não foi possível concluir a operação no Supabase"),
    with_database_message=frozenset({"22023", "55000"}),
)


class SupabaseHunterTable:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def roll(self, sheet_id: UUID, base_pool: int, difficulty: int, use_desperation: bool, details: dict[str, Any]) -> Any:
        return await self._rpc("record_hunter_roll", {
            "p_sheet_id": str(sheet_id), "p_base_pool": base_pool, "p_difficulty": difficulty,
            "p_use_desperation": use_desperation, "p_details": details,
        })

    async def reroll(self, roll_id: UUID, indices: list[int]) -> Any:
        return await self._rpc("reroll_hunter_roll", {"p_roll_id": str(roll_id), "p_indices": indices})

    async def resolve(self, roll_id: UUID, choice: str) -> Any:
        return await self._rpc("resolve_hunter_desperation", {"p_roll_id": str(roll_id), "p_choice": choice})

    async def sheet_state(self, sheet_id: UUID) -> Any:
        return await self._rpc("hunter_sheet_state", {"p_sheet_id": str(sheet_id)})

    async def adjust_cell(self, cell_id: UUID, operation_id: UUID, danger_delta: int, desperation_delta: int, reason: str | None) -> Any:
        return await self._rpc("adjust_hunter_cell", {
            "p_cell_id": str(cell_id), "p_operation_id": str(operation_id), "p_danger_delta": danger_delta,
            "p_desperation_delta": desperation_delta, "p_reason": reason,
        })

    async def request_redemption(self, sheet_id: UUID, note: str) -> Any:
        return await self._rpc("request_hunter_redemption", {"p_sheet_id": str(sheet_id), "p_note": note})

    async def decide_redemption(self, redemption_id: UUID, approve: bool, note: str) -> Any:
        return await self._rpc("decide_hunter_redemption", {"p_redemption_id": str(redemption_id), "p_approve": approve, "p_note": note})

    async def _rpc(self, function: str, payload: dict[str, Any]) -> Any:
        return await self._rest.rpc(function, payload, errors=HUNTER_ERRORS)
