"""Consulta às fontes de regras aprovadas da campanha.

O texto vem de livros enviados pela mesa: é tratado como dado não confiável e projetado só nos
campos esperados antes de chegar à interface ou a qualquer prompt.
"""

from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID

from app.application.identity import CurrentUser
from app.domain.errors import InvalidInput, NotFound, UnexpectedUpstreamResponse
from app.domain.prompt_security import (
    UntrustedDataError,
    normalize_untrusted_text,
    validate_rule_page_result,
    validate_rule_search_results,
)

MAX_QUERY_CHARS = 160
MIN_QUERY_CHARS = 2
MAX_PAGE_NUMBER = 100_000
INVALID_RESPONSE = "resposta inválida do Supabase"


class RulebookStore(Protocol):
    async def search(self, campaign_id: UUID, query: str, limit: int) -> Any: ...

    async def page(self, campaign_id: UUID, source_id: UUID, page_number: int) -> Any: ...


class RulesService:
    def __init__(self, identity: CurrentUser, rulebooks: RulebookStore) -> None:
        self._identity = identity
        self._rulebooks = rulebooks

    async def search(self, campaign_id: UUID, text: str, limit: int) -> list[dict[str, Any]]:
        try:
            query = normalize_untrusted_text(text, field="q", max_chars=MAX_QUERY_CHARS, max_bytes=MAX_QUERY_CHARS * 4).strip()
        except UntrustedDataError as error:
            raise InvalidInput(str(error)) from error
        if len(query) < MIN_QUERY_CHARS:
            raise InvalidInput("informe ao menos dois caracteres")
        await self._identity.current_user_id()
        result = await self._rulebooks.search(campaign_id, query, limit)
        try:
            return validate_rule_search_results(result)  # type: ignore[return-value]
        except UntrustedDataError as error:
            raise UnexpectedUpstreamResponse(INVALID_RESPONSE) from error

    async def page(self, campaign_id: UUID, source_id: UUID, page_number: int) -> dict[str, Any]:
        if not 1 <= page_number <= MAX_PAGE_NUMBER:
            raise InvalidInput("página precisa estar entre 1 e 100.000")
        await self._identity.current_user_id()
        rows = await self._rulebooks.page(campaign_id, source_id, page_number)
        try:
            safe_row = validate_rule_page_result(rows)
        except UntrustedDataError as error:
            raise UnexpectedUpstreamResponse(INVALID_RESPONSE) from error
        if safe_row is None:
            raise NotFound("página aprovada não encontrada nesta campanha")
        return safe_row  # type: ignore[return-value]
