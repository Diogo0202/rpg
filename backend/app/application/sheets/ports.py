"""Portas de saída que o caso de uso de fichas espera do mundo externo."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

from app.application.identity import CurrentUser

__all__ = ["CurrentUser", "EvocationRegistration", "NewSheet", "Row", "SheetRepository"]

Row = dict[str, Any]


@dataclass(frozen=True)
class NewSheet:
    campaign_id: UUID
    template_id: UUID
    owner_id: str
    name: str
    values: dict[str, Any]
    portrait_path: str | None


@dataclass(frozen=True)
class EvocationRegistration:
    name: str
    lore_field: str
    required_rank: int
    faith_cost: int
    source_title: str
    source_page: int
    verification_note: str


class SheetRepository(Protocol):
    """Leitura e gravação de fichas; o armazenamento aplica as permissões da sessão."""

    async def approved_template(self, campaign_id: UUID, template_id: UUID) -> Row | None: ...

    async def approved_templates(self, campaign_id: UUID) -> list[Row]: ...

    async def sheets_of_campaign(self, campaign_id: UUID, owner_id: UUID | None) -> list[Row]: ...

    async def sheet(self, sheet_id: UUID) -> Row | None: ...

    async def insert_sheet(self, sheet: NewSheet) -> Row | None: ...

    async def insert_one_ring_sheet(self, sheet: NewSheet) -> Row | None: ...

    async def update_sheet(self, sheet_id: UUID, expected_version: int, changes: dict[str, Any]) -> Row | None: ...

    async def delete_sheet(self, sheet_id: UUID, expected_version: int) -> bool: ...

    async def adjust_number(
        self, sheet_id: UUID, operation_id: UUID, field_id: str, delta: int, reason: str | None,
    ) -> Row: ...

    async def add_experience(self, sheet_id: UUID, amount: int, reason: str | None) -> Row: ...

    async def spend_meta_currency(self, sheet_id: UUID, currency_id: str, amount: int, reason: str | None) -> Row: ...

    async def events(self, sheet_id: UUID, limit: int) -> list[Row]: ...

    async def versions(self, sheet_id: UUID, limit: int) -> list[Row]: ...

    async def restore_version(self, sheet_id: UUID, version: int, expected_version: int) -> Row: ...

    async def demon_evocations(self, campaign_id: UUID) -> list[Row]: ...

    async def register_demon_evocation(self, campaign_id: UUID, registration: EvocationRegistration) -> Row: ...

    async def activate_demon_evocation(
        self, sheet_id: UUID, evocation_id: UUID, operation_id: UUID, expected_version: int,
    ) -> Row: ...
