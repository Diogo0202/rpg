"""Adaptador HTTP da prévia e da rolagem com modificadores."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from app.adapters.inbound.http.auth import require_signed_in_user
from app.adapters.inbound.http.dependencies import roll_activity_recorder
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.modifiers import ModifierRollRequest, ModifierRollResult, ModifierRollService
from app.application.roll_activity import RollActivityRecorder
from app.domain.modifiers import ModifierPreview, ModifierRequest, preview_modifiers

CHRONICLE_ACTIVITY_HEADER = "X-Chronicle-Activity"

router = APIRouter(
    prefix="/api/v1/modifiers", tags=["modifiers"], route_class=DomainErrorRoute,
    dependencies=[Depends(require_signed_in_user)],
)


def modifier_roll_service(activity: RollActivityRecorder = Depends(roll_activity_recorder)) -> ModifierRollService:
    return ModifierRollService(activity)


@router.post("/preview", response_model=ModifierPreview)
def get_preview(payload: ModifierRequest) -> ModifierPreview:
    return preview_modifiers(payload)


@router.post("/roll", response_model=ModifierRollResult)
async def roll_adjusted_pool(
    payload: ModifierRollRequest, response: Response, service: ModifierRollService = Depends(modifier_roll_service),
) -> ModifierRollResult:
    outcome = await service.roll(payload)
    if outcome.chronicle_status is not None:
        response.headers[CHRONICLE_ACTIVITY_HEADER] = outcome.chronicle_status
    return outcome.result
