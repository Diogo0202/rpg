"""Implementação de ``ContentApplications`` sobre a RPC ``rpg_apply_generated_content``."""

from __future__ import annotations

from typing import Any

from app.adapters.outbound.supabase.campaign_rpc import CAMPAIGN_RPC_ERRORS
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.generated_content import ContentApplication


class SupabaseContentApplications:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def apply(self, application: ContentApplication) -> Any:
        return await self._rest.rpc("rpg_apply_generated_content", {
            "p_campaign_id": str(application.campaign_id),
            "p_idempotency_key": str(application.idempotency_key),
            "p_source_kind": application.source_kind,
            "p_source_ref": application.source_ref,
            "p_name": application.name,
            "p_entity_kind": application.entity_kind,
            "p_entity_body": application.entity_body,
            "p_save_entity": application.save_entity,
            "p_combat_id": str(application.combat_id) if application.combat_id else None,
            "p_initiative": application.initiative,
            "p_health": application.health,
            "p_combat_block": application.combat_block,
        }, errors=CAMPAIGN_RPC_ERRORS)
