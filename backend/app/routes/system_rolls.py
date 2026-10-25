from __future__ import annotations

from fastapi import APIRouter, Depends

from app.routes.generators import require_signed_in_user
from app.services.system_rolls import (
    HunterRollRequest,
    HunterRollResponse,
    OneRingRollRequest,
    OneRingRollResponse,
    SotdlFateResponse,
    SotdlRollRequest,
    SotdlRollResponse,
    roll_hunter,
    roll_one_ring,
    roll_sotdl,
    roll_sotdl_fate,
)


router = APIRouter(prefix="/api/v1/system-rolls", tags=["system-rolls"])


@router.post("/hunter", response_model=HunterRollResponse)
def roll_hunter_action(
    payload: HunterRollRequest,
    _: None = Depends(require_signed_in_user),
) -> HunterRollResponse:
    return roll_hunter(payload)


@router.post("/one-ring", response_model=OneRingRollResponse)
def roll_one_ring_action(
    payload: OneRingRollRequest,
    _: None = Depends(require_signed_in_user),
) -> OneRingRollResponse:
    return roll_one_ring(payload)


@router.post("/shadow-demon-lord", response_model=SotdlRollResponse)
def roll_sotdl_action(
    payload: SotdlRollRequest,
    _: None = Depends(require_signed_in_user),
) -> SotdlRollResponse:
    return roll_sotdl(payload)


@router.post("/shadow-demon-lord/fate", response_model=SotdlFateResponse)
def roll_sotdl_fate_action(
    _: None = Depends(require_signed_in_user),
) -> SotdlFateResponse:
    return roll_sotdl_fate()
