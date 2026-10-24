from __future__ import annotations

from dataclasses import asdict
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError

from app.services.v5_probability import estimate_probabilities
from app.services.v5_actions import DamageState, V5ActionRollRequest, build_v5_modifier_request
from app.routes.generators import require_signed_in_user
from app.routes.sheets import _request
from app.services.modifiers import ModifierPreview, Tag, preview_modifiers


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
