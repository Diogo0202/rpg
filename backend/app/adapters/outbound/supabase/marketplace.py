"""Adaptadores do marketplace: catálogo público, operações do usuário e escritas com a chave de serviço."""

from __future__ import annotations

import os
from typing import Any, Protocol
from uuid import UUID

import httpx

from app.adapters.outbound.supabase.errors import RpcErrors
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.marketplace.ports import CopyrightReport, Row, SearchQuery
from app.domain.errors import Conflict, Forbidden, NotFound, RateLimited, ServiceUnavailable, Unauthenticated

REQUEST_TIMEOUT_SECONDS = 8
USAGE_TIMEOUT_SECONDS = 15
USAGE_BATCH_SIZE = 5000
NOT_ALLOWED = "operação não permitida"
SYSTEM_COLUMNS = "id,name,description,tags,author_name,automation_level,dependencies,updated_at,usage_count,likes,dislikes,template"
MEMBER_ERRORS = RpcErrors(
    by_code={
        "42501": (Forbidden, NOT_ALLOWED),
        "P0001": (Forbidden, NOT_ALLOWED),
        "22023": (Conflict, "chave repetida com dados diferentes ou operação inválida"),
        "54000": (RateLimited, "limite de denúncias atingido; tente novamente amanhã"),
    },
    by_status={401: (Unauthenticated, "sessão inválida"), 404: (NotFound, "sistema ou campanha não encontrado")},
    otherwise=(Forbidden, NOT_ALLOWED),
)


def _supabase_url() -> str | None:
    base_url = os.getenv("SUPABASE_URL")
    return base_url.rstrip("/") if base_url else None


class PublicRequest(Protocol):
    async def __call__(self, method: str, path: str, *, params: dict[str, str] | None = None, payload: Row | None = None) -> Any: ...


class SupabaseMarketplaceCatalog:
    """Leitura com a chave pública, sem token de usuário."""

    def __init__(self, request: PublicRequest | None = None) -> None:
        self._request = request or public_request

    async def search(self, query: SearchQuery) -> Any:
        return await self._request("POST", "rpc/marketplace_search", payload={
            "p_q": query.text, "p_tags": query.tags, "p_page": query.page, "p_limit": query.limit, "p_sort": query.sort,
        })

    async def published_system(self, system_id: UUID) -> Any:
        return await self._request("GET", "marketplace_systems", params={
            "select": SYSTEM_COLUMNS, "id": f"eq.{system_id}", "status": "eq.published", "limit": "1",
        })


