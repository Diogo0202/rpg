"""Adaptador HTTP do Caçador: A Revanche na mesa."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from app.adapters.inbound.http.auth import require_signed_in_user
from app.adapters.inbound.http.dependencies import roll_activity_recorder, supabase_session
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.supabase.hunter_table import SupabaseHunterTable
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.hunter import HunterRollOrder, HunterService
from app.domain.roll_activity import RollChronicleContext
from app.application.roll_activity import RollActivityRecorder

CHRONICLE_ACTIVITY_HEADER = "X-Chronicle-Activity"

router = APIRouter(
    prefix="/api/v1/hunter", tags=["hunter"], route_class=DomainErrorRoute, dependencies=[Depends(require_signed_in_user)],
)


def hunter_service(
    supabase: SupabaseRest = Depends(supabase_session), activity: RollActivityRecorder = Depends(roll_activity_recorder),
) -> HunterService:
    return HunterService(SupabaseHunterTable(supabase), activity)


Hunter = Depends(hunter_service)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HunterSheetRollRequest(_Strict):
    base_pool: StrictInt = Field(ge=1, le=30)
    difficulty: StrictInt = Field(ge=1, le=69)
    use_desperation: StrictBool = False
    edge: StrictStr | None = Field(default=None, min_length=1, max_length=80)
    chronicle: RollChronicleContext | None = None


class HunterRerollRequest(_Strict):
    indices: list[StrictInt] = Field(min_length=1, max_length=3)


class HunterResolveRequest(_Strict):
    choice: Literal["overreach", "despair"]


class HunterCellAdjustRequest(_Strict):
    operation_id: UUID
    danger_delta: StrictInt = Field(default=0, ge=-5, le=5)
    desperation_delta: StrictInt = Field(default=0, ge=-5, le=5)
    reason: StrictStr | None = Field(default=None, max_length=500)


class HunterRedemptionRequest(_Strict):
    note: StrictStr = Field(default="", max_length=500)


class HunterRedemptionDecision(_Strict):
    approve: StrictBool
    note: StrictStr = Field(default="", max_length=500)


@router.post("/sheets/{sheet_id}/rolls")
async def roll_for_sheet(sheet_id: UUID, payload: HunterSheetRollRequest, response: Response, service: HunterService = Hunter) -> dict[str, Any]:
    outcome = await service.roll(HunterRollOrder(
        sheet_id, payload.base_pool, payload.difficulty, payload.use_desperation, payload.edge, payload.chronicle,
    ))
    if outcome.chronicle_status is not None:
        response.headers[CHRONICLE_ACTIVITY_HEADER] = outcome.chronicle_status
    return outcome.result


@router.post("/rolls/{roll_id}/reroll")
async def reroll(roll_id: UUID, payload: HunterRerollRequest, service: HunterService = Hunter) -> dict[str, Any]:
    return await service.reroll(roll_id, payload.indices)


@router.post("/rolls/{roll_id}/resolve")
async def resolve(roll_id: UUID, payload: HunterResolveRequest, service: HunterService = Hunter) -> dict[str, Any]:
    return await service.resolve(roll_id, payload.choice)


@router.get("/sheets/{sheet_id}/state")
async def sheet_state(sheet_id: UUID, service: HunterService = Hunter) -> dict[str, Any]:
    return await service.sheet_state(sheet_id)


@router.post("/cells/{cell_id}/adjust")
async def adjust_cell(cell_id: UUID, payload: HunterCellAdjustRequest, service: HunterService = Hunter) -> dict[str, Any]:
    return await service.adjust_cell(cell_id, payload.operation_id, payload.danger_delta, payload.desperation_delta, payload.reason)


@router.post("/sheets/{sheet_id}/redemption")
async def request_redemption(sheet_id: UUID, payload: HunterRedemptionRequest, service: HunterService = Hunter) -> dict[str, Any]:
    return await service.request_redemption(sheet_id, payload.note)


@router.post("/redemptions/{redemption_id}/decision")
async def decide_redemption(redemption_id: UUID, payload: HunterRedemptionDecision, service: HunterService = Hunter) -> dict[str, Any]:
    return await service.decide_redemption(redemption_id, payload.approve, payload.note)
