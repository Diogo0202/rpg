from __future__ import annotations

from dataclasses import asdict
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, field_validator

from app.services.v5_probability import (
    MAX_CURVE_DIFFICULTIES,
    MAX_CURVE_POOLS,
    estimate_curve,
    estimate_probabilities,
    recommend_reroll,
)
from app.services.v5_actions import DamageState, V5ActionRollRequest, build_v5_modifier_request
from app.routes.generators import require_signed_in_user
from app.routes.sheets import _request, _rpc
from app.services.modifiers import ModifierPreview, Tag, preview_modifiers
from app.services.session_roll_activity import RollChronicleContext, record_from_context


router = APIRouter(prefix="/api/v1/v5", tags=["vampire-v5"])


class ProbabilityRequest(V5ActionRollRequest):
    willpower_dice: StrictInt = Field(default=3, ge=0, le=3)


class SheetProbabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pool: StrictInt = Field(ge=0, le=30)
    difficulty: StrictInt = Field(ge=1, le=100)
    willpower_dice: StrictInt = Field(default=3, ge=0, le=3)
    context_tags: list[Tag] = Field(default_factory=list, max_length=20)


class RollProbabilitiesResponse(BaseModel):
    success: float
    messy_critical: float
    bestial_failure: float


class ProbabilityComparisonResponse(BaseModel):
    without_reroll: RollProbabilitiesResponse
    with_reroll: RollProbabilitiesResponse
    reroll_limit: int
    modifier_preview: ModifierPreview
    hunger_dice: int


