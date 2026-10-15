from __future__ import annotations

import re
import secrets

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.models import DiceResponse
from app.services.modifiers import Effect, ModifierPreview, ModifierRequest, Tag, preview_modifiers


EXPRESSION = re.compile(r"^(?P<count>[1-9][0-9]?)d(?P<sides>[1-9][0-9]{0,3})(?P<modifier>[+-][0-9]{1,5})?$")


class DiceModifiers(ModifierRequest):
    model_config = ConfigDict(extra="forbid")

    base_pool: StrictInt = Field(ge=0, le=99)


def roll(
    expression: str,
    effects: list[Effect] | None = None,
    context_tags: list[Tag] | None = None,
) -> DiceResponse:
    """Rola uma gramática fechada, pois fórmula de ficha não pode virar código executável."""
    normalized = expression.replace(" ", "").lower()
    match = EXPRESSION.fullmatch(normalized)
    if not match:
        raise ValueError("use o formato NdM, opcionalmente com +K ou -K")

    count = int(match.group("count"))
    sides = int(match.group("sides"))
    modifier = int(match.group("modifier") or 0)
    if count > 99 or sides > 1000:
        raise ValueError("a rolagem excede o limite seguro")

    modifiers = DiceModifiers(
        base_pool=count,
        effects=effects or [],
        context_tags=context_tags or [],
    )
    engine_preview = preview_modifiers(modifiers)
    raw_pool = count + engine_preview.total_delta
    adjusted_pool = min(99, max(0, raw_pool))
    if adjusted_pool == 0:
        raise ValueError("pool ajustado precisa conter ao menos um dado")
    preview = ModifierPreview(
        base_pool=count,
        total_delta=engine_preview.total_delta,
        adjusted_pool=adjusted_pool,
        applied=engine_preview.applied,
        skipped=engine_preview.skipped,
        clipped=adjusted_pool != raw_pool,
    )

    generator = secrets.SystemRandom()
    rolls = [generator.randint(1, sides) for _ in range(adjusted_pool)]
    return DiceResponse(
        expression=normalized,
        rolls=rolls,
        modifier=modifier,
        total=sum(rolls) + modifier,
        modifier_preview=preview if modifiers.effects else None,
    )
