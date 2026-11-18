"""Adaptador HTTP de fichas: valida o formato da requisição e delega ao ``SheetService``."""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator

from app.adapters.inbound.http.dependencies import sheet_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.sheets.ports import EvocationRegistration, Row
from app.application.sheets.service import SheetService

router = APIRouter(prefix="/api/v1", tags=["sheets"], route_class=DomainErrorRoute)

MAX_VALUES_BYTES = 32 * 1024
MAX_FIELDS = 200
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
PORTRAIT_PATH = re.compile(rf"{_UUID}/{_UUID}/{_UUID}\.webp")


def check_values_size(values: dict[str, Any]) -> None:
    try:
        encoded = json.dumps(values, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("valores da ficha precisam ser JSON válido") from error
    if len(encoded) > MAX_VALUES_BYTES:
        raise ValueError("valores da ficha excedem 32 KB")


# Formatos de entrada -------------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SheetCreate(_Strict):
    template_id: UUID
    name: StrictStr = Field(min_length=1, max_length=120)
    values: dict[str, Any] = Field(default_factory=dict, max_length=MAX_FIELDS)
    # O Um Anel v3 aceita ficha sem retrato; os perfis antigos ainda exigem um.
    portrait_path: StrictStr | None = Field(default=None, max_length=200)

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, Any]) -> dict[str, Any]:
        check_values_size(value)
        return value

    @field_validator("portrait_path")
    @classmethod
    def portrait_shape(cls, value: str | None) -> str | None:
        if value is not None and not PORTRAIT_PATH.fullmatch(value):
            raise ValueError("retrato inválido; envie a foto do personagem novamente")
        return value


class CreationCheck(_Strict):
    template_id: UUID
    values: dict[str, Any] = Field(default_factory=dict, max_length=MAX_FIELDS)

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, Any]) -> dict[str, Any]:
        check_values_size(value)
        return value


class SheetUpdate(_Strict):
    expected_version: int = Field(ge=1)
    name: StrictStr | None = Field(default=None, min_length=1, max_length=120)
    values: dict[str, Any] | None = Field(default=None, max_length=MAX_FIELDS)

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None:
            check_values_size(value)
        return value


class SheetAdjust(_Strict):
    operation_id: UUID
    field_id: StrictStr = Field(min_length=2, max_length=64)
    delta: int = Field(ge=-1000, le=1000)
    reason: StrictStr | None = Field(default=None, max_length=200)

    @field_validator("delta")
    @classmethod
    def nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("delta não pode ser zero")
        return value


class ExperienceAdjust(_Strict):
    amount: int = Field(ge=-1000, le=1000)
    reason: StrictStr | None = Field(default=None, max_length=200)

    @field_validator("amount")
    @classmethod
    def nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("quantidade não pode ser zero")
        return value


class MetaCurrencySpend(ExperienceAdjust):
    """Valores positivos gastam o recurso; negativos o recuperam."""


class SheetRestore(_Strict):
    expected_version: int = Field(ge=1)


class DemonEvocationRegister(_Strict):
    name: StrictStr = Field(min_length=2, max_length=120)
    lore_field: StrictStr = Field(pattern=r"^dou_[a-z_]{2,40}$")
    required_rank: StrictInt = Field(ge=1, le=5)
    faith_cost: StrictInt = Field(ge=1, le=10)
    source_title: StrictStr = Field(min_length=2, max_length=160)
    source_page: StrictInt = Field(ge=1, le=5000)
    verification_note: StrictStr = Field(min_length=12, max_length=500)


class DemonEvocationActivation(_Strict):
    evocation_id: UUID
    operation_id: UUID
    expected_version: StrictInt = Field(ge=1)


# Rotas -----------------------------------------------------------------------------------

Service = Depends(sheet_service)


@router.get("/campaigns/{campaign_id}/templates")
async def list_campaign_templates(campaign_id: UUID, service: SheetService = Service) -> list[Row]:
    return await service.list_templates(campaign_id)


@router.get("/campaigns/{campaign_id}/sheets")
async def list_campaign_sheets(
    campaign_id: UUID,
    owner_id: UUID | None = Query(default=None),
    service: SheetService = Service,
) -> list[Row]:
    return await service.list_sheets(campaign_id, owner_id)


