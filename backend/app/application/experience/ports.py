"""Porta de saída para compra e revisão de avanços com XP."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

Row = dict[str, Any]


@dataclass(frozen=True)
class AdvanceQuote:
    trait: str
    target_level: int
    item_name: str | None


@dataclass(frozen=True)
class AdvanceOrder:
    quote: AdvanceQuote
    expected_version: int
    operation_id: UUID
    reason: str | None


@dataclass(frozen=True)
class ExperiencePolicy:
    requires_approval: bool
    updated_by: str
    updated_at: datetime


class AdvanceRepository(Protocol):
    """O custo é sempre recalculado pelo armazenamento a partir do modelo aprovado da ficha."""

    async def quote(self, sheet_id: UUID, quote: AdvanceQuote) -> Row: ...

    async def purchase(self, sheet_id: UUID, order: AdvanceOrder) -> Row: ...

    async def history(self, sheet_id: UUID, limit: int) -> list[Row]: ...

    async def review(self, advance_id: UUID, approve: bool, note: str | None) -> Row: ...

    async def refund(self, advance_id: UUID, note: str | None) -> Row: ...

    async def policy(self, campaign_id: UUID) -> Row | None: ...

    async def save_policy(self, campaign_id: UUID, policy: ExperiencePolicy) -> Row | None: ...
