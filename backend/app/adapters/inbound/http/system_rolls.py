"""Adaptador HTTP das rolagens de Caçador, O Um Anel, Shadow of the Demon Lord e Vampiro V3."""

from __future__ import annotations

from typing import Any, TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.adapters.inbound.http.auth import require_signed_in_user
from app.adapters.inbound.http.dependencies import roll_activity_recorder, supabase_session
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.adapters.outbound.supabase.v3_sheets import SupabaseV3Sheets
from app.application.roll_activity import RollActivityRecorder
from app.application.system_rolls import RollOutcome, SystemRollService, V3SheetAction
from app.domain.system_rolls import (
    HunterRollRequest,
    HunterRollResponse,
    HunterTraitsResponse,
    JourneyEventRequest,
    JourneyEventResponse,
    OneRingRollRequest,
    OneRingRollResponse,
    OneRingShadowTestRequest,
    OneRingShadowTestResponse,
    OneRingSheetResponse,
    SheetValuesRequest,
    SotdlFateResponse,
    SotdlRollRequest,
    SotdlRollResponse,
    V3RollRequest,
    V3RollResponse,
    V3SheetResponse,
    hunter_traits,
    one_ring_sheet,
    roll_hunter,
    roll_journey_event,
    roll_one_ring,
    roll_one_ring_shadow_test,
    roll_sotdl,
    roll_sotdl_fate,
    v3_sheet,
)

CHRONICLE_ACTIVITY_HEADER = "X-Chronicle-Activity"
Result = TypeVar("Result")

router = APIRouter(
    prefix="/api/v1/system-rolls", tags=["system-rolls"], route_class=DomainErrorRoute,
    dependencies=[Depends(require_signed_in_user)],
)


def system_roll_service(
    supabase: SupabaseRest = Depends(supabase_session), activity: RollActivityRecorder = Depends(roll_activity_recorder),
) -> SystemRollService:
    return SystemRollService(activity, SupabaseV3Sheets(supabase))


Rolls = Depends(system_roll_service)


def _answer(outcome: RollOutcome[Result], response: Response) -> Result:
    if outcome.chronicle_status is not None:
        response.headers[CHRONICLE_ACTIVITY_HEADER] = outcome.chronicle_status
    return outcome.result


@router.post("/hunter", response_model=HunterRollResponse)
async def roll_hunter_action(payload: HunterRollRequest, response: Response, service: SystemRollService = Rolls) -> HunterRollResponse:
    return _answer(await service.with_chronicle(roll_hunter(payload), payload.chronicle), response)


@router.post("/hunter/traits", response_model=HunterTraitsResponse)
def hunter_traits_action(payload: SheetValuesRequest) -> HunterTraitsResponse:
    return hunter_traits(payload)


@router.post("/one-ring", response_model=OneRingRollResponse)
async def roll_one_ring_action(payload: OneRingRollRequest, response: Response, service: SystemRollService = Rolls) -> OneRingRollResponse:
    return _answer(await service.with_chronicle(roll_one_ring(payload), payload.chronicle), response)


@router.post("/one-ring/shadow-test", response_model=OneRingShadowTestResponse)
def roll_one_ring_shadow_test_action(payload: OneRingShadowTestRequest) -> OneRingShadowTestResponse:
    return roll_one_ring_shadow_test(payload)


@router.post("/one-ring/journey-event", response_model=JourneyEventResponse)
def roll_journey_event_action(payload: JourneyEventRequest) -> JourneyEventResponse:
    return roll_journey_event(payload)


@router.post("/one-ring/sheet", response_model=OneRingSheetResponse)
def one_ring_sheet_action(payload: SheetValuesRequest) -> OneRingSheetResponse:
    return one_ring_sheet(payload)


@router.post("/shadow-demon-lord", response_model=SotdlRollResponse)
async def roll_sotdl_action(payload: SotdlRollRequest, response: Response, service: SystemRollService = Rolls) -> SotdlRollResponse:
    return _answer(await service.with_chronicle(roll_sotdl(payload), payload.chronicle), response)


@router.post("/shadow-demon-lord/fate", response_model=SotdlFateResponse)
def roll_sotdl_fate_action() -> SotdlFateResponse:
    return roll_sotdl_fate()


# Vampiro V3 (frente F3): regras em app/services/v3_vampire.py; mudanças da ficha nas RPCs v3_*.


@router.post("/vampire-v3", response_model=V3RollResponse)
async def roll_vampire_v3_action(payload: V3RollRequest, response: Response, service: SystemRollService = Rolls) -> V3RollResponse:
    return _answer(await service.roll_v3(payload), response)


@router.post("/vampire-v3/sheet", response_model=V3SheetResponse)
def vampire_v3_sheet_action(payload: SheetValuesRequest) -> V3SheetResponse:
    """Números derivados (sangue, nível de vitalidade) e, com migrate, a ficha sem o tipo de predador antigo."""
    return v3_sheet(dict(payload.values), payload.migrate)


@router.post("/vampire-v3/sheets/{sheet_id}/actions")
async def vampire_v3_sheet_action_rpc(sheet_id: UUID, payload: V3SheetAction, service: SystemRollService = Rolls) -> Any:
    return await service.v3_action(sheet_id, payload)


@router.get("/vampire-v3/sheets/{sheet_id}/state")
@router.post("/vampire-v3/sheets/{sheet_id}/state")
async def vampire_v3_life_state(sheet_id: UUID, service: SystemRollService = Rolls) -> Any:
    return await service.v3_life_state(sheet_id)
