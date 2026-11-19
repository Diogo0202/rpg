"""Implementação de ``ChronicleStore`` sobre as tabelas da crônica no Supabase."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.rest_client import SupabaseRest, TableErrors
from app.application.chronicle.ports import ChronicleRecord, Row
from app.domain.errors import Forbidden, InvalidInput, ServiceUnavailable

# O PostgREST corta cada resposta num teto de linhas; páginas menores garantem a leitura completa.
PAGE_SIZE = 500
MAX_SHEETS_PER_DIAGNOSTIC = 20
NOT_ALLOWED = (Forbidden, "operação não permitida nesta campanha")
READ_ERRORS = TableErrors(
    by_status={401: NOT_ALLOWED, 403: NOT_ALLOWED},
    otherwise=(ServiceUnavailable, "não foi possível consultar os dados da campanha"),
)
WRITE_ERRORS = TableErrors(
    by_status={**READ_ERRORS.by_status, 400: (InvalidInput, "dados do registro foram rejeitados")},
    otherwise=READ_ERRORS.otherwise,
)
RECORD_TABLES: dict[ChronicleRecord, tuple[str, str, str]] = {
    ChronicleRecord.GOAL: (
        "chronicle_goals", "id,sheet_id,goal_type,statement,target_id,target_label,polarity", "created_at.asc,id.asc",
    ),
    ChronicleRecord.SUPPORTER: ("chronicle_supporters", "id,sheet_id,name", "created_at.asc,id.asc"),
    ChronicleRecord.DEFECT: ("chronicle_defects", "id,sheet_id,statement", "created_at.asc,id.asc"),
    ChronicleRecord.ACTIVITY: (
        "chronicle_activity",
        "id,sheet_id,occurred_on,used_trait_ids,used_goal_ids,used_defect_ids,threatened_supporter_ids",
        "occurred_on.asc,id.asc",
    ),
}


def _in(ids: list[str]) -> str:
    return f"in.({','.join(ids)})"


class SupabaseChronicleStore:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def campaign_owner(self, campaign_id: UUID) -> str | None:
        rows = await self._get("campaigns", {"select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1"})
        return rows[0].get("owner_id") if rows else None

    async def is_campaign_manager(self, campaign_id: UUID, user_id: str) -> bool:
        rows = await self._get("campaign_members", {
            "select": "role", "campaign_id": f"eq.{campaign_id}",
            "user_id": f"eq.{user_id}", "role": "in.(owner,master)", "limit": "1",
        })
        return bool(rows)

    async def approved_templates(self, campaign_id: UUID, max_rows: int) -> list[Row]:
        return await self._all_rows("system_templates", {
            "select": "id,campaign_id,name,version,schema,status", "campaign_id": f"eq.{campaign_id}",
            "status": "eq.approved", "order": "name.asc,version.desc",
        }, max_rows)

    async def sheet_refs(self, campaign_id: UUID, max_rows: int) -> list[Row]:
        return await self._all_rows("character_sheets", {
            "select": "id,template_id", "campaign_id": f"eq.{campaign_id}", "order": "id.asc",
        }, max_rows)

    async def sheets(self, campaign_id: UUID, sheet_ids: list[str]) -> list[Row]:
        return await self._get("character_sheets", {
            "select": "id,campaign_id,template_id,owner_id,name,values,updated_at",
            "campaign_id": f"eq.{campaign_id}", "id": _in(sheet_ids), "order": "id.asc",
            "limit": str(MAX_SHEETS_PER_DIAGNOSTIC),
        })

    async def records(self, kind: ChronicleRecord, campaign_id: UUID, sheet_ids: list[str], max_rows: int) -> list[Row]:
        table, columns, order = RECORD_TABLES[kind]
        params = {"select": columns, "campaign_id": f"eq.{campaign_id}", "order": order}
        if sheet_ids:
            params["sheet_id"] = _in(sheet_ids)
        return await self._all_rows(table, params, max_rows)

    async def insert_record(self, kind: ChronicleRecord, row: Row) -> Row | None:
        table, _, _ = RECORD_TABLES[kind]
        rows = await self._rest.request("POST", table, payload=row, errors=WRITE_ERRORS)
        return rows[0] if rows else None

    async def _get(self, table: str, params: dict[str, str]) -> Any:
        return await self._rest.request("GET", table, params=params, errors=READ_ERRORS)

    async def _all_rows(self, table: str, params: dict[str, str], max_rows: int) -> list[Row]:
        """Lê página por página e para assim que passar de ``max_rows``."""
        rows: list[Row] = []
        while len(rows) <= max_rows:
            page_size = min(PAGE_SIZE, max_rows + 1 - len(rows))
            page = await self._get(table, {**params, "limit": str(page_size), "offset": str(len(rows))})
            rows.extend(page)
            if len(page) < page_size:
                break
        return rows
