"""Implementação de ``V3Sheets`` sobre as RPCs v3_* (supabase/migrations/20261029120000_vampire_v3_complete.sql)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.campaign_rpc import CAMPAIGN_RPC_ERRORS
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.system_rolls import LIFE_ACTIONS, V3SheetAction


def _function_and_params(action: V3SheetAction) -> tuple[str, dict[str, Any]]:
    if action.action in LIFE_ACTIONS:
        return "v3_life_action", {"p_action": action.action, "p_amount": action.amount, "p_note": action.note}
    if action.action == "sangue":
        return "v3_spend_blood", {"p_amount": action.amount, "p_turn": action.turn}
    if action.action == "cura":
        return "v3_heal", {"p_levels": action.amount, "p_turn": action.turn}
    if action.action == "dano":
        return "v3_apply_damage", {"p_kind": action.kind, "p_amount": action.amount}
    if action.action == "sangue_inicial":
        return "v3_set_initial_blood", {"p_value": action.amount}
    if action.action == "degeneracao":
        return "v3_degeneration_test", {"p_difficulty": action.difficulty}
    return "v3_frenzy_test", {"p_kind": action.action, "p_difficulty": action.difficulty}


class SupabaseV3Sheets:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def life_state(self, sheet_id: UUID | str) -> Any:
        return await self._rpc("v3_life_state", {"p_sheet_id": str(sheet_id)})

    async def spend_willpower(self, sheet_id: str, operation_id: str) -> Any:
        return await self._rpc("v3_spend_willpower", {"p_sheet_id": sheet_id, "p_operation_id": operation_id})

    async def apply(self, sheet_id: UUID, action: V3SheetAction) -> Any:
        function, params = _function_and_params(action)
        return await self._rpc(function, {"p_sheet_id": str(sheet_id), "p_operation_id": str(action.operation_id), **params})

    async def _rpc(self, function: str, payload: dict[str, Any]) -> Any:
        return await self._rest.rpc(function, payload, errors=CAMPAIGN_RPC_ERRORS)
