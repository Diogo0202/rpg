from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictInt

from app.services.v5_probability import estimate_probabilities
from app.services.v5_actions import V5ActionRollRequest, build_v5_modifier_request
from app.routes.generators import require_signed_in_user
from app.services.modifiers import ModifierPreview, preview_modifiers


router = APIRouter(prefix="/api/v1/v5", tags=["vampire-v5"])


class ProbabilityRequest(V5ActionRollRequest):
    willpower_dice: StrictInt = Field(default=3, ge=0, le=3)


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
