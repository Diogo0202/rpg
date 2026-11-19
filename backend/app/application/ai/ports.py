"""Portas da assistência por IA: dados da campanha, armazenamento privado e provedor do modelo."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import UUID

Row = dict[str, Any]
ContextKind = Literal["session", "event", "entity", "sheet"]
TargetKind = Literal["sheet", "session", "npc"]


class AIUnavailable(Exception):
    """A IA está desligada ou sem configuração completa."""


class AIProviderError(Exception):
    """Falha do provedor; ``usage`` traz os tokens já consumidos quando o provedor os informou."""

    def __init__(self, code: str, usage: dict[str, int] | None = None):
        super().__init__(code)
        self.code = code
        self.usage = usage


@dataclass(frozen=True)
class ProviderResult:
    result: dict[str, Any]
    input_tokens: int
    output_tokens: int
    model: str


@dataclass
class Actor:
    """Quem pede, com os papéis que tem na campanha."""

    id: str
    manager: bool
    player: bool


class AiProvider(Protocol):
    def settings(self) -> Any:
        """Configuração com ``reserve_micro`` e ``cost_micro(entrada, saída)``; levanta ``AIUnavailable``."""

    def check_request(self, kind: str, context: Row, template: Row | None = None, settings: Any = None) -> None:
        """Confere limites e política antes de qualquer chamada paga; levanta ``AIProviderError``."""

    async def generate(self, kind: str, context: Row, template: Row | None) -> ProviderResult: ...

    def validate(self, kind: str, result: Row, template: Row | None = None) -> Row: ...


class CampaignActors(Protocol):
    async def actor(self, campaign_id: UUID) -> Actor: ...


class AiCampaignStore(Protocol):
    """Leituras e escritas com o token de quem pede; o RLS decide o que cada um vê."""

    async def proposal(self, campaign_id: UUID, proposal_id: UUID) -> Row | None: ...

    async def proposal_by_key(self, campaign_id: UUID, author_id: str, idempotency_key: UUID) -> Row | None: ...

    async def proposals(self, campaign_id: UUID) -> Any: ...

    async def proposal_contents(self, proposal_id: UUID, *, with_result: bool) -> Row | None: ...

    async def context_record(self, kind: ContextKind, campaign_id: UUID, record_id: UUID) -> Row | None: ...

    async def context_options(self, kind: ContextKind, campaign_id: UUID) -> list[Row]: ...

    async def target(self, kind: TargetKind, campaign_id: UUID, target_id: UUID) -> Row | None: ...

    async def entity_in_campaign(self, campaign_id: UUID | str, entity_id: UUID) -> bool: ...

    async def approved_template(self, campaign_id: UUID, template_id: UUID) -> Row: ...

    async def preparations(self, campaign_id: UUID) -> Any: ...

    async def approve(self, campaign_id: UUID, proposal_id: UUID, expected_version: int, result: Row) -> Any: ...

    async def reject(self, campaign_id: UUID, proposal_id: UUID, expected_version: int) -> Any: ...

    async def publish_preparation(self, campaign_id: UUID, preparation_id: UUID, expected_version: int, fields: Row) -> Any: ...


class AiPrivateStore(Protocol):
    """Livro do orçamento e conteúdo privado das propostas, só com a chave de serviço."""

    def is_configured(self) -> bool: ...

    async def recover_stale(self, campaign_id: UUID) -> Any: ...

    async def reserve(self, campaign_id: str, user_id: str, operation_id: str, reserve_micro: int) -> Any: ...

    async def dispatch(self, operation_id: str) -> Any: ...

    async def settle(self, operation_id: str, actual_micro: int, input_tokens: int, output_tokens: int) -> Any: ...

    async def mark_uncertain(self, operation_id: str) -> Any: ...

    async def cancel(self, operation_id: str) -> Any: ...

    async def create_request(self, row: Row) -> list[Row]: ...

    async def create_contents(self, row: Row) -> Any: ...

    async def save_contents(self, proposal_id: str, context: Row, result: Row) -> Any: ...

    async def transition_request(self, filters: dict[str, str], changes: Row) -> list[Row]:
        """Atualiza a proposta só se ela ainda bater com os filtros (id, versão, estado)."""
