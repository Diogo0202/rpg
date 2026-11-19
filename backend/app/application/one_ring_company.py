"""Estado e comandos da Companhia de O Um Anel; o banco confere permissão e versão de forma atômica."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

from app.domain.one_ring_company import validated_command_payload


@dataclass(frozen=True)
class CompanyOrder:
    operation_id: UUID
    expected_version: int
    kind: str
    payload: dict[str, Any]


class CompanyStore(Protocol):
    async def snapshot(self, campaign_id: UUID) -> Any: ...

    async def run(self, campaign_id: UUID, order: CompanyOrder) -> Any: ...


class OneRingCompanyService:
    def __init__(self, store: CompanyStore) -> None:
        self._store = store

    async def snapshot(self, campaign_id: UUID) -> Any:
        return await self._store.snapshot(campaign_id)

    async def run(self, campaign_id: UUID, order: CompanyOrder) -> Any:
        checked = CompanyOrder(order.operation_id, order.expected_version, order.kind, validated_command_payload(order.kind, order.payload))
        return await self._store.run(campaign_id, checked)
