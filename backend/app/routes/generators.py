from __future__ import annotations

import json
import os
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator, model_validator

from app.services.combat_blocks import CombatSystem, CombatTier
from app.services.content_generator import generate_content
from app.services.supabase_rpc import call_rpc
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
    combat_system: CombatSystem | None = None
    difficulty: CombatTier = "padrao"

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
            combat_system=payload.combat_system,
            difficulty=payload.difficulty,
        )
        return result.model_dump(mode="json")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


# Campos que só o narrador vê: world_entities é lido por todos os membros.
NARRATOR_ONLY_DETAILS = frozenset({"secret", "story_hook", "weakness", "encounter_hook", "combat_block"})


class ContentApplyRequest(BaseModel):
    """GER-06: o servidor regenera o conteúdo pela seed; o cliente não envia estatísticas."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["npc", "enemy"]
    seed: StrictInt = Field(ge=0, lt=2**64)
    combat_system: CombatSystem | None = None
    difficulty: CombatTier = "padrao"
    save_entity: StrictBool = True
    combat_id: UUID | None = None
    idempotency_key: UUID

    @model_validator(mode="after")
    def coherent_target(self) -> "ContentApplyRequest":
        if not self.save_entity and self.combat_id is None:
            raise ValueError("escolha salvar no mundo, inserir no combate ou ambos")
        if self.combat_id is not None and self.combat_system is None:
            raise ValueError("informe o sistema do bloco de combate para inserir no combate")
        return self


def generated_entity_body(content: dict[str, Any]) -> dict[str, Any]:
    details = {key: value for key, value in content["details"].items() if key not in NARRATOR_ONLY_DETAILS}
    return {
        "description": content["summary"],
        "generated": {"kind": content["kind"], "name": content["name"], "summary": content["summary"], "details": details, "seed": content["seed"]},
        "role": "antagonist" if content["kind"] == "enemy" else "neutral",
        "source": "Gerador original RPG-Atlas",
    }


@router.post("/campaigns/{campaign_id}/content/apply", status_code=201)
async def apply_generated_content(
    campaign_id: UUID,
    payload: ContentApplyRequest,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    try:
        content = generate_content(
            payload.kind, seed=payload.seed, combat_system=payload.combat_system, difficulty=payload.difficulty,
        ).model_dump(mode="json")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    block = content["details"].get("combat_block")
    result = await call_rpc("rpg_apply_generated_content", authorization or "", {
        "p_campaign_id": str(campaign_id),
        "p_idempotency_key": str(payload.idempotency_key),
        "p_source_kind": "generator",
        "p_source_ref": {
            "kind": payload.kind, "seed": payload.seed, "combat_system": payload.combat_system,
            "difficulty": payload.difficulty if block else None, "generator": "content_generator",
        },
        "p_name": content["name"],
        "p_entity_kind": "npc",
        "p_entity_body": generated_entity_body(content),
        "p_save_entity": payload.save_entity,
        "p_combat_id": str(payload.combat_id) if payload.combat_id else None,
        "p_initiative": block["initiative"] if block and payload.combat_id else None,
        "p_health": block["health"] if block and payload.combat_id else None,
        "p_combat_block": block,
    })
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="Supabase não confirmou a aplicação")
    return {"application": result, "content": content}
