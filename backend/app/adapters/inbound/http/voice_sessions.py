"""Adaptador HTTP da sala de voz da campanha.

``GET /api/v1/voice-sessions/config`` diz se o recurso está configurado, para a interface
esconder o botão.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response

from app.adapters.inbound.http.dependencies import voice_session_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.voice.service import VoiceSessionService

router = APIRouter(prefix="/api/v1", tags=["voice-sessions"], route_class=DomainErrorRoute)
Voice = Depends(voice_session_service)


@router.get("/voice-sessions/config")
def voice_config(service: VoiceSessionService = Voice) -> dict[str, bool]:
    return service.config()


@router.post("/campaigns/{campaign_id}/voice-session")
async def create_voice_session(
    campaign_id: UUID, background_tasks: BackgroundTasks, response: Response, service: VoiceSessionService = Voice,
) -> dict[str, Any]:
    request = await service.request_room(campaign_id)
    if request.provision is not None:
        background_tasks.add_task(request.provision)
        response.status_code = 202
    return request.view
