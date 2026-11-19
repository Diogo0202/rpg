"""Adaptador HTTP da busca e leitura de páginas das fontes de regras da campanha."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.adapters.inbound.http.dependencies import supabase_session
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.adapters.outbound.supabase.rulebook_store import SupabaseRulebookStore
from app.application.rules import RulesService

router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}", tags=["rules"], route_class=DomainErrorRoute)


def rules_service(supabase: SupabaseRest = Depends(supabase_session)) -> RulesService:
    return RulesService(supabase, SupabaseRulebookStore(supabase))


Rules = Depends(rules_service)


@router.get("/rules/search")
async def search_campaign_rules(
    campaign_id: UUID,
    q: str = Query(min_length=2, max_length=160),
    limit: int = Query(default=5, ge=1, le=10),
    service: RulesService = Rules,
) -> list[dict[str, Any]]:
    return await service.search(campaign_id, q, limit)


@router.get("/sources/{source_id}/pages/{page_number}")
async def get_campaign_rule_page(campaign_id: UUID, source_id: UUID, page_number: int, service: RulesService = Rules) -> dict[str, Any]:
    return await service.page(campaign_id, source_id, page_number)
