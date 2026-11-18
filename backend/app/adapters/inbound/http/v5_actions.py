"""Adaptador HTTP das ações V5: rolagem com dados do servidor e ataque sobre rolagem guardada."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.adapters.inbound.http.dependencies import v5_action_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.inbound.http.v5 import CHRONICLE_ACTIVITY_HEADER
from app.application.v5.actions import V5ActionService
from app.routes.generators import require_signed_in_user
from app.services.v5_actions import StoredAttackRequest, StoredAttackResponse, V5ActionRollRequest, V5ActionRollResponse

router = APIRouter(
    prefix="/api/v1/v5", tags=["vampire-v5-actions"], route_class=DomainErrorRoute,
    dependencies=[Depends(require_signed_in_user)],
)
Actions = Depends(v5_action_service)


@router.post("/roll", response_model=V5ActionRollResponse)
async def roll_action(payload: V5ActionRollRequest, response: Response, service: V5ActionService = Actions) -> V5ActionRollResponse:
    outcome = await service.roll(payload)
    if outcome.chronicle_status is not None:
        response.headers[CHRONICLE_ACTIVITY_HEADER] = outcome.chronicle_status
    return outcome.result


@router.post("/rolls/{roll_id}/attack", response_model=StoredAttackResponse)
async def stored_roll_attack(
    roll_id: UUID, payload: StoredAttackRequest | None = None, service: V5ActionService = Actions,
) -> StoredAttackResponse:
    request = payload or StoredAttackRequest()
    return await service.stored_attack(roll_id, request.use_equipped_weapon)
