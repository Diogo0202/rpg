"""Adaptador HTTP do estado da Companhia de O Um Anel na campanha."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.adapters.inbound.http.dependencies import supabase_session
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.supabase.company_store import SupabaseCompanyStore
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.one_ring_company import CompanyOrder, OneRingCompanyService
from app.domain.one_ring_company import validated_command_payload

router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}/one-ring/company", tags=["one-ring-company"], route_class=DomainErrorRoute)


class CompanyCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    expected_version: StrictInt = Field(ge=0)
    kind: Literal["create", "configure", "add_member", "remove_member", "set_focus", "spend", "restore", "reset_session"]
    payload: dict[str, Any] = Field(max_length=20)

    def validated_payload(self) -> dict[str, Any]:
        return validated_command_payload(self.kind, self.payload)

    def order(self) -> CompanyOrder:
        return CompanyOrder(self.operation_id, self.expected_version, self.kind, self.payload)


def company_service(supabase: SupabaseRest = Depends(supabase_session)) -> OneRingCompanyService:
    return OneRingCompanyService(SupabaseCompanyStore(supabase))


Company = Depends(company_service)


@router.get("")
async def get_company(campaign_id: UUID, service: OneRingCompanyService = Company) -> dict[str, Any]:
    return await service.snapshot(campaign_id)


@router.post("/commands")
async def company_command(campaign_id: UUID, command: CompanyCommand, service: OneRingCompanyService = Company) -> dict[str, Any]:
    return await service.run(campaign_id, command.order())
