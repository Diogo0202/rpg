"""Adaptador HTTP dos geradores procedurais."""

from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator, model_validator

from app.adapters.inbound.http.auth import require_signed_in_user
from app.adapters.inbound.http.dependencies import supabase_session
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.supabase.content_applications import SupabaseContentApplications
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.generators import ContentApplyOrder, GeneratorService, campaign_content, tactical_map
from app.services.combat_blocks import CombatSystem, CombatTier

router = APIRouter(
    prefix="/api/v1", tags=["generation"], route_class=DomainErrorRoute, dependencies=[Depends(require_signed_in_user)],
)
MAX_SEED = 2**64
MAX_SYSTEM_FIELDS_BYTES = 8192


def generator_service(supabase: SupabaseRest = Depends(supabase_session)) -> GeneratorService:
    return GeneratorService(SupabaseContentApplications(supabase))


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
        if isinstance(value, int) and not 0 <= value < MAX_SEED:
            raise ValueError("seed numérica precisa estar entre 0 e 2^64 - 1")
        return value


class ContentGenerationRequest(BaseModel):
    kind: Literal["npc", "enemy", "item"]
    seed: StrictInt | None = Field(default=None, ge=0, lt=MAX_SEED)
    system: str | None = Field(default=None, max_length=120)
    system_fields: dict[str, Any] | None = Field(default=None, max_length=40)
    combat_system: CombatSystem | None = None
    difficulty: CombatTier = "padrao"

    @field_validator("system_fields")
    @classmethod
    def bound_system_fields(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and len(json.dumps(value, ensure_ascii=False)) > MAX_SYSTEM_FIELDS_BYTES:
            raise ValueError("campos do sistema excedem 8 KB")
        return value


class ContentApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["npc", "enemy"]
    seed: StrictInt = Field(ge=0, lt=MAX_SEED)
    combat_system: CombatSystem | None = None
    difficulty: CombatTier = "padrao"
    save_entity: StrictBool = True
    combat_id: UUID | None = None
    idempotency_key: UUID

    @model_validator(mode="after")
    def coherent_target(self) -> ContentApplyRequest:
        if not self.save_entity and self.combat_id is None:
            raise ValueError("escolha salvar no mundo, inserir no combate ou ambos")
        if self.combat_id is not None and self.combat_system is None:
            raise ValueError("informe o sistema do bloco de combate para inserir no combate")
        return self

    def order(self) -> ContentApplyOrder:
        return ContentApplyOrder(
            self.kind, self.seed, self.combat_system, self.difficulty, self.save_entity, self.combat_id, self.idempotency_key,
        )


@router.post("/maps/generate")
def generate_map(payload: MapGenerationRequest) -> dict[str, Any]:
    return tactical_map(payload.width, payload.height, payload.room_count, payload.seed)


@router.post("/content/generate")
def generate_campaign_content(payload: ContentGenerationRequest) -> dict[str, Any]:
    return campaign_content(
        payload.kind, seed=payload.seed, system=payload.system, system_fields=payload.system_fields,
        combat_system=payload.combat_system, difficulty=payload.difficulty,
    )


@router.post("/campaigns/{campaign_id}/content/apply", status_code=201)
async def apply_generated_content(
    campaign_id: UUID, payload: ContentApplyRequest, service: GeneratorService = Depends(generator_service),
) -> dict[str, Any]:
    return await service.apply(campaign_id, payload.order())
