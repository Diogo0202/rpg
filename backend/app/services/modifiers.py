from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator


Tag = Annotated[StrictStr, Field(min_length=1, max_length=64)]


class Effect(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: StrictStr = Field(min_length=1, max_length=64)
    label: StrictStr = Field(min_length=1, max_length=120)
    delta: StrictInt = Field(ge=-10, le=10)
    enabled: StrictBool = True
    applies_to_tags: list[Tag] = Field(default_factory=list, max_length=20)
    exempt_tags: list[Tag] = Field(default_factory=list, max_length=20)
    remaining_scenes: StrictInt | None = Field(default=None, ge=0, le=1000)
    source_note: StrictStr | None = Field(default=None, max_length=500)


class ModifierRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_pool: StrictInt = Field(ge=0, le=30)
    context_tags: list[Tag] = Field(default_factory=list, max_length=20)
    effects: list[Effect] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def ids_are_unique(self) -> ModifierRequest:
        ids = [effect.id for effect in self.effects]
        if len(ids) != len(set(ids)):
            raise ValueError("ids de efeitos devem ser únicos")
        encoded = json.dumps(
            [effect.model_dump(mode="json") for effect in self.effects],
            ensure_ascii=False,
        ).encode("utf-8")
        if len(encoded) > 32768:
            raise ValueError("efeitos excedem 32768 bytes")
        return self


class AppliedEffect(BaseModel):
    id: str
    label: str
    delta: int
    source_note: str | None


class SkippedEffect(BaseModel):
    id: str
    reason: Literal["disabled", "expired", "exempt", "out_of_scope"]


class ModifierPreview(BaseModel):
    base_pool: int
    total_delta: int
    adjusted_pool: int
    applied: list[AppliedEffect]
    skipped: list[SkippedEffect]
    clipped: bool


def preview_modifiers(payload: ModifierRequest) -> ModifierPreview:
    applied: list[AppliedEffect] = []
    skipped: list[SkippedEffect] = []
    context = set(payload.context_tags)

    for effect in payload.effects:
        if not effect.enabled:
            skipped.append(SkippedEffect(id=effect.id, reason="disabled"))
        elif effect.remaining_scenes == 0:
            skipped.append(SkippedEffect(id=effect.id, reason="expired"))
        elif effect.exempt_tags and context.intersection(effect.exempt_tags):
            skipped.append(SkippedEffect(id=effect.id, reason="exempt"))
        elif effect.applies_to_tags and not context.intersection(effect.applies_to_tags):
            skipped.append(SkippedEffect(id=effect.id, reason="out_of_scope"))
        else:
            applied.append(
                AppliedEffect(
                    id=effect.id,
                    label=effect.label,
                    delta=effect.delta,
                    source_note=effect.source_note,
                )
            )

    total_delta = sum(effect.delta for effect in applied)
    raw_pool = payload.base_pool + total_delta
    adjusted_pool = min(30, max(0, raw_pool))
    return ModifierPreview(
        base_pool=payload.base_pool,
        total_delta=total_delta,
        adjusted_pool=adjusted_pool,
        applied=applied,
        skipped=skipped,
        clipped=adjusted_pool != raw_pool,
    )
