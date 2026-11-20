"""Adaptador HTTP da compra de avanços com XP."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr

from app.adapters.inbound.http.dependencies import experience_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.experience.ports import AdvanceOrder, AdvanceQuote, Row
from app.application.experience.service import ExperienceService

router = APIRouter(prefix="/api/v1", tags=["experience"], route_class=DomainErrorRoute)
TRAIT_PATTERN = r"^[a-z][a-z0-9_]{1,63}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdvanceQuoteRequest(_Strict):
    trait: StrictStr = Field(pattern=TRAIT_PATTERN)
    target_level: int = Field(ge=1, le=20)
    item_name: StrictStr | None = Field(default=None, min_length=1, max_length=120)

    def to_quote(self) -> AdvanceQuote:
        return AdvanceQuote(self.trait, self.target_level, self.item_name)


class AdvancePurchase(AdvanceQuoteRequest):
    expected_version: int = Field(ge=1)
    operation_id: UUID
    reason: StrictStr | None = Field(default=None, max_length=200)

    def to_order(self) -> AdvanceOrder:
        return AdvanceOrder(self.to_quote(), self.expected_version, self.operation_id, self.reason)


class AdvanceReview(_Strict):
    approve: StrictBool
    note: StrictStr | None = Field(default=None, max_length=200)


class AdvanceRefund(_Strict):
    note: StrictStr | None = Field(default=None, max_length=200)


class ExperienceSettings(_Strict):
    requires_approval: StrictBool


Service = Depends(experience_service)


@router.post("/sheets/{sheet_id}/advances/quote")
async def quote_advance(sheet_id: UUID, payload: AdvanceQuoteRequest, service: ExperienceService = Service) -> Row:
    return await service.quote(sheet_id, payload.to_quote())


@router.post("/sheets/{sheet_id}/advances")
async def purchase_advance(sheet_id: UUID, payload: AdvancePurchase, service: ExperienceService = Service) -> Row:
    return await service.purchase(sheet_id, payload.to_order())


@router.get("/sheets/{sheet_id}/advances")
async def list_advances(
    sheet_id: UUID, limit: int = Query(default=50, ge=1, le=200), service: ExperienceService = Service,
) -> list[Row]:
    return await service.history(sheet_id, limit)


@router.post("/advances/{advance_id}/review")
async def review_advance(advance_id: UUID, payload: AdvanceReview, service: ExperienceService = Service) -> Row:
    return await service.review(advance_id, payload.approve, payload.note)


@router.post("/advances/{advance_id}/refund")
async def refund_advance(advance_id: UUID, payload: AdvanceRefund, service: ExperienceService = Service) -> Row:
    return await service.refund(advance_id, payload.note)


@router.get("/campaigns/{campaign_id}/experience-settings")
async def get_experience_settings(campaign_id: UUID, service: ExperienceService = Service) -> dict[str, Any]:
    return await service.policy(campaign_id)


@router.post("/campaigns/{campaign_id}/experience-settings")
async def put_experience_settings(
    campaign_id: UUID, payload: ExperienceSettings, service: ExperienceService = Service,
) -> dict[str, Any]:
    return await service.change_policy(campaign_id, payload.requires_approval)
