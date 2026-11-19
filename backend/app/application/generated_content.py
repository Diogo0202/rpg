"""Aplicação de conteúdo gerado (gerador procedural ou Segunda Inquisição) no mundo e no combate.

O servidor sempre regenera ou recalcula o conteúdo; o cliente nunca envia estatísticas.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

from app.domain.errors import ServiceUnavailable

Row = dict[str, Any]


@dataclass(frozen=True)
class ContentApplication:
    campaign_id: UUID
    idempotency_key: UUID
    source_kind: str
    source_ref: Row
    name: str
    entity_kind: str
    entity_body: Row
    save_entity: bool
    combat_id: UUID | None
    combat_block: Row | None

    @property
    def initiative(self) -> Any:
        return self.combat_block["initiative"] if self.combat_block and self.combat_id else None

    @property
    def health(self) -> Any:
        return self.combat_block["health"] if self.combat_block and self.combat_id else None


class ContentApplications(Protocol):
    async def apply(self, application: ContentApplication) -> Any:
        """Grava a entidade e/ou insere no combate de forma atômica e idempotente."""


async def apply_content(applications: ContentApplications, application: ContentApplication) -> Row:
    result = await applications.apply(application)
    if not isinstance(result, dict):
        raise ServiceUnavailable("Supabase não confirmou a aplicação")
    return result
