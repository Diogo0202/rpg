from __future__ import annotations

import json
import os
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, StrictInt, StrictStr, field_validator

from app.services.content_generator import generate_content
from app.services.tactical_maps import generate_tactical_map


router = APIRouter(prefix="/api/v1", tags=["generation"])


async def require_signed_in_user(request: Request, authorization: str | None = Header(default=None)) -> None:
    if getattr(request.state, "supabase_user", None) is not None:
        return
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="autenticaÃ§Ã£o da API ainda nÃ£o estÃ¡ configurada")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="sessÃ£o necessÃ¡ria")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"{supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": supabase_key, "Authorization": authorization},
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="serviÃ§o de autenticaÃ§Ã£o indisponÃ­vel") from error
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="sessÃ£o invÃ¡lida")


class MapGenerationRequest(BaseModel):
    width: StrictInt = Field(default=32, ge=12, le=64)
    height: StrictInt = Field(default=24, ge=12, le=64)
    room_count: StrictInt = Field(default=8, ge=1, le=32)
    seed: StrictInt | StrictStr = 0

    @field_validator("seed")
    @classmethod
    def bounded_seed(cls, value: int | str) -> int | str:
        if isinstance(value, str) and (not value or len(value) > 128):
            raise ValueError("seed em texto precisa ter entre 1 e 128 caracteres")
        if isinstance(value, int) and not 0 <= value < 2**64:
            raise ValueError("seed numérica precisa estar entre 0 e 2^64 - 1")
        return value


class ContentGenerationRequest(BaseModel):
    kind: Literal["npc", "enemy", "item"]
    seed: StrictInt | None = Field(default=None, ge=0, lt=2**64)
    system: str | None = Field(default=None, max_length=120)
    system_fields: dict[str, Any] | None = Field(default=None, max_length=40)

    @field_validator("system_fields")
    @classmethod
    def bound_system_fields(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and len(json.dumps(value, ensure_ascii=False)) > 8192:
            raise ValueError("campos do sistema excedem 8 KB")
        return value


@router.post("/maps/generate")
def generate_map(payload: MapGenerationRequest, _: None = Depends(require_signed_in_user)) -> dict[str, Any]:
    try:
        return generate_tactical_map(
            width=payload.width,
            height=payload.height,
            room_count=payload.room_count,
            seed=payload.seed,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/content/generate")
def generate_campaign_content(payload: ContentGenerationRequest, _: None = Depends(require_signed_in_user)) -> dict[str, Any]:
    try:
        result = generate_content(
            payload.kind,
            seed=payload.seed,
            system=payload.system,
            system_fields=payload.system_fields,
        )
        return result.model_dump(mode="json")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
