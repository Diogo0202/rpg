"""Adaptadores Supabase da assistência por IA."""

from __future__ import annotations

import os
from typing import Any, Protocol
from uuid import UUID

import httpx

from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.adapters.outbound.supabase.sheet_repository import SupabaseSheetRepository
from app.application.ai.ports import Actor, ContextKind, Row, TargetKind
from app.domain.errors import Conflict, NotFound, ServiceUnavailable

REQUEST_TIMEOUT_SECONDS = 8
MAX_PRIVATE_RESPONSE_BYTES = 2_097_152
LIST_LIMIT = "100"
PRIVATE_UNAVAILABLE = "Armazenamento privado da IA indisponível."
MANAGER_ROLES = frozenset({"owner", "master"})
MEMBER_ROLES = MANAGER_ROLES | {"player"}

# Tabela, colunas e campo de título de cada tipo de contexto que o narrador pode anexar.
CONTEXT_TABLES: dict[str, tuple[str, str, str]] = {
    "session": ("campaign_sessions", "id,title,summary,status,updated_at,sync_version", "title"),
    "event": ("campaign_events", "id,title,description,status,updated_at", "title"),
    "entity": ("world_entities", "id,name,kind,body,version", "name"),
    "sheet": ("character_sheets", "id,name,template_id,values,version", "name"),
}
TARGET_TABLES: dict[str, tuple[str, str]] = {
    "sheet": ("character_sheets", "id,name,owner_id,template_id,values,version"),
    "npc": ("world_entities", "id,name,kind,body,version"),
    "session": ("campaign_sessions", "id,title,summary,updated_at,sync_version"),
}


def _first(rows: Any) -> Row | None:
    return rows[0] if rows else None


class SupabaseCampaignActors:
    """Papel de quem pede na campanha; usa o usuário já verificado pelo middleware quando houver."""

    def __init__(self, rest: SupabaseRest, verified_user_id: str | None) -> None:
        self._rest = rest
        self._verified_user_id = verified_user_id

    async def actor(self, campaign_id: UUID) -> Actor:
        user_id = self._verified_user_id or await self._rest.current_user_id()
        campaigns = await self._rest.request("GET", "campaigns", params={
            "select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1",
        })
        if not campaigns:
            raise NotFound("Campanha não encontrada.")
        owner = campaigns[0]["owner_id"] == user_id
        members = await self._rest.request("GET", "campaign_members", params={
            "select": "role", "campaign_id": f"eq.{campaign_id}", "user_id": f"eq.{user_id}", "limit": "1",
        })
        role = members[0]["role"] if members else None
        return Actor(user_id, owner or role in MANAGER_ROLES, owner or role in MEMBER_ROLES)


class SupabaseAiCampaignStore:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def proposal(self, campaign_id: UUID, proposal_id: UUID) -> Row | None:
        return _first(await self._get("ai_requests", {
            "select": "*", "id": f"eq.{proposal_id}", "campaign_id": f"eq.{campaign_id}", "limit": "1",
        }))

    async def proposal_by_key(self, campaign_id: UUID, author_id: str, idempotency_key: UUID) -> Row | None:
        return _first(await self._get("ai_requests", {
            "select": "*", "campaign_id": f"eq.{campaign_id}", "author_id": f"eq.{author_id}",
            "idempotency_key": f"eq.{idempotency_key}", "limit": "1",
        }))

    async def proposals(self, campaign_id: UUID) -> Any:
        return await self._get("ai_requests", {
            "select": "*", "campaign_id": f"eq.{campaign_id}", "order": "created_at.desc", "limit": LIST_LIMIT,
        })

    async def proposal_contents(self, proposal_id: UUID, *, with_result: bool) -> Row | None:
        return _first(await self._get("ai_proposal_contents", {
            "select": "context,result" if with_result else "context", "request_id": f"eq.{proposal_id}", "limit": "1",
        }))

    async def context_record(self, kind: ContextKind, campaign_id: UUID, record_id: UUID) -> Row | None:
        table, columns, _ = CONTEXT_TABLES[kind]
        return _first(await self._get(table, {
            "select": columns, "campaign_id": f"eq.{campaign_id}", "id": f"eq.{record_id}", "limit": "1",
        }))

    async def context_options(self, kind: ContextKind, campaign_id: UUID) -> list[Row]:
        table, _, title = CONTEXT_TABLES[kind]
        columns = f"id,{title},kind" if kind == "entity" else f"id,{title}"
        rows = await self._get(table, {
            "select": columns, "campaign_id": f"eq.{campaign_id}", "limit": LIST_LIMIT, "order": f"{title}.asc",
        })
        return [
            {"kind": kind, "id": row["id"], "title": row[title], **({"entity_kind": row["kind"]} if kind == "entity" else {})}
            for row in rows
        ]

    async def target(self, kind: TargetKind, campaign_id: UUID, target_id: UUID) -> Row | None:
        table, columns = TARGET_TABLES[kind]
        return _first(await self._get(table, {
            "select": columns, "campaign_id": f"eq.{campaign_id}", "id": f"eq.{target_id}", "limit": "1",
        }))

    async def entity_in_campaign(self, campaign_id: UUID | str, entity_id: UUID) -> bool:
        return bool(await self._get("world_entities", {
            "select": "id", "id": f"eq.{entity_id}", "campaign_id": f"eq.{campaign_id}", "limit": "1",
        }))

    async def approved_template(self, campaign_id: UUID, template_id: UUID) -> Row:
        template = await SupabaseSheetRepository(self._rest).approved_template(campaign_id, template_id)
        if template is None:
            raise NotFound("template aprovado não encontrado nesta campanha")
        return template

    async def preparations(self, campaign_id: UUID) -> Any:
        return await self._get("ai_private_preparations", {
            "select": "*", "campaign_id": f"eq.{campaign_id}", "order": "created_at.desc", "limit": LIST_LIMIT,
        })

    async def approve(self, campaign_id: UUID, proposal_id: UUID, expected_version: int, result: Row) -> Any:
        return await self._apply("ai_approve_proposal", {
            "p_campaign_id": str(campaign_id), "p_request_id": str(proposal_id),
            "p_expected_version": expected_version, "p_result": result,
        })

    async def reject(self, campaign_id: UUID, proposal_id: UUID, expected_version: int) -> Any:
        return await self._apply("ai_reject_proposal", {
            "p_campaign_id": str(campaign_id), "p_request_id": str(proposal_id), "p_expected_version": expected_version,
        })

    async def publish_preparation(self, campaign_id: UUID, preparation_id: UUID, expected_version: int, fields: Row) -> Any:
        return await self._apply("ai_publish_preparation", {
            "p_campaign_id": str(campaign_id), "p_preparation_id": str(preparation_id),
            "p_expected_version": expected_version, "p_fields": fields,
        })

    async def _get(self, table: str, params: dict[str, str]) -> Any:
        return await self._rest.request("GET", table, params=params)

    async def _apply(self, function: str, payload: Row) -> Any:
        # O token de quem pede, nunca a chave de serviço, em qualquer operação que aplica conteúdo.
        return await self._rest.request("POST", f"rpc/{function}", payload=payload)


