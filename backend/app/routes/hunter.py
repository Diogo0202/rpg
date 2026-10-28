"""F4: Caçador: A Revanche played at the table.

Dice, the cell's Desperation and every consequence live in the database
(supabase/migrations/20261029130000_hunter_desperation_edges.sql); these routes call the RPCs
with the user's token, so RLS and auth.uid() decide who may roll, resolve or redeem.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from app.routes.generators import require_signed_in_user
from app.services.hunter_traits import desperation_choices
from app.services.session_roll_activity import RollChronicleContext, record_from_context
from app.services.supabase_rpc import supabase_config


router = APIRouter(prefix="/api/v1/hunter", tags=["hunter"])

_ERRORS = {
    "42501": (403, "operação não permitida nesta ficha ou célula"),
    "22023": (422, "pedido inválido para esta rolagem"),
    "23505": (409, "esta ação já foi aplicada de outra forma"),
    "23514": (422, "o valor sairia do limite (0 a 5, ou Vontade cheia)"),
    "55000": (409, "o caçador está em Desespero: sem dados de Desesperação nem Triunfos"),
}


async def _rpc(function: str, authorization: str | None, payload: dict[str, Any]) -> Any:
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    url, key = supabase_config()
    headers = {"apikey": key, "Authorization": authorization, "Accept": "application/json", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(f"{url}/rest/v1/rpc/{function}", headers=headers, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = {}
        code = body.get("code") if isinstance(body, dict) else None
        if code in _ERRORS:
            status, detail = _ERRORS[code]
            message = body.get("message") if isinstance(body, dict) else None
            raise HTTPException(status_code=status, detail=f"{detail} ({message})" if code in {"22023", "55000"} and message else detail)
        if response.status_code == 401:
            raise HTTPException(status_code=401, detail="sessão inválida")
        raise HTTPException(status_code=503, detail="não foi possível concluir a operação no Supabase")
    try:
        return response.json() if response.content else None
    except ValueError as error:
        raise HTTPException(status_code=503, detail="resposta inválida do Supabase") from error


class HunterSheetRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_pool: StrictInt = Field(ge=1, le=30)
    difficulty: StrictInt = Field(ge=1, le=69)
    use_desperation: StrictBool = False
    edge: StrictStr | None = Field(default=None, min_length=1, max_length=80)
    chronicle: RollChronicleContext | None = None


class HunterRerollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    indices: list[StrictInt] = Field(min_length=1, max_length=3)


class HunterResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    choice: Literal["overreach", "despair"]


class HunterCellAdjustRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    danger_delta: StrictInt = Field(default=0, ge=-5, le=5)
    desperation_delta: StrictInt = Field(default=0, ge=-5, le=5)
    reason: StrictStr | None = Field(default=None, max_length=500)


class HunterRedemptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: StrictStr = Field(default="", max_length=500)


class HunterRedemptionDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approve: StrictBool
    note: StrictStr = Field(default="", max_length=500)


def present_roll(payload: dict[str, Any]) -> dict[str, Any]:
    """RPC result -> what the roller shows: the dice, the cell and what the table may choose."""
    roll = payload.get("roll") or {}
    outcome = roll.get("outcome") or {}
    successes = outcome.get("successes", 0)
    success = bool(outcome.get("success"))
    final_success = outcome.get("final_success", success)
    critical = bool(outcome.get("critical")) and bool(final_success)
    return {
        **payload,
        "roll_id": roll.get("id"),
        "normal_dice": roll.get("normal_dice", []),
        "desperation_dice": roll.get("desperation_dice", []),
        "desperation_ones": outcome.get("desperation_ones", 0),
        "successes": successes,
        "difficulty": roll.get("difficulty"),
        "success": success,
        "critical_pairs": outcome.get("critical_pairs", 0),
        "critical": critical,
        "desperation_consequence": outcome.get("desperation_consequence"),
        "resolution": roll.get("resolution"),
        "choices": [] if roll.get("resolution") else desperation_choices(outcome),
        "can_reroll": roll.get("rerolled_at") is None and roll.get("resolution") is None,
        "verdict": "Crítico" if critical else "Êxito" if final_success else "Falha",
    }


@router.post("/sheets/{sheet_id}/rolls")
async def roll_for_sheet(
    sheet_id: UUID,
    payload: HunterSheetRollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> dict[str, Any]:
    details: dict[str, Any] = {"edge": payload.edge} if payload.edge else {}
    result = await _rpc("record_hunter_roll", authorization, {
        "p_sheet_id": str(sheet_id), "p_base_pool": payload.base_pool, "p_difficulty": payload.difficulty,
        "p_use_desperation": payload.use_desperation, "p_details": details,
    })
    activity = await record_from_context(authorization, payload.chronicle)
    if activity is not None:
        response.headers["X-Chronicle-Activity"] = activity.status
    return present_roll(result)


@router.post("/rolls/{roll_id}/reroll")
async def reroll(
    roll_id: UUID,
    payload: HunterRerollRequest,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> dict[str, Any]:
    result = await _rpc("reroll_hunter_roll", authorization, {"p_roll_id": str(roll_id), "p_indices": payload.indices})
    return present_roll(result)


@router.post("/rolls/{roll_id}/resolve")
async def resolve(
    roll_id: UUID,
    payload: HunterResolveRequest,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> dict[str, Any]:
    result = await _rpc("resolve_hunter_desperation", authorization, {"p_roll_id": str(roll_id), "p_choice": payload.choice})
    return present_roll(result)


@router.get("/sheets/{sheet_id}/state")
async def sheet_state(
    sheet_id: UUID,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> dict[str, Any]:
    return await _rpc("hunter_sheet_state", authorization, {"p_sheet_id": str(sheet_id)})


@router.post("/cells/{cell_id}/adjust")
async def adjust_cell(
    cell_id: UUID,
    payload: HunterCellAdjustRequest,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> dict[str, Any]:
    if payload.danger_delta == 0 and payload.desperation_delta == 0:
        raise HTTPException(status_code=422, detail="informe uma mudança de Perigo ou Desesperação")
    return await _rpc("adjust_hunter_cell", authorization, {
        "p_cell_id": str(cell_id), "p_operation_id": str(payload.operation_id), "p_danger_delta": payload.danger_delta,
        "p_desperation_delta": payload.desperation_delta, "p_reason": payload.reason,
    })


@router.post("/sheets/{sheet_id}/redemption")
async def request_redemption(
    sheet_id: UUID,
    payload: HunterRedemptionRequest,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> dict[str, Any]:
    return await _rpc("request_hunter_redemption", authorization, {"p_sheet_id": str(sheet_id), "p_note": payload.note})


@router.post("/redemptions/{redemption_id}/decision")
async def decide_redemption(
    redemption_id: UUID,
    payload: HunterRedemptionDecision,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> dict[str, Any]:
    return await _rpc("decide_hunter_redemption", authorization, {
        "p_redemption_id": str(redemption_id), "p_approve": payload.approve, "p_note": payload.note,
    })