@router.post("/campaigns/{campaign_id}/sheets/validate-creation")
async def validate_creation(campaign_id: UUID, payload: CreationCheck, service: SheetService = Service) -> dict[str, Any]:
    return await service.validate_creation(campaign_id, payload.template_id, payload.values)


@router.post("/campaigns/{campaign_id}/sheets", status_code=201)
async def create_campaign_sheet(campaign_id: UUID, payload: SheetCreate, service: SheetService = Service) -> Row:
    return await service.create_sheet(campaign_id, payload.template_id, payload.name, payload.values, payload.portrait_path)


@router.get("/sheets/{sheet_id}")
async def get_sheet(sheet_id: UUID, service: SheetService = Service) -> Row:
    return await service.get_sheet(sheet_id)


@router.patch("/sheets/{sheet_id}")
async def update_sheet(sheet_id: UUID, payload: SheetUpdate, service: SheetService = Service) -> Row:
    changes = payload.model_dump(exclude={"expected_version"}, exclude_unset=True)
    return await service.update_sheet(sheet_id, payload.expected_version, changes)


@router.delete("/sheets/{sheet_id}", status_code=204)
async def delete_sheet(sheet_id: UUID, expected_version: int = Query(ge=1), service: SheetService = Service) -> None:
    await service.delete_sheet(sheet_id, expected_version)


@router.post("/sheets/{sheet_id}/adjust")
async def adjust_sheet(sheet_id: UUID, payload: SheetAdjust, service: SheetService = Service) -> Row:
    return await service.adjust_number(sheet_id, payload.operation_id, payload.field_id, payload.delta, payload.reason)


@router.post("/sheets/{sheet_id}/experience")
async def adjust_experience(sheet_id: UUID, payload: ExperienceAdjust, service: SheetService = Service) -> Row:
    return await service.add_experience(sheet_id, payload.amount, payload.reason)


@router.post("/sheets/{sheet_id}/meta-currencies/{currency_id}")
async def spend_meta_currency(
    sheet_id: UUID, currency_id: str, payload: MetaCurrencySpend, service: SheetService = Service,
) -> Row:
    return await service.spend_meta_currency(sheet_id, currency_id, payload.amount, payload.reason)


@router.get("/sheets/{sheet_id}/events")
async def list_sheet_events(
    sheet_id: UUID, limit: int = Query(default=50, ge=1, le=200), service: SheetService = Service,
) -> list[Row]:
    return await service.list_events(sheet_id, limit)


@router.get("/sheets/{sheet_id}/versions")
async def list_sheet_versions(
    sheet_id: UUID, limit: int = Query(default=50, ge=1, le=50), service: SheetService = Service,
) -> list[Row]:
    """Versões mais recentes primeiro; o RLS só as mostra a quem lê a ficha."""
    return await service.list_versions(sheet_id, limit)


@router.post("/sheets/{sheet_id}/versions/{version}/restore")
async def restore_sheet_version(
    sheet_id: UUID, version: int, payload: SheetRestore, service: SheetService = Service,
) -> Row:
    return await service.restore_version(sheet_id, version, payload.expected_version)


@router.get("/campaigns/{campaign_id}/demon/evocations")
async def list_demon_evocations(campaign_id: UUID, service: SheetService = Service) -> list[Row]:
    return await service.list_demon_evocations(campaign_id)


@router.post("/campaigns/{campaign_id}/demon/evocations")
async def register_demon_evocation(
    campaign_id: UUID, payload: DemonEvocationRegister, service: SheetService = Service,
) -> Row:
    return await service.register_demon_evocation(campaign_id, EvocationRegistration(**payload.model_dump()))


@router.post("/sheets/{sheet_id}/demon/evocations/activate")
async def activate_demon_evocation(
    sheet_id: UUID, payload: DemonEvocationActivation, service: SheetService = Service,
) -> Row:
    return await service.activate_demon_evocation(
        sheet_id, payload.evocation_id, payload.operation_id, payload.expected_version,
    )
