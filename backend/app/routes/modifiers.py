from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.routes.generators import require_signed_in_user
from app.services.modifiers import ModifierPreview, ModifierRequest, preview_modifiers
from app.services.session_roll_activity import RollChronicleContext, record_from_context


router = APIRouter(prefix="/api/v1/modifiers", tags=["modifiers"])


class ModifierRollRequest(ModifierRequest):
    die_sides: StrictInt = Field(ge=2, le=100)
    chronicle: RollChronicleContext | None = None


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
async def roll_adjusted_pool(
    payload: ModifierRollRequest,
    response: Response,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> ModifierRollResponse:
    preview = preview_modifiers(payload)
    if preview.adjusted_pool == 0:
        raise HTTPException(status_code=422, detail="pool ajustado precisa conter ao menos um dado")

    rolls = [secrets.randbelow(payload.die_sides) + 1 for _ in range(preview.adjusted_pool)]
    # DRA-05: a rolagem autenticada vira atividade da crônica quando a ficha é da campanha.
    activity = await record_from_context(authorization, payload.chronicle)
    if activity is not None:
        response.headers["X-Chronicle-Activity"] = activity.status
    return ModifierRollResponse(preview=preview, rolls=rolls, total=sum(rolls))
