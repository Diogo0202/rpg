"""Implementação de ``InquisitionStore`` sobre a tabela ``second_inquisition_events``."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.errors import TableErrors
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.domain.errors import Conflict, Forbidden, InvalidInput

EVENTS_TABLE = "second_inquisition_events"
EVENT_COLUMNS = "id,campaign_id,event_kind,area_id,occurred_at,verified_at,created_by,version"
NO_ACCESS = (Forbidden, "acesso não permitido nesta campanha")
READ_ERRORS = TableErrors(
    by_status={401: NO_ACCESS, 403: NO_ACCESS, 409: (Conflict, "conflito ao alterar a confirmação")},
    otherwise=(Forbidden, "operação não permitida nesta campanha"),
)
WRITE_ERRORS = TableErrors(
    by_status={**READ_ERRORS.by_status, 400: (InvalidInput, "dados da confirmação rejeitados pelo Supabase")},
    otherwise=READ_ERRORS.otherwise,
)


class SupabaseInquisitionStore:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def campaign_owner(self, campaign_id: UUID) -> str | None:
        rows = await self._get("campaigns", {"select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1"})
        return rows[0].get("owner_id") if rows else None

    async def member_role(self, campaign_id: UUID, user_id: str) -> str | None:
        rows = await self._get("campaign_members", {
            "select": "role", "campaign_id": f"eq.{campaign_id}", "user_id": f"eq.{user_id}", "limit": "1",
        })
        return rows[0].get("role") if rows else None

    async def events_page(self, campaign_id: UUID, limit: int, offset: int) -> Any:
        return await self._get(EVENTS_TABLE, {
            "select": EVENT_COLUMNS, "campaign_id": f"eq.{campaign_id}", "order": "verified_at.asc,id.asc",
            "limit": str(limit), "offset": str(offset),
        })

    async def confirm(self, campaign_id: UUID, event_kind: str, area_id: str, occurred_at: datetime) -> Any:
        return await self._rest.request("POST", EVENTS_TABLE, errors=WRITE_ERRORS, payload={
            "campaign_id": str(campaign_id), "event_kind": event_kind, "area_id": area_id, "occurred_at": occurred_at.isoformat(),
        })

    async def revoke(self, campaign_id: UUID, event_id: UUID, expected_version: int) -> Any:
        return await self._rest.request("DELETE", EVENTS_TABLE, errors=READ_ERRORS, params={
            "id": f"eq.{event_id}", "campaign_id": f"eq.{campaign_id}", "version": f"eq.{expected_version}", "select": "id",
        })

    async def _get(self, table: str, params: dict[str, str]) -> Any:
        return await self._rest.request("GET", table, params=params, errors=READ_ERRORS)
