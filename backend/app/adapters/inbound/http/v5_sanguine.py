"""Adaptador HTTP de caçada, Vínculo de Sangue e ações contra o Regente (Vampiro V5)."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator

from app.adapters.inbound.http.dependencies import v5_sanguine_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.v5.sanguine import Drink, Hunt, V5SanguineService
from app.adapters.inbound.http.auth import require_signed_in_user

router = APIRouter(
    prefix="/api/v1/v5", tags=["vampire-v5-sanguine"], route_class=DomainErrorRoute,
    dependencies=[Depends(require_signed_in_user)],
)
Sanguine = Depends(v5_sanguine_service)

Resonance = Literal["Nenhuma", "Colérica", "Melancólica", "Fleumática", "Sanguínea", "Animal", "Vazia"]
Intensity = Literal["Nenhuma", "Fugaz", "Intensa", "Aguda"]  # mesmas listas de RESONANCES e INTENSITIES (testado)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# SAN-01: caçada ------------------------------------------------------------------------------


class HuntRequest(_Strict):
    operation_id: UUID
    prey: StrictStr = Field(min_length=1, max_length=120)
    resonance: Resonance
    intensity: Intensity
    dyscrasia: StrictStr | None = Field(default=None, max_length=160)
    slake: StrictInt = Field(default=1, ge=0, le=5)
    killed: StrictBool = False
    notes: StrictStr | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def coherent(self) -> HuntRequest:
        if not self.prey.strip():
            raise ValueError("informe a presa")
        if (self.resonance == "Nenhuma") != (self.intensity == "Nenhuma"):
            raise ValueError("Ressonância e intensidade andam juntas")
        if self.dyscrasia and self.dyscrasia.strip() and self.intensity != "Aguda":
            raise ValueError("Discrasia só com Ressonância aguda")
        return self


class HuntResponse(BaseModel):
    hunt: dict[str, Any]
    sheet_values: dict[str, Any] | None
    effects: list[dict[str, Any]] | None
    sheet_version: int | None
    replayed: bool


@router.post("/sheets/{sheet_id}/hunts", response_model=HuntResponse, status_code=201)
async def record_hunt(sheet_id: UUID, request: HuntRequest, service: V5SanguineService = Sanguine) -> HuntResponse:
    result = await service.record_hunt(sheet_id, Hunt(**request.model_dump()))
    return HuntResponse(**asdict(result))


@router.get("/sheets/{sheet_id}/hunts")
async def list_hunts(
    sheet_id: UUID, limit: int = Query(default=20, ge=1, le=100), service: V5SanguineService = Sanguine,
) -> list[dict[str, Any]]:
    return await service.hunts(sheet_id, limit)


# SAN-02: Vínculo de Sangue --------------------------------------------------------------------


class DrinkRequest(_Strict):
    operation_id: UUID
    regnant_sheet_id: UUID | None = None
    regnant_entity_id: UUID | None = None
    drank_at: datetime | None = None
    notes: StrictStr | None = Field(default=None, max_length=300)
    decay_days: StrictInt | None = Field(default=None, ge=1, le=3650)

    @model_validator(mode="after")
    def one_donor(self) -> DrinkRequest:
        if (self.regnant_sheet_id is None) == (self.regnant_entity_id is None):
            raise ValueError("escolha uma ficha ou um NPC como doador")
        if self.drank_at is not None and self.drank_at.tzinfo is None:
            raise ValueError("informe a data com fuso horário")
        return self


class BondSettings(_Strict):
    decay_days: StrictInt = Field(ge=1, le=3650)
    notes: StrictStr | None = Field(default=None, max_length=1000)


@router.get("/sheets/{sheet_id}/blood-bonds")
async def list_blood_bonds(sheet_id: UUID, service: V5SanguineService = Sanguine) -> list[dict[str, Any]]:
    return await service.blood_bonds(sheet_id)


@router.post("/sheets/{sheet_id}/blood-bonds/drinks", status_code=201)
async def record_bond_drink(sheet_id: UUID, request: DrinkRequest, service: V5SanguineService = Sanguine) -> dict[str, Any]:
    return await service.record_drink(sheet_id, Drink(**request.model_dump()))


@router.patch("/blood-bonds/{bond_id}")
async def configure_blood_bond(bond_id: UUID, request: BondSettings, service: V5SanguineService = Sanguine) -> dict[str, Any]:
    return await service.configure_bond(bond_id, request.decay_days, request.notes)


# SAN-03: ações contra o Regente -----------------------------------------------------------------


class RegnantActionRequest(_Strict):
    action: StrictStr = Field(min_length=1, max_length=300)
    roll_id: UUID | None = None

    @model_validator(mode="after")
    def described(self) -> RegnantActionRequest:
        if not self.action.strip():
            raise ValueError("descreva a ação contra o Regente")
        return self


class RegnantDecision(_Strict):
    decision: Literal["permitida", "negada"]
    note: StrictStr | None = Field(default=None, max_length=500)


@router.get("/sheets/{sheet_id}/regnant-actions")
async def list_regnant_actions(sheet_id: UUID, service: V5SanguineService = Sanguine) -> list[dict[str, Any]]:
    return await service.regnant_actions(sheet_id)


@router.post("/blood-bonds/{bond_id}/regnant-actions", status_code=201)
async def request_regnant_action(
    bond_id: UUID, request: RegnantActionRequest, service: V5SanguineService = Sanguine,
) -> dict[str, Any]:
    return await service.request_regnant_action(bond_id, request.action, request.roll_id)


@router.post("/regnant-actions/{action_id}/decision")
async def decide_regnant_action(
    action_id: UUID, request: RegnantDecision, service: V5SanguineService = Sanguine,
) -> dict[str, Any]:
    return await service.decide_regnant_action(action_id, request.decision, request.note)
