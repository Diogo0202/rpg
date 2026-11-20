"""Adaptador HTTP do diagnóstico da crônica."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

from app.adapters.inbound.http.dependencies import chronicle_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.chronicle.analysis import AnalysisSettings
from app.application.chronicle.service import MAX_ACTIVITY_RECORDS, ActivityEntry, ChronicleService

router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}/chronicle", tags=["chronicle"], route_class=DomainErrorRoute)
Chronicle = Depends(chronicle_service)
MAX_REFERENCES = 50


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GoalCreate(_Strict):
    goal_type: Literal["ambition", "desire"]
    statement: StrictStr = Field(min_length=1, max_length=500)
    target_id: StrictStr = Field(min_length=1, max_length=80)
    target_label: StrictStr = Field(min_length=1, max_length=120)
    polarity: Literal["pursues", "prevents"]


class SupporterCreate(_Strict):
    name: StrictStr = Field(min_length=1, max_length=120)


class DefectCreate(_Strict):
    statement: StrictStr = Field(min_length=1, max_length=500)


class ActivityCreate(_Strict):
    occurred_on: date
    character_id: UUID
    used_trait_ids: list[StrictStr] = Field(default_factory=list, max_length=MAX_REFERENCES)
    used_ambition_ids: list[UUID] = Field(default_factory=list, max_length=MAX_REFERENCES)
    used_desire_ids: list[UUID] = Field(default_factory=list, max_length=MAX_REFERENCES)
    used_defect_ids: list[UUID] = Field(default_factory=list, max_length=MAX_REFERENCES)
    threatened_supporter_ids: list[UUID] = Field(default_factory=list, max_length=MAX_REFERENCES)

    @model_validator(mode="after")
    def unique_bounded_references(self) -> ActivityCreate:
        groups = (
            self.used_trait_ids,
            [*self.used_ambition_ids, *self.used_desire_ids],
            self.used_defect_ids,
            self.threatened_supporter_ids,
        )
        if any(len(group) != len(set(group)) for group in groups):
            raise ValueError("cada referência pode aparecer uma vez no registro")
        if len(self.used_ambition_ids) + len(self.used_desire_ids) > MAX_REFERENCES:
            raise ValueError("o registro pode apontar para até 50 metas")
        return self


@router.get("")
async def get_chronicle_diagnostic(
    campaign_id: UUID,
    as_of: date = Query(default_factory=date.today),
    supporter_recency_days: int = Query(default=90, ge=1, le=3650),
    min_activity_records: int = Query(default=5, ge=1, le=MAX_ACTIVITY_RECORDS),
    underused_trait_share: float = Query(default=0.05, gt=0, le=1),
    service: ChronicleService = Chronicle,
) -> dict[str, Any]:
    settings = AnalysisSettings(as_of, supporter_recency_days, min_activity_records, underused_trait_share)
    return await service.diagnostic(campaign_id, settings)


@router.post("/characters/{sheet_id}/goals", status_code=201)
async def create_chronicle_goal(
    campaign_id: UUID, sheet_id: UUID, payload: GoalCreate, service: ChronicleService = Chronicle,
) -> dict[str, Any]:
    return await service.add_goal(
        campaign_id, sheet_id, payload.goal_type, payload.statement, payload.target_id, payload.target_label, payload.polarity,
    )


@router.post("/characters/{sheet_id}/supporters", status_code=201)
async def create_chronicle_supporter(
    campaign_id: UUID, sheet_id: UUID, payload: SupporterCreate, service: ChronicleService = Chronicle,
) -> dict[str, Any]:
    return await service.add_supporter(campaign_id, sheet_id, payload.name)


@router.post("/characters/{sheet_id}/defects", status_code=201)
async def create_chronicle_defect(
    campaign_id: UUID, sheet_id: UUID, payload: DefectCreate, service: ChronicleService = Chronicle,
) -> dict[str, Any]:
    return await service.add_defect(campaign_id, sheet_id, payload.statement)


@router.post("/activity", status_code=201)
async def create_chronicle_activity(
    campaign_id: UUID, payload: ActivityCreate, service: ChronicleService = Chronicle,
) -> dict[str, Any]:
    return await service.add_activity(campaign_id, ActivityEntry(**payload.model_dump()))
