"""Implementação de ``SanguineStore`` sobre as RPCs da migration 20261029110000_v5_feeding_bonds.sql."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.v5.sanguine import Drink, Hunt

REGNANT_ACTION_LIST_LIMIT = "50"


def _optional(value: UUID | None) -> str | None:
    return str(value) if value else None


class SupabaseSanguineStore:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def record_hunt(self, sheet_id: UUID, hunt: Hunt) -> Any:
        return await self._rest.rpc("record_v5_hunt", {
            "p_sheet_id": str(sheet_id), "p_operation_id": str(hunt.operation_id), "p_prey": hunt.prey,
            "p_resonance": hunt.resonance, "p_intensity": hunt.intensity, "p_dyscrasia": hunt.dyscrasia,
            "p_slake": hunt.slake, "p_killed": hunt.killed, "p_notes": hunt.notes,
        })

    async def hunts(self, sheet_id: UUID, limit: int) -> Any:
        return await self._rest.request("GET", "v5_hunts", params={
            "select": "*", "sheet_id": f"eq.{sheet_id}", "order": "created_at.desc,id.desc", "limit": str(limit),
        })

    async def bonds_of_thrall(self, sheet_id: UUID) -> Any:
        return await self._rest.request("GET", "v5_blood_bonds", params={
            "select": "*", "thrall_sheet_id": f"eq.{sheet_id}", "order": "created_at.asc",
        })

    async def drinks_of_bonds(self, bond_ids: list[str]) -> Any:
        return await self._rest.request("GET", "v5_blood_bond_drinks", params={
            "select": "*", "bond_id": f"in.({','.join(bond_ids)})", "order": "drank_at.asc",
        })

    async def record_drink(self, thrall_sheet_id: UUID, drink: Drink) -> Any:
        payload: dict[str, Any] = {
            "p_thrall_sheet_id": str(thrall_sheet_id), "p_operation_id": str(drink.operation_id),
            "p_regnant_sheet_id": _optional(drink.regnant_sheet_id),
            "p_regnant_entity_id": _optional(drink.regnant_entity_id),
            "p_notes": drink.notes, "p_decay_days": drink.decay_days,
        }
        if drink.drank_at is not None:
            payload["p_drank_at"] = drink.drank_at.isoformat()
        return await self._rest.rpc("record_v5_bond_drink", payload)

    async def configure_bond(self, bond_id: UUID, decay_days: int, notes: str | None) -> Any:
        return await self._rest.rpc("configure_v5_blood_bond", {
            "p_bond_id": str(bond_id), "p_decay_days": decay_days, "p_notes": notes,
        })

    async def regnant_actions(self, sheet_id: UUID) -> Any:
        return await self._rest.request("GET", "v5_regnant_actions", params={
            "select": "*", "thrall_sheet_id": f"eq.{sheet_id}", "order": "created_at.desc",
            "limit": REGNANT_ACTION_LIST_LIMIT,
        })

    async def request_regnant_action(self, bond_id: UUID, action: str, roll_id: UUID | None) -> Any:
        return await self._rest.rpc("request_v5_regnant_action", {
            "p_bond_id": str(bond_id), "p_action": action, "p_roll_id": _optional(roll_id),
        })

    async def decide_regnant_action(self, action_id: UUID, decision: str, note: str | None) -> Any:
        return await self._rest.rpc("decide_v5_regnant_action", {
            "p_action_id": str(action_id), "p_decision": decision, "p_note": note,
        })
