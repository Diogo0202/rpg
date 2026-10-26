from __future__ import annotations

import os
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import ValidationError

from app.routes.generators import require_signed_in_user
from app.routes.sheets import _request as _supabase_request
from app.services.session_roll_activity import record_from_context
from app.services.v5_actions import (
    AttackContext,
    EquippedWeapon,
    StoredAttackRequest,
    StoredAttackResponse,
    V5ActionRollRequest,
    V5ActionRollResponse,
    resolve_stored_attack,
    roll_v5_action,
)


router = APIRouter(prefix="/api/v1/v5", tags=["vampire-v5-actions"])


async def load_equipped_weapon(attack: AttackContext, authorization: str | None) -> EquippedWeapon | None:
    """Read the equipped weapon with the caller's own token, so sheet RLS decides access."""
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    params = {
        "select": "id,name,damage_bonus,damage_type",
        "sheet_id": f"eq.{attack.sheet_id}",
        "campaign_id": f"eq.{attack.campaign_id}",
        "category": "eq.weapon",
        "equipped": "is.true",
        "acquired": "is.true",
        "limit": "2",
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{supabase_url.rstrip('/')}/rest/v1/character_inventory",
                headers={"apikey": supabase_key, "Authorization": authorization, "Accept": "application/json"},
                params=params,
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="ficha não acessível")
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="não foi possível ler o equipamento")
    try:
        rows = response.json()
        if not isinstance(rows, list) or len(rows) > 1:
            raise ValueError("resposta de equipamento inesperada")
        return EquippedWeapon.model_validate(rows[0]) if rows else None
    except (ValueError, ValidationError) as error:
        raise HTTPException(status_code=503, detail="equipamento inválido na ficha") from error


@router.post("/roll", response_model=V5ActionRollResponse)
async def roll_action(
    payload: V5ActionRollRequest,
    response: Response,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> V5ActionRollResponse:
    weapon = None
    if payload.attack and payload.attack.use_equipped_weapon:
        weapon = await load_equipped_weapon(payload.attack, authorization)
    try:
        result = roll_v5_action(payload, weapon=weapon)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    activity = await record_from_context(authorization, payload.chronicle)
    if activity is not None:
        response.headers["X-Chronicle-Activity"] = activity.status
    return result


@router.post("/rolls/{roll_id}/attack", response_model=StoredAttackResponse)
async def stored_roll_attack(
    roll_id: UUID,
    payload: StoredAttackRequest | None = None,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> StoredAttackResponse:
    """INV-06 on a stored roll: margin of the stored outcome plus the equipped weapon.

    The roll and the weapon are both read with the caller's token, so RLS decides
    access; recomputing after a Willpower reroll uses the updated outcome.
    """
    request = payload or StoredAttackRequest()
    rows = await _supabase_request(
        "GET", "v5_roll_records", authorization,
        params={
            "select": "id,sheet_id,campaign_id,difficulty,outcome,rerolled_at",
            "id": f"eq.{roll_id}", "limit": "1",
        },
    )
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="resposta inesperada do Supabase")
    if not rows:
        raise HTTPException(status_code=404, detail="rolagem não encontrada")
    row = rows[0]
    weapon = None
    if request.use_equipped_weapon and isinstance(row, dict):
        try:
            context = AttackContext(sheet_id=row.get("sheet_id"), campaign_id=row.get("campaign_id"))
        except ValidationError as error:
            raise HTTPException(status_code=502, detail="rolagem guardada inválida") from error
        weapon = await load_equipped_weapon(context, authorization)
    try:
        return resolve_stored_attack(row, weapon)
    except ValueError as error:
        raise HTTPException(status_code=502, detail="rolagem guardada inválida") from error
