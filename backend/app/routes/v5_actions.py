from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.routes.generators import require_signed_in_user
from app.services.v5_actions import V5ActionRollRequest, V5ActionRollResponse, roll_v5_action


router = APIRouter(prefix="/api/v1/v5", tags=["vampire-v5-actions"])


@router.post("/roll", response_model=V5ActionRollResponse)
def roll_action(
    payload: V5ActionRollRequest,
    _: None = Depends(require_signed_in_user),
) -> V5ActionRollResponse:
    try:
        return roll_v5_action(payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
