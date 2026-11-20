"""Implementação de ``CompanyStore`` sobre as RPCs da Companhia de O Um Anel."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.errors import RpcErrors
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.one_ring_company import CompanyOrder
from app.domain.errors import Conflict, Forbidden, InvalidInput, NotFound, ServiceUnavailable

COMPANY_ERRORS = RpcErrors(
    by_code={
        "42501": (Forbidden, "operação não permitida nesta campanha"),
        "40001": (Conflict, "a companhia mudou; recarregue e tente de novo"),
        "23505": (Conflict, "ID de operação já usado com outro pedido"),
        "22023": (InvalidInput, "comando inválido para esta companhia"),
        "23514": (InvalidInput, "saldo ou foco inválido para esta companhia"),
        "P0002": (NotFound, "campanha ou sessão não encontrada"),
    },
    by_status={},
    otherwise=(ServiceUnavailable, "não foi possível concluir a operação no Supabase"),
)


class SupabaseCompanyStore:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def snapshot(self, campaign_id: UUID) -> Any:
        return await self._rest.rpc("one_ring_company_snapshot", {"p_campaign_id": str(campaign_id)}, errors=COMPANY_ERRORS)

    async def run(self, campaign_id: UUID, order: CompanyOrder) -> Any:
        return await self._rest.rpc("one_ring_company_command", {
            "p_campaign_id": str(campaign_id), "p_operation_id": str(order.operation_id),
            "p_expected_version": order.expected_version, "p_kind": order.kind, "p_payload": order.payload,
        }, errors=COMPANY_ERRORS)
