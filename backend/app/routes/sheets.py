"""Compatibilidade durante a migração hexagonal (ver docs/adr/0002-backend-hexagonal.md).

O roteador de fichas vive em ``app.adapters.inbound.http.sheets``. As funções com prefixo
``_`` atendem rotas que ainda não foram migradas (experience, v5, v5_actions, v5_sanguine e
ai_assistance) e mantêm a assinatura antiga, com ``authorization`` explícito e ``HTTPException``.
Remova cada função quando a última rota que a usa passar a depender das portas.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.adapters.inbound.http.errors import domain_errors_as_http
from app.adapters.inbound.http.sheets import router
from app.adapters.outbound.supabase.rest_client import SupabaseRestClient
from app.adapters.outbound.supabase.sheet_repository import SupabaseSheetRepository

__all__ = ["HTTPException", "router"]


async def _current_user_id(authorization: str | None) -> str:
    with domain_errors_as_http():
        return await SupabaseRestClient(authorization).current_user_id()


async def _request(
    method: str,
    path: str,
    authorization: str | None,
    *,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    with domain_errors_as_http():
        return await SupabaseRestClient(authorization).request(method, path, params=params, payload=payload)


async def _rpc(name: str, authorization: str | None, payload: dict[str, Any]) -> Any:
    with domain_errors_as_http():
        return await SupabaseRestClient(authorization).rpc(name, payload)


async def _get_template(campaign_id: UUID, template_id: UUID, authorization: str) -> dict[str, Any]:
    with domain_errors_as_http():
        repository = SupabaseSheetRepository(SupabaseRestClient(authorization))
        template = await repository.approved_template(campaign_id, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="template aprovado não encontrado nesta campanha")
    return template
