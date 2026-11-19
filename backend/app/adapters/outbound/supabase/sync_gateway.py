"""Implementação de ``SyncGateway`` sobre as tabelas e RPCs de sincronização do Supabase.

O transporte é mais estrito que o cliente REST comum: corpo vazio, acima de 8 MB ou com
NaN/Infinity é resposta inválida (502), e o limite do Supabase (429) repassa o ``Retry-After``.
"""

from __future__ import annotations

import json
import os
from typing import Any, Protocol
from uuid import UUID

import httpx

from app.domain.errors import Forbidden, RateLimited, ServiceUnavailable, Unauthenticated, UnexpectedUpstreamResponse

REQUEST_TIMEOUT_SECONDS = 8
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
INVALID_RESPONSE = "resposta inválida do serviço de sincronização"
UNAVAILABLE = "Supabase indisponível"


class SyncTransport(Protocol):
    async def call(self, method: str, path: str, *, params: dict[str, str] | None = None, payload: dict[str, Any] | None = None) -> Any: ...


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"valor JSON inválido: {value}")


class SupabaseSyncTransport:
    """Chamada ao PostgREST com o token já verificado de quem pede."""

    def __init__(self, authorization: str | None) -> None:
        self._authorization = authorization or ""

    async def call(self, method: str, path: str, *, params: dict[str, str] | None = None, payload: dict[str, Any] | None = None) -> Any:
        base_url, api_key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_PUBLISHABLE_KEY")
        if not base_url or not api_key:
            raise ServiceUnavailable("Supabase da API não está configurado")
        if not self._authorization.startswith("Bearer "):
            raise Unauthenticated("sessão necessária")
        headers = {"apikey": api_key, "Authorization": self._authorization, "Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                response = await client.request(
                    method, f"{base_url.rstrip('/')}/rest/v1/{path}", headers=headers, params=params, json=payload,
                )
        except httpx.HTTPError as error:
            raise ServiceUnavailable(UNAVAILABLE) from error
        _raise_for_status(response)
        if not response.content or len(response.content) > MAX_RESPONSE_BYTES:
            raise UnexpectedUpstreamResponse(INVALID_RESPONSE)
        try:
            return json.loads(response.content, parse_constant=_reject_json_constant)
        except (ValueError, TypeError, UnicodeDecodeError) as error:
            raise UnexpectedUpstreamResponse(INVALID_RESPONSE) from error


def _raise_for_status(response: Any) -> None:
    status = response.status_code
    if status in {401, 403}:
        raise Forbidden("acesso não permitido nesta campanha")
    if status == 429:
        raise RateLimited("limite do Supabase excedido", retry_after_seconds=response.headers.get("Retry-After", "1"))
    if status >= 500:
        raise ServiceUnavailable(UNAVAILABLE)
    if status >= 400:
        raise Forbidden("operação não permitida nesta campanha")


class SupabaseSyncGateway:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    async def visible_campaigns(self) -> Any:
        return await self._transport.call("GET", "campaigns", params={
            "select": "id,owner_id,name,description,updated_at", "order": "updated_at.desc",
        })

    async def campaign(self, campaign_id: UUID) -> Any:
        return await self._transport.call("GET", "campaigns", params={
            "select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1",
        })

    async def membership(self, campaign_id: UUID, user_id: str) -> Any:
        return await self._transport.call("GET", "campaign_members", params={
            "select": "role", "campaign_id": f"eq.{campaign_id}", "user_id": f"eq.{user_id}", "limit": "1",
        })

    async def push(self, campaign_id: UUID, device_id: UUID, mutations: list[dict[str, Any]]) -> Any:
        return await self._transport.call("POST", "rpc/mobile_sync_push", payload={
            "p_campaign_id": str(campaign_id), "p_device_id": str(device_id), "p_mutations": mutations,
        })

    async def snapshot(self, campaign_id: UUID, entity_type: str, after_id: UUID | None, limit: int) -> Any:
        return await self._transport.call("POST", "rpc/mobile_sync_snapshot", payload={
            "p_campaign_id": str(campaign_id), "p_entity_type": entity_type,
            "p_after_id": str(after_id) if after_id else None, "p_limit": limit,
        })

    async def changes(self, campaign_id: UUID, cursor: int, limit: int) -> Any:
        return await self._transport.call("POST", "rpc/mobile_sync_changes", payload={
            "p_campaign_id": str(campaign_id), "p_cursor": cursor, "p_limit": limit,
        })