class PrivateTransport(Protocol):
    async def __call__(self, method: str, path: str, *, params: dict[str, str] | None = None, payload: Row | None = None) -> Any: ...


async def service_role_request(method: str, path: str, *, params: dict[str, str] | None = None, payload: Row | None = None) -> Any:
    """Transporte privilegiado, usado só depois da autorização com o token do usuário."""
    base_url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not key:
        raise ServiceUnavailable(PRIVATE_UNAVAILABLE)
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=representation"}
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.request(method, f"{base_url.rstrip('/')}/rest/v1/{path}", headers=headers, json=payload, params=params)
    except httpx.HTTPError as error:
        raise ServiceUnavailable(PRIVATE_UNAVAILABLE) from error
    if response.status_code == 409:
        raise Conflict("A proposta mudou ou o pedido já existe. Atualize a lista.")
    if response.status_code >= 400 or len(response.content) > MAX_PRIVATE_RESPONSE_BYTES:
        raise ServiceUnavailable(PRIVATE_UNAVAILABLE)
    try:
        return response.json() if response.content else None
    except ValueError as error:
        raise ServiceUnavailable("Resposta inválida do armazenamento.") from error


class SupabaseAiPrivateStore:
    def __init__(self, transport: PrivateTransport = service_role_request) -> None:
        self._transport = transport

    def is_configured(self) -> bool:
        return bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

    async def recover_stale(self, campaign_id: UUID) -> Any:
        return await self._rpc("ai_recover_stale", {"p_campaign_id": str(campaign_id)})

    async def reserve(self, campaign_id: str, user_id: str, operation_id: str, reserve_micro: int) -> Any:
        return await self._rpc("ai_budget_reserve", {
            "p_campaign_id": campaign_id, "p_user_id": user_id, "p_operation_id": operation_id, "p_reserve_micro": reserve_micro,
        })

    async def dispatch(self, operation_id: str) -> Any:
        return await self._rpc("ai_budget_dispatch", {"p_operation_id": operation_id})

    async def settle(self, operation_id: str, actual_micro: int, input_tokens: int, output_tokens: int) -> Any:
        return await self._rpc("ai_budget_settle", {
            "p_operation_id": operation_id, "p_actual_micro": actual_micro,
            "p_input_tokens": input_tokens, "p_output_tokens": output_tokens,
        })

    async def mark_uncertain(self, operation_id: str) -> Any:
        return await self._rpc("ai_budget_uncertain", {"p_operation_id": operation_id})

    async def cancel(self, operation_id: str) -> Any:
        return await self._rpc("ai_budget_cancel", {"p_operation_id": operation_id})

    async def create_request(self, row: Row) -> list[Row]:
        return await self._transport("POST", "ai_requests", payload=row)

    async def create_contents(self, row: Row) -> Any:
        return await self._transport("POST", "ai_proposal_contents", payload=row)

    async def save_contents(self, proposal_id: str, context: Row, result: Row) -> Any:
        return await self._transport(
            "PATCH", "ai_proposal_contents", params={"request_id": f"eq.{proposal_id}"}, payload={"context": context, "result": result},
        )

    async def transition_request(self, filters: dict[str, str], changes: Row) -> list[Row]:
        return await self._transport("PATCH", "ai_requests", params=filters, payload=changes)

    async def _rpc(self, function: str, payload: Row) -> Any:
        return await self._transport("POST", f"rpc/{function}", payload=payload)
