"""Implementação de ``RulebookStore`` sobre as RPCs de busca e leitura de páginas de regras."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.rest_client import RpcErrors, SupabaseRest
from app.domain.errors import Forbidden, UnexpectedUpstreamResponse

MAX_RESPONSE_BYTES = 100_000
NO_ACCESS = (Forbidden, "acesso não permitido nesta campanha")
RULEBOOK_ERRORS = RpcErrors(
    by_code={},
    by_status={401: NO_ACCESS, 403: NO_ACCESS},
    otherwise=(UnexpectedUpstreamResponse, "resposta inválida do Supabase"),
)


class SupabaseRulebookStore:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def search(self, campaign_id: UUID, query: str, limit: int) -> Any:
        return await self._rpc("search_campaign_rules", {"p_campaign_id": str(campaign_id), "p_query": query, "p_limit": limit})

    async def page(self, campaign_id: UUID, source_id: UUID, page_number: int) -> Any:
        return await self._rpc("get_campaign_rule_page", {
            "p_campaign_id": str(campaign_id), "p_source_id": str(source_id), "p_page_number": page_number,
        })

    async def _rpc(self, function: str, payload: dict[str, Any]) -> Any:
        result = await self._rest.rpc(function, payload, errors=RULEBOOK_ERRORS, max_response_bytes=MAX_RESPONSE_BYTES)
        return [] if result is None else result
