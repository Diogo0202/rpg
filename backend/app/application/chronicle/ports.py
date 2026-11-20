"""Porta de saída do diagnóstico da crônica."""

from __future__ import annotations

from enum import Enum
from typing import Any, Protocol
from uuid import UUID

Row = dict[str, Any]


class ChronicleRecord(str, Enum):
    GOAL = "goal"
    SUPPORTER = "supporter"
    DEFECT = "defect"
    ACTIVITY = "activity"


class ChronicleStore(Protocol):
    """Leituras devolvem no máximo ``max_rows + 1`` linhas, para o caso de uso detectar o excesso."""

    async def campaign_owner(self, campaign_id: UUID) -> str | None: ...

    async def is_campaign_manager(self, campaign_id: UUID, user_id: str) -> bool: ...

    async def approved_templates(self, campaign_id: UUID, max_rows: int) -> list[Row]: ...

    async def sheet_refs(self, campaign_id: UUID, max_rows: int) -> list[Row]: ...

    async def sheets(self, campaign_id: UUID, sheet_ids: list[str]) -> list[Row]: ...

    async def records(self, kind: ChronicleRecord, campaign_id: UUID, sheet_ids: list[str], max_rows: int) -> list[Row]: ...

    async def insert_record(self, kind: ChronicleRecord, row: Row) -> Row | None: ...
