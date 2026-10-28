"""EXP-02: compra de avanço com XP.

A API só repassa o pedido às RPCs do Supabase. O custo é recalculado no banco
(public.purchase_advance) a partir do modelo aprovado da ficha; o cliente nunca
informa o valor a debitar.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr

from app.routes import sheets


router = APIRouter(prefix="/api/v1", tags=["experience"])
_TRAIT = r"^[a-z][a-z0-9_]{1,63}$"

_ADVANCE_ERRORS = {
    "42501": (403, "operação não permitida nesta ficha"),
    "40001": (409, "a ficha mudou desde a prévia; recarregue e confira o custo de novo"),
    "23505": (409, "ID da operação já foi usado para outra compra"),
    "22023": (422, "este avanço não é válido para esta ficha"),
    "23514": (422, "o traço sairia do limite permitido"),
    "XP001": (422, "XP insuficiente para este avanço"),
    "P0002": (404, "avanço não encontrado"),
}


class AdvanceQuoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trait: StrictStr = Field(pattern=_TRAIT)
    target_level: int = Field(ge=1, le=20)
    item_name: StrictStr | None = Field(default=None, min_length=1, max_length=120)


class AdvancePurchase(AdvanceQuoteRequest):
    expected_version: int = Field(ge=1)
    operation_id: UUID
    reason: StrictStr | None = Field(default=None, max_length=200)


class AdvanceReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approve: StrictBool
    note: StrictStr | None = Field(default=None, max_length=200)


class AdvanceRefund(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: StrictStr | None = Field(default=None, max_length=200)


class ExperienceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requires_approval: StrictBool


async def _advance_rpc(name: str, authorization: str | None, payload: dict[str, Any]) -> Any:
    """Like sheets._rpc, with messages for the advance error codes."""
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="sessão necessária")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                f"{supabase_url.rstrip('/')}/rest/v1/rpc/{name}",
                headers={"apikey": supabase_key, "Authorization": authorization, "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="sessão inválida")
    if response.status_code >= 400:
        try:
            code = response.json().get("code")
        except (ValueError, AttributeError):
            code = None
        status, detail = _ADVANCE_ERRORS.get(code, (403, "operação não permitida nesta campanha"))
        raise HTTPException(status_code=status, detail=detail)
    return response.json()


@router.post("/sheets/{sheet_id}/advances/quote")
async def quote_advance(
    sheet_id: UUID, payload: AdvanceQuoteRequest, authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Server-side cost preview, shown before the player confirms."""
    await sheets._current_user_id(authorization)
    return await _advance_rpc("quote_advance", authorization, {
        "p_sheet_id": str(sheet_id), "p_trait": payload.trait, "p_target_level": payload.target_level,
        "p_item_name": payload.item_name,
    })


@router.post("/sheets/{sheet_id}/advances")
async def purchase_advance(
    sheet_id: UUID, payload: AdvancePurchase, authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Atomic purchase: the database recomputes the cost, debits XP and raises the trait."""
    await sheets._current_user_id(authorization)
    return await _advance_rpc("purchase_advance", authorization, {
        "p_sheet_id": str(sheet_id), "p_trait": payload.trait, "p_target_level": payload.target_level,
        "p_expected_version": payload.expected_version, "p_operation_id": str(payload.operation_id),
        "p_item_name": payload.item_name, "p_reason": payload.reason,
    })


@router.get("/sheets/{sheet_id}/advances")
async def list_advances(
    sheet_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    await sheets._current_user_id(authorization)
    return await sheets._request("GET", "character_advances", authorization, params={
        "select": "id,sheet_id,actor_id,system_key,trait,category,item_name,item_value,from_level,to_level,cost,status,"
                  "xp_before,xp_after,sheet_version,reason,reviewed_by,reviewed_at,review_note,created_at",
        "sheet_id": f"eq.{sheet_id}",
        "order": "created_at.desc",
        "limit": str(limit),
    })


@router.post("/advances/{advance_id}/review")
async def review_advance(
    advance_id: UUID, payload: AdvanceReview, authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Narrator approves or rejects a pending purchase; the player may cancel their own."""
    await sheets._current_user_id(authorization)
    return await _advance_rpc("review_advance", authorization, {
        "p_advance_id": str(advance_id), "p_approve": payload.approve, "p_note": payload.note,
    })


@router.post("/advances/{advance_id}/refund")
async def refund_advance(
    advance_id: UUID, payload: AdvanceRefund, authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await sheets._current_user_id(authorization)
    return await _advance_rpc("refund_advance", authorization, {"p_advance_id": str(advance_id), "p_note": payload.note})


@router.get("/campaigns/{campaign_id}/experience-settings")
async def get_experience_settings(campaign_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await sheets._current_user_id(authorization)
    rows = await sheets._request("GET", "campaign_experience_settings", authorization, params={
        "select": "campaign_id,requires_approval,updated_at", "campaign_id": f"eq.{campaign_id}",
    })
    if rows:
        return rows[0]
    return {"campaign_id": str(campaign_id), "requires_approval": False, "updated_at": None}


@router.post("/campaigns/{campaign_id}/experience-settings")
async def put_experience_settings(
    campaign_id: UUID, payload: ExperienceSettings, authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Narrator-only (RLS): purchases by players then wait for approval."""
    user_id = await sheets._current_user_id(authorization)
    rows = await _upsert_settings(campaign_id, payload, user_id, authorization)
    if not rows:
        raise HTTPException(status_code=403, detail="só o narrador altera a política de XP")
    return rows[0]


async def _upsert_settings(campaign_id: UUID, payload: ExperienceSettings, user_id: str, authorization: str | None) -> Any:
    """sheets._request has no upsert, so update first and insert when nothing matched."""
    body = {"requires_approval": payload.requires_approval, "updated_by": user_id,
            "updated_at": datetime.now(timezone.utc).isoformat()}
    updated = await sheets._request("PATCH", "campaign_experience_settings", authorization,
                                    params={"campaign_id": f"eq.{campaign_id}"}, payload=body)
    if updated:
        return updated
    return await sheets._request("POST", "campaign_experience_settings", authorization,
                                 payload={"campaign_id": str(campaign_id), **body})
