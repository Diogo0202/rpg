"""Implementação de ``SheetRepository`` sobre tabelas e funções RPC do Supabase."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.sheets.ports import EvocationRegistration, NewSheet, Row

SHEET_COLUMNS = "id,campaign_id,template_id,owner_id,name,values,version,updated_at"
TEMPLATE_COLUMNS = "id,campaign_id,owner_id,name,version,status,schema"
TEMPLATE_LIST_COLUMNS = f"{TEMPLATE_COLUMNS},page_references,created_at,approved_at"
EVENT_COLUMNS = "id,kind,field_id,currency_id,delta,value_before,value_after,sheet_version,actor_id,reason,created_at"
VERSION_COLUMNS = "id,version,name,values,author_id,author_name,restored_from,created_at"
EVOCATION_COLUMNS = "id,name,lore_field,required_rank,faith_cost,source_title,source_page,verification_note,reviewed_by"
EVOCATION_LIST_LIMIT = "100"


def _eq(value: Any) -> str:
    return f"eq.{value}"


def _first(rows: Any) -> Row | None:
    if isinstance(rows, list):
        return rows[0] if rows else None
    return rows or None


class SupabaseSheetRepository:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def approved_template(self, campaign_id: UUID, template_id: UUID) -> Row | None:
        rows = await self._rest.request("GET", "system_templates", params={
            "select": TEMPLATE_COLUMNS,
            "id": _eq(template_id),
            "campaign_id": _eq(campaign_id),
            "status": "eq.approved",
            "limit": "1",
        })
        return _first(rows)

    async def approved_templates(self, campaign_id: UUID) -> list[Row]:
        return await self._rest.request("GET", "system_templates", params={
            "select": TEMPLATE_LIST_COLUMNS,
            "campaign_id": _eq(campaign_id),
            "status": "eq.approved",
            "order": "name.asc,version.desc",
        })

    async def sheets_of_campaign(self, campaign_id: UUID, owner_id: UUID | None) -> list[Row]:
        params = {"select": SHEET_COLUMNS, "campaign_id": _eq(campaign_id), "order": "updated_at.desc"}
        if owner_id is not None:
            params["owner_id"] = _eq(owner_id)
        return await self._rest.request("GET", "character_sheets", params=params)

    async def sheet(self, sheet_id: UUID) -> Row | None:
        rows = await self._rest.request("GET", "character_sheets", params={
            "select": SHEET_COLUMNS, "id": _eq(sheet_id), "limit": "1",
        })
        return _first(rows)

    async def insert_sheet(self, sheet: NewSheet) -> Row | None:
        rows = await self._rest.request("POST", "character_sheets", payload={
            "campaign_id": str(sheet.campaign_id),
            "template_id": str(sheet.template_id),
            "owner_id": sheet.owner_id,
            "name": sheet.name,
            "values": sheet.values,
            "portrait_path": sheet.portrait_path,
        })
        return _first(rows)

    async def insert_one_ring_sheet(self, sheet: NewSheet) -> Row | None:
        """O Um Anel v3 cria ficha e inventário inicial numa única transação."""
        rows = await self._rest.request("POST", "rpc/create_one_ring_sheet", payload={
            "p_campaign_id": str(sheet.campaign_id),
            "p_template_id": str(sheet.template_id),
            "p_name": sheet.name,
            "p_values": sheet.values,
            "p_portrait_path": sheet.portrait_path,
        })
        return _first(rows)

    async def update_sheet(self, sheet_id: UUID, expected_version: int, changes: dict[str, Any]) -> Row | None:
        rows = await self._rest.request(
            "PATCH", "character_sheets",
            params={"id": _eq(sheet_id), "version": _eq(expected_version)},
            payload=changes,
        )
        return _first(rows)

    async def delete_sheet(self, sheet_id: UUID, expected_version: int) -> bool:
        rows = await self._rest.request(
            "DELETE", "character_sheets", params={"id": _eq(sheet_id), "version": _eq(expected_version)},
        )
        return bool(rows)

    async def adjust_number(
        self, sheet_id: UUID, operation_id: UUID, field_id: str, delta: int, reason: str | None,
    ) -> Row:
        return await self._rest.rpc("adjust_sheet_number_idempotent", {
            "p_sheet_id": str(sheet_id), "p_operation_id": str(operation_id),
            "p_field_id": field_id, "p_delta": delta, "p_reason": reason,
        })

    async def add_experience(self, sheet_id: UUID, amount: int, reason: str | None) -> Row:
        return await self._rest.rpc("increment_xp", {"p_sheet_id": str(sheet_id), "p_amount": amount, "p_reason": reason})

    async def spend_meta_currency(self, sheet_id: UUID, currency_id: str, amount: int, reason: str | None) -> Row:
        return await self._rest.rpc("spend_meta_currency", {
            "p_sheet_id": str(sheet_id), "p_currency_id": currency_id, "p_amount": amount, "p_reason": reason,
        })

    async def events(self, sheet_id: UUID, limit: int) -> list[Row]:
        return await self._rest.request("GET", "character_sheet_events", params={
            "select": EVENT_COLUMNS, "sheet_id": _eq(sheet_id), "order": "id.desc", "limit": str(limit),
        })

    async def versions(self, sheet_id: UUID, limit: int) -> list[Row]:
        return await self._rest.request("GET", "character_sheet_versions", params={
            "select": VERSION_COLUMNS, "sheet_id": _eq(sheet_id), "order": "version.desc", "limit": str(limit),
        })

    async def restore_version(self, sheet_id: UUID, version: int, expected_version: int) -> Row:
        return await self._rest.rpc("restore_character_sheet_version", {
            "p_sheet_id": str(sheet_id), "p_version": version, "p_expected_version": expected_version,
        })

    async def demon_evocations(self, campaign_id: UUID) -> list[Row]:
        return await self._rest.request("GET", "demon_evocation_catalog", params={
            "select": EVOCATION_COLUMNS, "campaign_id": _eq(campaign_id),
            "order": "name.asc", "limit": EVOCATION_LIST_LIMIT,
        })

    async def register_demon_evocation(self, campaign_id: UUID, registration: EvocationRegistration) -> Row:
        return await self._rest.rpc("register_demon_evocation", {
            "p_campaign_id": str(campaign_id),
            "p_name": registration.name,
            "p_lore_field": registration.lore_field,
            "p_required_rank": registration.required_rank,
            "p_faith_cost": registration.faith_cost,
            "p_source_title": registration.source_title,
            "p_source_page": registration.source_page,
            "p_verification_note": registration.verification_note,
        })

    async def activate_demon_evocation(
        self, sheet_id: UUID, evocation_id: UUID, operation_id: UUID, expected_version: int,
    ) -> Row:
        return await self._rest.rpc("activate_demon_evocation", {
            "p_sheet_id": str(sheet_id), "p_evocation_id": str(evocation_id),
            "p_operation_id": str(operation_id), "p_expected_version": expected_version,
        })
