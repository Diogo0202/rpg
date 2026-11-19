"""Adaptador HTTP da sincronização mobile."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request

from app.adapters.inbound.http.dependencies import mobile_sync_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.mobile_sync.service import MobileSyncService
from app.domain.errors import Unauthenticated
from app.services.mobile_sync import ENTITY_FIELDS, MAX_PAGE_SIZE, MAX_SAFE_INTEGER, SyncPushRequest

__all__ = ["ENTITY_FIELDS", "router"]

router = APIRouter(prefix="/api/v1", tags=["mobile-sync"], route_class=DomainErrorRoute)
Sync = Depends(mobile_sync_service)


def verified_user_id(request: Request, authorization: str | None = Header(default=None)) -> str:
    """Exige o usuário verificado pelo ``ApiSecurityMiddleware``, além do token."""
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise Unauthenticated("sessão necessária")
    user = getattr(request.state, "supabase_user", None)
    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        raise Unauthenticated("sessão verificada necessária")
    try:
        return str(UUID(user["id"]))
    except (TypeError, ValueError) as error:
        raise Unauthenticated("sessão verificada necessária") from error


VerifiedUser = Depends(verified_user_id)


@router.get("/sync/campaigns")
async def list_sync_campaigns(_: str = VerifiedUser, service: MobileSyncService = Sync) -> dict[str, Any]:
    return await service.campaigns()


@router.get("/campaigns/{campaign_id}/sync/capabilities")
async def get_sync_capabilities(campaign_id: UUID, user_id: str = VerifiedUser, service: MobileSyncService = Sync) -> dict[str, Any]:
    return await service.capabilities(campaign_id, user_id)


@router.post("/campaigns/{campaign_id}/sync/push")
async def push_sync(
    campaign_id: UUID, payload: SyncPushRequest, _: str = VerifiedUser, service: MobileSyncService = Sync,
) -> dict[str, Any]:
    return await service.push(campaign_id, payload.device_id, payload.mutations)


@router.get("/campaigns/{campaign_id}/sync/snapshot")
async def get_sync_snapshot(
    campaign_id: UUID,
    entity_type: str = Query(min_length=1, max_length=64),
    after_id: UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=MAX_PAGE_SIZE),
    _: str = VerifiedUser,
    service: MobileSyncService = Sync,
) -> dict[str, Any]:
    return await service.snapshot(campaign_id, entity_type, after_id, limit)


@router.get("/campaigns/{campaign_id}/sync/changes")
async def get_sync_changes(
    campaign_id: UUID,
    cursor: int = Query(ge=0, le=MAX_SAFE_INTEGER),
    limit: int = Query(default=100, ge=1, le=MAX_PAGE_SIZE),
    _: str = VerifiedUser,
    service: MobileSyncService = Sync,
) -> dict[str, Any]:
    return await service.changes(campaign_id, cursor, limit)