@router.post("/probabilities", response_model=ProbabilityComparisonResponse)
def get_probabilities(payload: ProbabilityRequest, _: None = Depends(require_signed_in_user)) -> ProbabilityComparisonResponse:
    try:
        modifiers, _ = build_v5_modifier_request(payload)
        preview = preview_modifiers(modifiers)
        hunger_dice = min(payload.hunger, preview.adjusted_pool)
        result = estimate_probabilities(
            pool=preview.adjusted_pool,
            hunger=hunger_dice,
            difficulty=payload.difficulty,
            willpower_dice=payload.willpower_dice,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return ProbabilityComparisonResponse(
        without_reroll=RollProbabilitiesResponse(**asdict(result.without_reroll)),
        with_reroll=RollProbabilitiesResponse(**asdict(result.with_reroll)),
        reroll_limit=result.reroll_limit,
        modifier_preview=preview,
        hunger_dice=hunger_dice,
    )


def _sheet_integer(values: dict[str, Any], key: str, *, default: int | None = 0) -> int:
    value = values.get(key, default)
    if type(value) is not int or not 0 <= value <= 30:
        raise HTTPException(status_code=422, detail=f"campo {key} inválido na ficha")
    return value


def _sheet_damage(values: dict[str, Any]) -> DamageState:
    health_max = min(30, _sheet_integer(values, "vigor") + 3)
    willpower_max = min(30, _sheet_integer(values, "autocontrole") + _sheet_integer(values, "resolucao"))
    try:
        return DamageState(
            health_max=health_max,
            health_superficial=_sheet_integer(values, "saude_superficial"),
            health_aggravated=_sheet_integer(values, "saude_agravada"),
            willpower_max=willpower_max,
            willpower_superficial=_sheet_integer(values, "vontade_superficial"),
            willpower_aggravated=_sheet_integer(values, "vontade_agravada"),
        )
    except ValidationError as error:
        raise HTTPException(status_code=422, detail="trilha de dano inválida na ficha") from error


async def _sheet_roll_context(
    sheet_id: UUID, pool: int, difficulty: int, context_tags: list[Tag], authorization: str | None
) -> tuple[ModifierPreview, int]:
    """Adjusted pool and Hunger dice from the stored sheet (Hunger, effects, damage)."""
    rows = await _request(
        "GET", "character_sheets", authorization,
        params={"select": "id,values,effects", "id": f"eq.{sheet_id}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="ficha não encontrada")
    sheet = rows[0]
    values = sheet.get("values")
    effects = sheet.get("effects")
    if not isinstance(values, dict) or not isinstance(effects, list):
        raise HTTPException(status_code=422, detail="dados da ficha inválidos")
    hunger = _sheet_integer(values, "fome", default=None)
    if hunger > 5:
        raise HTTPException(status_code=422, detail="Fome inválida na ficha")
    try:
        payload = V5ActionRollRequest(
            pool=pool, hunger=hunger, difficulty=difficulty, effects=effects,
            context_tags=context_tags, damage=_sheet_damage(values),
        )
        modifiers, _ = build_v5_modifier_request(payload)
        preview = preview_modifiers(modifiers)
    except (ValidationError, ValueError) as error:
        raise HTTPException(status_code=422, detail="efeitos ou estado da ficha inválidos") from error
    return preview, min(hunger, preview.adjusted_pool)


@router.post("/sheets/{sheet_id}/probabilities", response_model=ProbabilityComparisonResponse)
async def get_sheet_probabilities(
    sheet_id: UUID,
    request: SheetProbabilityRequest,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> ProbabilityComparisonResponse:
    rows = await _request(
        "GET", "character_sheets", authorization,
        params={"select": "id,values,effects", "id": f"eq.{sheet_id}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="ficha não encontrada")
    sheet = rows[0]
    values = sheet.get("values")
    effects = sheet.get("effects")
    if not isinstance(values, dict) or not isinstance(effects, list):
        raise HTTPException(status_code=422, detail="dados da ficha inválidos")
    hunger = _sheet_integer(values, "fome", default=None)
    if hunger > 5:
        raise HTTPException(status_code=422, detail="Fome inválida na ficha")
    try:
        payload = V5ActionRollRequest(
            pool=request.pool,
            hunger=hunger,
            difficulty=request.difficulty,
            effects=effects,
            context_tags=request.context_tags,
            damage=_sheet_damage(values),
        )
        modifiers, _ = build_v5_modifier_request(payload)
        preview = preview_modifiers(modifiers)
        hunger_dice = min(hunger, preview.adjusted_pool)
        result = estimate_probabilities(preview.adjusted_pool, hunger_dice, request.difficulty, request.willpower_dice)
    except (ValidationError, ValueError) as error:
        raise HTTPException(status_code=422, detail="efeitos ou estado da ficha inválidos") from error
    return ProbabilityComparisonResponse(
        without_reroll=RollProbabilitiesResponse(**asdict(result.without_reroll)),
        with_reroll=RollProbabilitiesResponse(**asdict(result.with_reroll)),
        reroll_limit=result.reroll_limit,
        modifier_preview=preview,
        hunger_dice=hunger_dice,
    )


# --- V5-05: curva comparativa -------------------------------------------------

class CurveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pools: list[StrictInt] = Field(min_length=1, max_length=MAX_CURVE_POOLS)
    difficulties: list[StrictInt] = Field(min_length=1, max_length=MAX_CURVE_DIFFICULTIES)
    hunger: StrictInt = Field(ge=0, le=5)
    willpower_dice: StrictInt = Field(default=3, ge=0, le=3)

    @field_validator("pools")
    @classmethod
    def pools_in_range(cls, value: list[int]) -> list[int]:
        if any(not 0 <= pool <= 30 for pool in value) or len(set(value)) != len(value):
            raise ValueError("paradas devem ser distintas e estar entre 0 e 30")
        return value

    @field_validator("difficulties")
    @classmethod
    def difficulties_in_range(cls, value: list[int]) -> list[int]:
        if any(not 1 <= difficulty <= 100 for difficulty in value) or len(set(value)) != len(value):
            raise ValueError("dificuldades devem ser distintas e estar entre 1 e 100")
        return value


class CurvePointResponse(BaseModel):
    difficulty: int
    without_reroll: RollProbabilitiesResponse
    with_reroll: RollProbabilitiesResponse


class CurveSeriesResponse(BaseModel):
    pool: int
    hunger_dice: int
    points: list[CurvePointResponse]


class CurveResponse(BaseModel):
    hunger: int
    reroll_limit: int
    series: list[CurveSeriesResponse]


@router.post("/probability-curve", response_model=CurveResponse)
def get_probability_curve(payload: CurveRequest, _: None = Depends(require_signed_in_user)) -> CurveResponse:
    """Várias paradas contra várias dificuldades, com Fome fixa e Vontade ótima."""
    try:
        series = estimate_curve(payload.pools, payload.hunger, payload.difficulties, payload.willpower_dice)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return CurveResponse(
        hunger=payload.hunger,
        reroll_limit=payload.willpower_dice,
        series=[CurveSeriesResponse(**asdict(item)) for item in series],
    )


# --- V5-07: rolagem guardada e rerrolagem de Vontade ---------------------------

class StoredRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pool: StrictInt = Field(ge=0, le=30)
    difficulty: StrictInt = Field(ge=1, le=100)
    context_tags: list[Tag] = Field(default_factory=list, max_length=20)
    # DRA-05: optional chronicle activity, same contract as POST /api/v1/v5/roll.
    chronicle: RollChronicleContext | None = None


class WillpowerRerollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    normal_indices: list[StrictInt] = Field(min_length=1, max_length=3)

    @field_validator("normal_indices")
    @classmethod
    def distinct_indices(cls, value: list[int]) -> list[int]:
        if any(index < 0 or index >= 30 for index in value) or len(set(value)) != len(value):
            raise ValueError("escolha de 1 a 3 dados comuns distintos")
        return value


class StoredRoll(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    sheet_id: UUID
    campaign_id: UUID
    author_id: UUID | None
    pool: int
    hunger: int
    difficulty: int
    normal_dice: list[int]
    hunger_dice: list[int]
    outcome: dict[str, Any]
    details: dict[str, Any] = Field(default_factory=dict)
    original_normal_dice: list[int] | None = None
    rerolled_indices: list[int] | None = None
    willpower_event_id: int | None = None
    created_at: str
    rerolled_at: str | None = None
    recommended_reroll: list[int] = Field(default_factory=list)


class WillpowerRerollResponse(BaseModel):
    roll: StoredRoll
    willpower_spent: bool
    sheet_values: dict[str, Any] | None = None


ROLL_HISTORY_LIMIT = 50


def _stored_roll(row: Any) -> StoredRoll:
    if not isinstance(row, dict):
        raise HTTPException(status_code=502, detail="resposta inesperada do Supabase")
    try:
        roll = StoredRoll.model_validate(row)
    except ValidationError as error:
        raise HTTPException(status_code=502, detail="rolagem guardada inválida") from error
    if roll.rerolled_at is None:
        try:
            roll.recommended_reroll = recommend_reroll(roll.normal_dice, roll.hunger_dice, roll.difficulty)
        except ValueError:
            roll.recommended_reroll = []
    return roll


@router.post("/sheets/{sheet_id}/rolls", response_model=StoredRoll, status_code=201)
async def create_stored_roll(
    sheet_id: UUID,
    request: StoredRollRequest,
    response: Response,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> StoredRoll:
    """Rola no banco (dados gerados pelo Postgres) e guarda no histórico da ficha."""
    if request.chronicle is not None and request.chronicle.sheet_id != sheet_id:
        raise HTTPException(status_code=422, detail="a atividade da crônica deve ser da mesma ficha")
    preview, hunger_dice = await _sheet_roll_context(sheet_id, request.pool, request.difficulty, request.context_tags, authorization)
    if preview.adjusted_pool == 0:
        raise HTTPException(status_code=422, detail="A parada ficou com zero dados. Combine com a mesa como resolver a ação.")
    row = await _rpc("record_v5_roll", authorization, {
        "p_sheet_id": str(sheet_id),
        "p_pool": preview.adjusted_pool,
        "p_hunger": hunger_dice,
        "p_difficulty": request.difficulty,
        "p_details": {
            "base_pool": request.pool,
            "context_tags": list(request.context_tags),
            "modifier_preview": preview.model_dump(mode="json"),
        },
    })
    roll = _stored_roll(row)
    activity = await record_from_context(authorization, request.chronicle)
    if activity is not None:
        response.headers["X-Chronicle-Activity"] = activity.status
    return roll


@router.get("/sheets/{sheet_id}/rolls", response_model=list[StoredRoll])
async def list_stored_rolls(
    sheet_id: UUID,
    limit: int = Query(default=20, ge=1, le=ROLL_HISTORY_LIMIT),
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> list[StoredRoll]:
    rows = await _request(
        "GET", "v5_roll_records", authorization,
        params={"select": "*", "sheet_id": f"eq.{sheet_id}", "order": "created_at.desc,id.desc", "limit": str(limit)},
    )
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="resposta inesperada do Supabase")
    return [_stored_roll(row) for row in rows]


@router.post("/rolls/{roll_id}/willpower-reroll", response_model=WillpowerRerollResponse)
async def willpower_reroll(
    roll_id: UUID,
    request: WillpowerRerollRequest,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> WillpowerRerollResponse:
    """Rerrola até três dados comuns uma única vez e marca o gasto de Vontade."""
    try:
        result = await _rpc("reroll_v5_roll", authorization, {"p_roll_id": str(roll_id), "p_indices": request.normal_indices})
    except HTTPException as error:
        detail = {
            403: "só quem fez a rolagem pode rerrolar com Vontade",
            409: "esta rolagem já foi rerrolada com Vontade",
            422: "trilha de Vontade cheia ou dados inválidos para esta rolagem",
        }.get(error.status_code, error.detail)
        raise HTTPException(status_code=error.status_code, detail=detail) from error
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="resposta inesperada do Supabase")
    values = result.get("sheet_values")
    return WillpowerRerollResponse(
        roll=_stored_roll(result.get("roll")),
        willpower_spent=result.get("willpower_spent") is True,
        sheet_values=values if isinstance(values, dict) else None,
    )
