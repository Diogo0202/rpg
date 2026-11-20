"""Implementação de ``V5Store`` sobre tabelas e funções RPC do Supabase."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.v5.ports import BloodAction, Row

BLOOD_ACTION_FUNCTIONS: dict[BloodAction, str] = {
    BloodAction.ROUSE: "v5_rouse_check",
    BloodAction.AWAKEN: "v5_awaken",
    BloodAction.REMORSE: "v5_remorse_check",
    BloodAction.FRENZY: "v5_frenzy_check",
    BloodAction.COMPULSION: "v5_set_compulsion",
    BloodAction.TORPOR: "v5_set_torpor",
    BloodAction.MEND: "v5_mend",
    BloodAction.SURGE: "v5_blood_surge",
}
BLOOD_EVENT_COLUMNS = "id,kind,dice,outcome,sheet_version,actor_id,created_at"


def _first(rows: Any) -> Row | None:
    return rows[0] if isinstance(rows, list) and rows else None


class SupabaseV5Store:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def roll_sheet(self, sheet_id: UUID) -> Row | None:
        return await self._sheet(sheet_id, "id,values,effects")

    async def blood_sheet(self, sheet_id: UUID) -> Row | None:
        return await self._sheet(sheet_id, "id,values")

    async def surge_receipt(
        self, sheet_id: UUID, operation_id: UUID, base_pool: int, difficulty: int, turn_key: str, context_tags: list[str],
    ) -> Any:
        return await self._rest.rpc("v5_surge_roll_receipt", {
            "p_sheet_id": str(sheet_id), "p_operation_id": str(operation_id), "p_base_pool": base_pool,
            "p_difficulty": difficulty, "p_turn_key": turn_key, "p_context_tags": context_tags,
        })

    async def blood_action(self, action: BloodAction, sheet_id: UUID, operation_id: UUID, params: dict[str, Any]) -> Any:
        payload = {"p_sheet_id": str(sheet_id), "p_operation_id": str(operation_id)}
        payload.update({f"p_{name}": value for name, value in params.items()})
        return await self._rest.rpc(BLOOD_ACTION_FUNCTIONS[action], payload)

    async def record_roll(self, sheet_id: UUID, pool: int, hunger: int, difficulty: int, details: dict[str, Any]) -> Any:
        return await self._rest.rpc("record_v5_roll", {
            "p_sheet_id": str(sheet_id), "p_pool": pool, "p_hunger": hunger,
            "p_difficulty": difficulty, "p_details": details,
        })

    async def roll_history(self, sheet_id: UUID, limit: int) -> Any:
        return await self._rest.request("GET", "v5_roll_records", params={
            "select": "*", "sheet_id": f"eq.{sheet_id}", "order": "created_at.desc,id.desc", "limit": str(limit),
        })

    async def willpower_reroll(self, roll_id: UUID, normal_indices: list[int]) -> Any:
        return await self._rest.rpc("reroll_v5_roll", {"p_roll_id": str(roll_id), "p_indices": normal_indices})

    async def blood_events(self, sheet_id: UUID, limit: int) -> Any:
        return await self._rest.request("GET", "v5_blood_events", params={
            "select": BLOOD_EVENT_COLUMNS, "sheet_id": f"eq.{sheet_id}", "order": "id.desc", "limit": str(limit),
        })

    async def attack_roll(self, roll_id: UUID) -> Any:
        return await self._rest.request("GET", "v5_roll_records", params={
            "select": "id,sheet_id,campaign_id,difficulty,outcome,rerolled_at", "id": f"eq.{roll_id}", "limit": "1",
        })

    async def _sheet(self, sheet_id: UUID, columns: str) -> Row | None:
        rows = await self._rest.request("GET", "character_sheets", params={
            "select": columns, "id": f"eq.{sheet_id}", "limit": "1",
        })
        return _first(rows)
