"""Resultados das rolagens V5 devolvidos pelos casos de uso."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.modifiers import ModifierPreview


class RollProbabilities(BaseModel):
    success: float
    messy_critical: float
    bestial_failure: float


class ProbabilityComparison(BaseModel):
    without_reroll: RollProbabilities
    with_reroll: RollProbabilities
    reroll_limit: int
    modifier_preview: ModifierPreview
    hunger_dice: int


class CurvePoint(BaseModel):
    difficulty: int
    without_reroll: RollProbabilities
    with_reroll: RollProbabilities


class CurveSeries(BaseModel):
    pool: int
    hunger_dice: int
    points: list[CurvePoint]


class Curve(BaseModel):
    hunger: int
    reroll_limit: int
    series: list[CurveSeries]


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


class WillpowerReroll(BaseModel):
    roll: StoredRoll
    willpower_spent: bool
    sheet_values: dict[str, Any] | None = None


class BloodActionResult(BaseModel):
    replayed: bool
    outcome: dict[str, Any]
    dice: list[int]
    event_id: int | None
    sheet: dict[str, Any] | None
    state: dict[str, Any] | None
