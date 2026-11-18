"""Implementação de ``WeaponReader`` sobre o inventário da ficha no Supabase."""

from __future__ import annotations

from pydantic import ValidationError

from app.adapters.outbound.supabase.rest_client import SupabaseRest, TableErrors
from app.domain.errors import Forbidden, ServiceUnavailable
from app.services.v5_actions import AttackContext, EquippedWeapon

INVENTORY_ERRORS = TableErrors(
    by_status={401: (Forbidden, "ficha não acessível"), 403: (Forbidden, "ficha não acessível")},
    otherwise=(ServiceUnavailable, "não foi possível ler o equipamento"),
)
INVALID_WEAPON = "equipamento inválido na ficha"


class SupabaseWeaponReader:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def equipped_weapon(self, attack: AttackContext) -> EquippedWeapon | None:
        rows = await self._rest.request("GET", "character_inventory", errors=INVENTORY_ERRORS, params={
            "select": "id,name,damage_bonus,damage_type",
            "sheet_id": f"eq.{attack.sheet_id}",
            "campaign_id": f"eq.{attack.campaign_id}",
            "category": "eq.weapon",
            "equipped": "is.true",
            "acquired": "is.true",
            # Duas linhas indicam inventário inconsistente; não escolhemos uma arma por conta própria.
            "limit": "2",
        })
        if not isinstance(rows, list) or len(rows) > 1:
            raise ServiceUnavailable(INVALID_WEAPON)
        try:
            return EquippedWeapon.model_validate(rows[0]) if rows else None
        except ValidationError as error:
            raise ServiceUnavailable(INVALID_WEAPON) from error
