"""Portas de saída do marketplace, separadas pelo nível de acesso de cada uma."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

Row = dict[str, Any]


@dataclass(frozen=True)
class SearchQuery:
    text: str | None
    tags: list[str]
    page: int
    limit: int
    sort: str


@dataclass(frozen=True)
class CopyrightReport:
    reason: str
    claimed_work: str
    rights_holder: str
    evidence_url: str | None


class MarketplaceCatalog(Protocol):
    """Leitura pública, sem sessão: só sistemas publicados."""

    async def search(self, query: SearchQuery) -> Any: ...

    async def published_system(self, system_id: UUID) -> Any: ...


class MarketplaceMember(Protocol):
    """Operações com o token de quem pede; o banco decide permissão e moderação."""

    async def publishable_templates(self) -> Any: ...

    async def export_template(self, template_id: UUID) -> Any: ...

    async def managed_campaigns(self) -> Any: ...

    async def pending_imports(self, campaign_id: UUID) -> Any: ...

    async def import_review(self, campaign_id: UUID, template_id: UUID) -> Any: ...

    async def approve_import(self, campaign_id: UUID, template_id: UUID, expected_schema: Row) -> Any: ...

    async def vote(self, system_id: UUID, value: int) -> Any: ...

    async def report(self, system_id: UUID, reason: str) -> Any: ...

    async def report_copyright(self, system_id: UUID, report: CopyrightReport) -> Any: ...

    async def clone(self, system_id: UUID, campaign_id: UUID, idempotency_key: str) -> Any: ...

    async def is_moderator(self) -> Any: ...

    async def moderation_queue(self, page: int, limit: int) -> Any: ...

    async def moderation_systems(self, status: str | None, text: str | None, page: int, limit: int) -> Any: ...

    async def moderation_history(self, page: int, limit: int) -> Any: ...

    async def resolve_report(self, report_id: UUID, action: str, note: str) -> Any: ...

    async def moderate_system(self, system_id: UUID, action: str, note: str) -> Any: ...


class MarketplaceServiceRole(Protocol):
    """Escritas privilegiadas, usadas só depois da autorização com o token do usuário."""

    async def publish(self, owner_id: str, record: Row) -> Row: ...

    async def apply_usage_events(self) -> int | None:
        """Eventos aplicados ao ``usage_count``, ou ``None`` sem chave de serviço configurada."""
