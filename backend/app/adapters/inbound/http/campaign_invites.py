"""Adaptador HTTP do envio de e-mail de convite de campanha."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.adapters.inbound.http.dependencies import invite_email_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.invites.service import InviteEmailService

router = APIRouter(prefix="/api/v1/campaign-invites", tags=["campaign-invites"], route_class=DomainErrorRoute)


@router.post("/{invite_id}/email")
async def send_invite_email(invite_id: UUID, service: InviteEmailService = Depends(invite_email_service)) -> dict[str, Any]:
    return await service.send(invite_id)
