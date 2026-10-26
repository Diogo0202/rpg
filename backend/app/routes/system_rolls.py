from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Response

from app.routes.generators import require_signed_in_user
from app.services.session_roll_activity import RollChronicleContext, record_from_context
from app.services.system_rolls import (
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
    hunter_traits,
    one_ring_sheet,
    roll_hunter,
    roll_journey_event,
    roll_one_ring,
    roll_one_ring_shadow_test,
    roll_sotdl,
    roll_sotdl_fate,
)


router = APIRouter(prefix="/api/v1/system-rolls", tags=["system-rolls"])


async def _record_chronicle(authorization: str | None, context: RollChronicleContext | None, response: Response) -> None:
    """DRA-05: optional chronicle activity; the roll body never changes, only a header reports the status."""
    activity = await record_from_context(authorization, context)
    if activity is not None:
        response.headers["X-Chronicle-Activity"] = activity.status


@router.post("/hunter", response_model=HunterRollResponse)
async def roll_hunter_action(
    payload: HunterRollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> HunterRollResponse:
    result = roll_hunter(payload)
    await _record_chronicle(authorization, payload.chronicle, response)
    return result


@router.post("/hunter/traits", response_model=HunterTraitsResponse)
def hunter_traits_action(
    payload: SheetValuesRequest,
    _: None = Depends(require_signed_in_user),
) -> HunterTraitsResponse:
    return hunter_traits(payload)


@router.post("/one-ring", response_model=OneRingRollResponse)
async def roll_one_ring_action(
    payload: OneRingRollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> OneRingRollResponse:
    result = roll_one_ring(payload)
    await _record_chronicle(authorization, payload.chronicle, response)
    return result


@router.post("/one-ring/shadow-test", response_model=OneRingShadowTestResponse)
def roll_one_ring_shadow_test_action(
    payload: OneRingShadowTestRequest,
    _: None = Depends(require_signed_in_user),
) -> OneRingShadowTestResponse:
    return roll_one_ring_shadow_test(payload)


@router.post("/one-ring/journey-event", response_model=JourneyEventResponse)
def roll_journey_event_action(
    payload: JourneyEventRequest,
    _: None = Depends(require_signed_in_user),
) -> JourneyEventResponse:
    return roll_journey_event(payload)


@router.post("/one-ring/sheet", response_model=OneRingSheetResponse)
def one_ring_sheet_action(
    payload: SheetValuesRequest,
    _: None = Depends(require_signed_in_user),
) -> OneRingSheetResponse:
    return one_ring_sheet(payload)


@router.post("/shadow-demon-lord", response_model=SotdlRollResponse)
async def roll_sotdl_action(
    payload: SotdlRollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> SotdlRollResponse:
    result = roll_sotdl(payload)
    await _record_chronicle(authorization, payload.chronicle, response)
    return result


@router.post("/shadow-demon-lord/fate", response_model=SotdlFateResponse)
def roll_sotdl_fate_action(
    _: None = Depends(require_signed_in_user),
) -> SotdlFateResponse:
    return roll_sotdl_fate()
