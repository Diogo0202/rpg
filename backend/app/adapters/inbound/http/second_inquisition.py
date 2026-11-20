"""Adaptador HTTP da Segunda Inquisição (Vampiro V5)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator, model_validator

from app.adapters.inbound.http.dependencies import supabase_session
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.supabase.content_applications import SupabaseContentApplications
from app.adapters.outbound.supabase.inquisition_store import SupabaseInquisitionStore
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.second_inquisition import ResponseOrder, SecondInquisitionService
from app.domain.second_inquisition import EventKind, ResponseKind

router = APIRouter(
    prefix="/api/v1/campaigns/{campaign_id}/second-inquisition", tags=["second-inquisition"], route_class=DomainErrorRoute,
)


def inquisition_service(supabase: SupabaseRest = Depends(supabase_session)) -> SecondInquisitionService:
    return SecondInquisitionService(supabase, SupabaseInquisitionStore(supabase), SupabaseContentApplications(supabase))


Inquisition = Depends(inquisition_service)


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_kind: EventKind
    occurred_at: datetime
    area_id: StrictStr = Field(min_length=1, max_length=100)

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("occurred_at precisa informar o fuso horário")
        return value

    @field_validator("area_id")
    @classmethod
    def clean_area_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("informe uma área")
        return value


class ResponseApply(BaseModel):
    model_config = ConfigDict(extra="forbid")

    save_entity: StrictBool = True
    combat_id: UUID | None = None
    idempotency_key: UUID

    @model_validator(mode="after")
    def coherent_target(self) -> ResponseApply:
        if not self.save_entity and self.combat_id is None:
            raise ValueError("escolha salvar no mundo, inserir no combate ou ambos")
        return self


@router.get("")
async def get_campaign_assessment(campaign_id: UUID, service: SecondInquisitionService = Inquisition) -> dict[str, Any]:
    return await service.assessment(campaign_id)


@router.post("", status_code=201)
async def confirm_campaign_event(campaign_id: UUID, payload: EventCreate, service: SecondInquisitionService = Inquisition) -> dict[str, Any]:
    return await service.confirm(campaign_id, payload.event_kind, payload.area_id, payload.occurred_at)


@router.post("/responses/{response_kind}/apply", status_code=201)
async def apply_assessment_response(
    campaign_id: UUID, response_kind: ResponseKind, payload: ResponseApply, service: SecondInquisitionService = Inquisition,
) -> dict[str, Any]:
    order = ResponseOrder(payload.save_entity, payload.combat_id, payload.idempotency_key)
    return await service.apply_response(campaign_id, response_kind, order)


@router.delete("/{event_id}", status_code=204)
async def revoke_campaign_event(
    campaign_id: UUID, event_id: UUID, expected_version: int = Query(ge=1), service: SecondInquisitionService = Inquisition,
) -> None:
    await service.revoke(campaign_id, event_id, expected_version)