async def public_request(method: str, path: str, *, params: dict[str, str] | None = None, payload: Row | None = None) -> Any:
    base_url, api_key = _supabase_url(), os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not base_url or not api_key:
        raise ServiceUnavailable("Supabase da API não está configurado")
    headers = {"apikey": api_key, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.request(method, f"{base_url}/rest/v1/{path}", headers=headers, params=params, json=payload)
    except httpx.HTTPError as error:
        raise ServiceUnavailable("Supabase indisponível") from error
    if response.status_code == 404:
        raise NotFound("sistema não encontrado")
    if response.status_code >= 500:
        raise ServiceUnavailable(NOT_ALLOWED)
    if response.status_code >= 400:
        raise Forbidden(NOT_ALLOWED)
    return response.json() if response.content else []


class SupabaseMarketplaceMember:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def publishable_templates(self) -> Any:
        return await self._rpc("marketplace_publishable_templates", {})

    async def export_template(self, template_id: UUID) -> Any:
        return await self._rpc("marketplace_export_template", {"p_template_id": str(template_id)})

    async def managed_campaigns(self) -> Any:
        return await self._rpc("marketplace_managed_campaigns", {})

    async def pending_imports(self, campaign_id: UUID) -> Any:
        return await self._rpc("marketplace_pending_imports", {"p_campaign_id": str(campaign_id)})

    async def import_review(self, campaign_id: UUID, template_id: UUID) -> Any:
        return await self._rpc("marketplace_import_review", {"p_campaign_id": str(campaign_id), "p_template_id": str(template_id)})

    async def approve_import(self, campaign_id: UUID, template_id: UUID, expected_schema: Row) -> Any:
        return await self._rpc("marketplace_approve_import", {
            "p_campaign_id": str(campaign_id), "p_template_id": str(template_id), "p_expected_schema": expected_schema,
        })

    async def vote(self, system_id: UUID, value: int) -> Any:
        return await self._rpc("marketplace_vote", {"p_system_id": str(system_id), "p_value": value})

    async def report(self, system_id: UUID, reason: str) -> Any:
        return await self._rpc("marketplace_report", {"p_system_id": str(system_id), "p_reason": reason})

    async def report_copyright(self, system_id: UUID, report: CopyrightReport) -> Any:
        return await self._rpc("marketplace_report_copyright", {
            "p_system_id": str(system_id), "p_reason": report.reason, "p_claimed_work": report.claimed_work,
            "p_rights_holder": report.rights_holder, "p_evidence_url": report.evidence_url, "p_good_faith": True,
        })

    async def clone(self, system_id: UUID, campaign_id: UUID, idempotency_key: str) -> Any:
        return await self._rpc("marketplace_clone", {
            "p_system_id": str(system_id), "p_campaign_id": str(campaign_id), "p_idempotency_key": idempotency_key,
        })

    async def is_moderator(self) -> Any:
        return await self._rpc("marketplace_is_moderator", {})

    async def moderation_queue(self, page: int, limit: int) -> Any:
        return await self._rpc("marketplace_moderation_queue", {"p_page": page, "p_limit": limit})

    async def moderation_systems(self, status: str | None, text: str | None, page: int, limit: int) -> Any:
        return await self._rpc("marketplace_moderation_systems", {"p_status": status, "p_q": text, "p_page": page, "p_limit": limit})

    async def moderation_history(self, page: int, limit: int) -> Any:
        return await self._rpc("marketplace_moderation_history", {"p_page": page, "p_limit": limit})

    async def resolve_report(self, report_id: UUID, action: str, note: str) -> Any:
        return await self._rpc("marketplace_resolve_report", {"p_report_id": str(report_id), "p_action": action, "p_resolution_note": note})

    async def moderate_system(self, system_id: UUID, action: str, note: str) -> Any:
        return await self._rpc("marketplace_moderate_system", {"p_system_id": str(system_id), "p_action": action, "p_note": note})

    async def _rpc(self, function: str, payload: Row) -> Any:
        return await self._rest.rpc(function, payload, errors=MEMBER_ERRORS)


class SupabaseMarketplaceServiceRole:
    """Usa ``SUPABASE_SERVICE_ROLE_KEY``; o dono e o status publicados vêm sempre do servidor."""

    async def publish(self, owner_id: str, record: Row) -> Row:
        base_url = _supabase_url()
        if not base_url or not os.getenv("SUPABASE_PUBLISHABLE_KEY"):
            raise ServiceUnavailable("Supabase da API não está configurado")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not key:
            raise ServiceUnavailable("publicação indisponível")
        body = {**record, "owner_id": owner_id, "status": "published"}
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                response = await client.post(f"{base_url}/rest/v1/marketplace_systems", headers={
                    **_service_headers(key), "Prefer": "return=representation",
                }, json=body)
        except httpx.HTTPError as error:
            raise ServiceUnavailable("publicação indisponível") from error
        if response.status_code >= 400:
            raise ServiceUnavailable("não foi possível publicar o sistema")
        rows = response.json()
        if not isinstance(rows, list) or not rows:
            raise ServiceUnavailable("resposta inválida na publicação")
        return rows[0]

    async def apply_usage_events(self, batch_size: int = USAGE_BATCH_SIZE) -> int | None:
        """A RPC é idempotente e restrita a service_role."""
        base_url, key = _supabase_url(), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not base_url or not key:
            return None
        try:
            async with httpx.AsyncClient(timeout=USAGE_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{base_url}/rest/v1/rpc/marketplace_apply_usage_events",
                    headers={**_service_headers(key), "Accept": "application/json"}, json={"p_batch_size": batch_size},
                )
        except httpx.HTTPError as error:
            raise ServiceUnavailable("agregação de uso indisponível") from error
        if response.status_code >= 400:
            raise ServiceUnavailable("agregação de uso indisponível")
        try:
            applied = response.json()
        except ValueError as error:
            raise ServiceUnavailable("resposta inválida da agregação") from error
        if isinstance(applied, bool) or not isinstance(applied, int) or applied < 0:
            raise ServiceUnavailable("resposta inválida da agregação")
        return applied


def _service_headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
