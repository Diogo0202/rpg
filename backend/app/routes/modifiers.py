from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.routes.generators import require_signed_in_user
from app.services.modifiers import ModifierPreview, ModifierRequest, preview_modifiers


router = APIRouter(prefix="/api/v1/modifiers", tags=["modifiers"])


class ModifierRollRequest(ModifierRequest):
    die_sides: StrictInt = Field(ge=2, le=100)


class ModifierRollResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preview: ModifierPreview
    rolls: list[int]
    total: int


@router.post("/preview", response_model=ModifierPreview)
def get_preview(
    payload: ModifierRequest,
    _: None = Depends(require_signed_in_user),
) -> ModifierPreview:
    return preview_modifiers(payload)


@router.post("/roll", response_model=ModifierRollResponse)
def roll_adjusted_pool(
    payload: ModifierRollRequest,
    _: None = Depends(require_signed_in_user),
) -> ModifierRollResponse:
    preview = preview_modifiers(payload)
    if preview.adjusted_pool == 0:
        raise HTTPException(status_code=422, detail="pool ajustado precisa conter ao menos um dado")

    rolls = [secrets.randbelow(payload.die_sides) + 1 for _ in range(preview.adjusted_pool)]
    return ModifierRollResponse(preview=preview, rolls=rolls, total=sum(rolls))
