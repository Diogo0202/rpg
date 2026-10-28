from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Response

from app.routes.generators import require_signed_in_user
from app.services.session_roll_activity import RollChronicleContext, record_from_context
from app.services.system_rolls import (
    HunterRollRequest,
    HunterRollResponse,
    HunterTraitsResponse,
    JourneyEventRequest,
    JourneyEventResponse,
    OneRingRollRequest,
    OneRingRollResponse,
    OneRingShadowTestRequest,
    OneRingShadowTestResponse,
    OneRingSheetResponse,
    SheetValuesRequest,
    SotdlFateResponse,
    SotdlRollRequest,
    SotdlRollResponse,
    hunter_traits,
    one_ring_sheet,
    roll_hunter,
    roll_journey_event,
    roll_one_ring,
    roll_one_ring_shadow_test,
    roll_sotdl,
    roll_sotdl_fate,
)


router = APIRouter(prefix="/api/v1/system-rolls", tags=["system-rolls"])


async def _record_chronicle(authorization: str | None, context: RollChronicleContext | None, response: Response) -> None:
    """DRA-05: optional chronicle activity; the roll body never changes, only a header reports the status."""
    activity = await record_from_context(authorization, context)
    if activity is not None:
        response.headers["X-Chronicle-Activity"] = activity.status


@router.post("/hunter", response_model=HunterRollResponse)
async def roll_hunter_action(
    payload: HunterRollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> HunterRollResponse:
    result = roll_hunter(payload)
    await _record_chronicle(authorization, payload.chronicle, response)
    return result


@router.post("/hunter/traits", response_model=HunterTraitsResponse)
def hunter_traits_action(
    payload: SheetValuesRequest,
    _: None = Depends(require_signed_in_user),
) -> HunterTraitsResponse:
    return hunter_traits(payload)


@router.post("/one-ring", response_model=OneRingRollResponse)
async def roll_one_ring_action(
    payload: OneRingRollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> OneRingRollResponse:
    result = roll_one_ring(payload)
    await _record_chronicle(authorization, payload.chronicle, response)
    return result


@router.post("/one-ring/shadow-test", response_model=OneRingShadowTestResponse)
def roll_one_ring_shadow_test_action(
    payload: OneRingShadowTestRequest,
    _: None = Depends(require_signed_in_user),
) -> OneRingShadowTestResponse:
    return roll_one_ring_shadow_test(payload)


@router.post("/one-ring/journey-event", response_model=JourneyEventResponse)
def roll_journey_event_action(
    payload: JourneyEventRequest,
    _: None = Depends(require_signed_in_user),
) -> JourneyEventResponse:
    return roll_journey_event(payload)


@router.post("/one-ring/sheet", response_model=OneRingSheetResponse)
def one_ring_sheet_action(
    payload: SheetValuesRequest,
    _: None = Depends(require_signed_in_user),
) -> OneRingSheetResponse:
    return one_ring_sheet(payload)


@router.post("/shadow-demon-lord", response_model=SotdlRollResponse)
async def roll_sotdl_action(
    payload: SotdlRollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> SotdlRollResponse:
    result = roll_sotdl(payload)
    await _record_chronicle(authorization, payload.chronicle, response)
    return result


@router.post("/shadow-demon-lord/fate", response_model=SotdlFateResponse)
def roll_sotdl_fate_action(
    _: None = Depends(require_signed_in_user),
) -> SotdlFateResponse:
    return roll_sotdl_fate()


# ---------------------------------------------------------------------------------------------
# Vampiro V3 (frente F3): rules in app/services/v3_vampire.py, atomic sheet changes in the v3_* RPCs
# of supabase/migrations/20261029120000_vampire_v3_complete.sql (called with the user's token).
from typing import Any, Literal  # noqa: E402
from uuid import UUID  # noqa: E402

from fastapi import HTTPException  # noqa: E402
from pydantic import BaseModel, ConfigDict, Field, StrictInt  # noqa: E402

from app.services import supabase_rpc  # noqa: E402
from app.services.system_rolls import V3RollRequest, V3RollResponse, V3SheetResponse, roll_v3, v3_sheet  # noqa: E402


@router.post("/vampire-v3", response_model=V3RollResponse)
async def roll_vampire_v3_action(
    payload: V3RollRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> V3RollResponse:
    """With use_willpower and a sheet, 1 Willpower is spent atomically before the dice are rolled."""
    if payload.use_willpower and payload.sheet_id:
        if not payload.operation_id:
            raise HTTPException(status_code=422, detail="o gasto de Força de Vontade precisa de operation_id")
        await supabase_rpc.call_rpc("v3_spend_willpower", authorization or "",
                                    {"p_sheet_id": payload.sheet_id, "p_operation_id": payload.operation_id})
    try:
        result = roll_v3(payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    result.willpower_spent = bool(payload.use_willpower and payload.sheet_id)
    await _record_chronicle(authorization, payload.chronicle, response)
    return result


@router.post("/vampire-v3/sheet", response_model=V3SheetResponse)
def vampire_v3_sheet_action(
    payload: SheetValuesRequest,
    _: None = Depends(require_signed_in_user),
) -> V3SheetResponse:
    """Derived numbers (blood, health level) and, with migrate, the sheet without the old predator type."""
    return v3_sheet(dict(payload.values), payload.migrate)


class V3SheetAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    action: Literal["sangue", "cura", "dano", "sangue_inicial", "frenesi", "rotschreck", "degeneracao"]
    amount: StrictInt | None = Field(default=None, ge=0, le=50)
    kind: Literal["contundente", "letal", "agravado"] | None = None
    difficulty: StrictInt | None = Field(default=None, ge=2, le=10)
    turn: str | None = Field(default=None, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9:._-]+$")


def _v3_rpc(sheet_id: UUID, payload: V3SheetAction) -> tuple[str, dict[str, Any]]:
    base: dict[str, Any] = {"p_sheet_id": str(sheet_id), "p_operation_id": str(payload.operation_id)}
    if payload.action in ("sangue", "cura"):
        if not payload.amount:
            raise HTTPException(status_code=422, detail="informe a quantidade")
        key = "p_amount" if payload.action == "sangue" else "p_levels"
        return ("v3_spend_blood" if payload.action == "sangue" else "v3_heal"), {**base, key: payload.amount, "p_turn": payload.turn}
    if payload.action == "dano":
        if not payload.amount or not payload.kind:
            raise HTTPException(status_code=422, detail="informe o tipo e os níveis de dano")
        return "v3_apply_damage", {**base, "p_kind": payload.kind, "p_amount": payload.amount}
    if payload.action == "sangue_inicial":
        return "v3_set_initial_blood", {**base, "p_value": payload.amount}
    if payload.difficulty is None:
        raise HTTPException(status_code=422, detail="informe a dificuldade")
    if payload.action == "degeneracao":
        return "v3_degeneration_test", {**base, "p_difficulty": payload.difficulty}
    return "v3_frenzy_test", {**base, "p_kind": payload.action, "p_difficulty": payload.difficulty}


@router.post("/vampire-v3/sheets/{sheet_id}/actions")
async def vampire_v3_sheet_action_rpc(
    sheet_id: UUID,
    payload: V3SheetAction,
    authorization: str | None = Header(default=None),
    _: None = Depends(require_signed_in_user),
) -> Any:
    function, body = _v3_rpc(sheet_id, payload)
    return await supabase_rpc.call_rpc(function, authorization or "", body)
