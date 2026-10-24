from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from app.services import marketplace


router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])


class VoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: StrictInt = Field(ge=-1, le=1)


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: StrictStr = Field(min_length=10, max_length=2000)


class CloneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    campaign_id: UUID
    idempotency_key: StrictStr = Field(min_length=8, max_length=100)


class ResolveReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["restore", "remove"]
    note: StrictStr | None = Field(default=None, max_length=2000)


def _card(row: dict[str, Any], *, detail: bool = False) -> dict[str, Any]:
    result = {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "tags": row["tags"],
        "author_name": row["author_name"],
        "automation_level": row["automation_level"],
        "dependencies": row["dependencies"],
        "updated_at": row["updated_at"],
        "usage_count": row["usage_count"],
        "likes": row["likes"],
        "dislikes": row["dislikes"],
    }
    if detail:
        result["template"] = row["template"]
    return result


@router.get("/systems")
async def list_systems(
    q: str | None = Query(default=None, max_length=120),
    tags: list[str] = Query(default=[] , max_length=20),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, Any]:
    if any(not tag.strip() or len(tag) > 40 for tag in tags):
        raise HTTPException(status_code=422, detail="tag inválida")
    rows = await marketplace.request_public(
        "POST", "rpc/marketplace_search",
        payload={"p_q": q.strip() if q and q.strip() else None, "p_tags": [tag.strip() for tag in tags], "p_page": page, "p_limit": limit},
    )
    return {"items": [_card(row) for row in rows], "page": page, "limit": limit}


@router.get("/systems/{system_id}")
async def get_system(system_id: UUID) -> dict[str, Any]:
    rows = await marketplace.request_public(
        "GET", "marketplace_systems",
        params={"select": "id,name,description,tags,author_name,automation_level,dependencies,updated_at,usage_count,likes,dislikes,template", "id": f"eq.{system_id}", "status": "eq.published", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="sistema não encontrado")
    return _card(rows[0], detail=True)


@router.post("/systems")
async def publish_system(payload: marketplace.PublishRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    owner_id = await marketplace.current_user_id(authorization)
    record = marketplace.validate_publication(payload)
    published = await marketplace.publish_as_service(owner_id, record)
    return _card(published, detail=True)


@router.post("/systems/{system_id}/vote")
async def vote_system(system_id: UUID, payload: VoteRequest, authorization: str | None = Header(default=None)) -> dict[str, bool]:
    if payload.value not in {-1, 1}:
        raise HTTPException(status_code=422, detail="vote deve ser 1 ou -1")
    await marketplace.current_user_id(authorization)
    await marketplace.request_user("POST", "rpc/marketplace_vote", authorization, payload={"p_system_id": str(system_id), "p_value": payload.value})
    return {"ok": True}


@router.post("/systems/{system_id}/report")
async def report_system(system_id: UUID, payload: ReportRequest, authorization: str | None = Header(default=None)) -> dict[str, bool]:
    await marketplace.current_user_id(authorization)
    await marketplace.request_user(
        "POST", "rpc/marketplace_report", authorization,
        payload={"p_system_id": str(system_id), "p_reason": payload.reason.strip()},
    )
    return {"ok": True}


@router.post("/systems/{system_id}/clone")
async def clone_system(system_id: UUID, payload: CloneRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    result = await marketplace.request_user(
        "POST", "rpc/marketplace_clone", authorization,
        payload={"p_system_id": str(system_id), "p_campaign_id": str(payload.campaign_id), "p_idempotency_key": payload.idempotency_key},
    )
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="resposta inválida ao copiar o sistema")
    return result


@router.get("/moderation/reports")
async def list_moderation_reports(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    reports = await marketplace.request_user(
        "POST", "rpc/marketplace_list_reports", authorization,
        payload={"p_page": page, "p_limit": limit},
    )
    return {"items": reports, "page": page, "limit": limit}


@router.post("/moderation/reports/{report_id}/resolve")
async def resolve_moderation_report(
    report_id: UUID,
    payload: ResolveReportRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, bool]:
    await marketplace.current_user_id(authorization)
    await marketplace.request_user(
        "POST", "rpc/marketplace_resolve_report", authorization,
        payload={"p_report_id": str(report_id), "p_action": payload.action, "p_resolution_note": payload.note},
    )
    return {"ok": True}
