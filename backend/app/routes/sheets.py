from __future__ import annotations

import json
import os
import re
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator

from app.services.sheet_calculations import calculate_sheet
from app.services.sheet_creation import approved_template_draft, creation_report, prepare_sheet_creation
from app.services.sheet_values import validate_sheet_values


router = APIRouter(prefix="/api/v1", tags=["sheets"])
MAX_VALUES_BYTES = 32 * 1024
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
PORTRAIT_PATH = re.compile(rf"{_UUID}/{_UUID}/{_UUID}\.webp")


class SheetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: UUID
    name: StrictStr = Field(min_length=1, max_length=120)
    values: dict[str, Any] = Field(default_factory=dict, max_length=200)
    # Required for new sheets: map pins show this photo to the whole table.
    portrait_path: StrictStr = Field(max_length=200)

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, Any]) -> dict[str, Any]:
        _check_values_size(value)
        return value

    @field_validator("portrait_path")
    @classmethod
    def portrait_shape(cls, value: str) -> str:
        if not PORTRAIT_PATH.fullmatch(value):
            raise ValueError("retrato inválido; envie a foto do personagem novamente")
        return value


def _check_portrait_owner(portrait_path: str, campaign_id: UUID, user_id: str) -> None:
    """The photo must sit in this campaign's folder and belong to the uploader."""
    campaign_part, uploader_part, _ = portrait_path.split("/", 2)
    if campaign_part != str(campaign_id) or uploader_part != user_id:
        raise HTTPException(status_code=422, detail="o retrato precisa ser enviado por você nesta campanha")


class SheetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    name: StrictStr | None = Field(default=None, min_length=1, max_length=120)
    values: dict[str, Any] | None = Field(default=None, max_length=200)

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None:
            _check_values_size(value)
        return value


class SheetAdjust(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


class ExperienceAdjust(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: int = Field(ge=-1000, le=1000)
    reason: StrictStr | None = Field(default=None, max_length=200)

    @field_validator("amount")
    @classmethod
    def nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("quantidade não pode ser zero")
        return value


class MetaCurrencySpend(ExperienceAdjust):
    """Positive amounts spend the resource; negative amounts recover it."""


# PostgreSQL error codes raised by the adjustment RPCs.
_RPC_ERRORS = {
    "42501": (403, "operação não permitida nesta ficha"),
    "23514": (422, "valor sairia do limite permitido"),
    "23505": (409, "ID da operação já foi usado para outro ajuste"),
    "22023": (422, "ajuste inválido para esta ficha"),
}


def _check_values_size(values: dict[str, Any]) -> None:
    try:
        encoded = json.dumps(values, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("valores da ficha precisam ser JSON válido") from error
    if len(encoded) > MAX_VALUES_BYTES:
        raise ValueError("valores da ficha excedem 32 KB")


async def _request(
    method: str,
    path: str,
    authorization: str | None,
    *,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="sessão necessária")

    headers = {
        "apikey": supabase_key,
        "Authorization": authorization,
        "Accept": "application/json",
    }
    if method in {"POST", "PATCH", "DELETE"}:
        headers["Prefer"] = "return=representation"
    if payload is not None:
        headers["Content-Type"] = "application/json"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.request(
                method,
                f"{supabase_url.rstrip('/')}/rest/v1/{path}",
                headers=headers,
                params=params,
                json=payload,
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error

    if response.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="sessão inválida")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="registro não encontrado")
    if response.status_code == 409:
        raise HTTPException(status_code=409, detail="conflito ao salvar a ficha")
    if response.status_code >= 400:
        # RLS may deliberately return an empty result or a database error. Do not
        # relay PostgREST internals or expose row existence to callers.
        if response.status_code == 400 and payload is not None:
            raise HTTPException(status_code=422, detail="dados da ficha rejeitados pelo Supabase")
        raise HTTPException(status_code=403, detail="operação não permitida nesta campanha")
    if not response.content:
        return []
    return response.json()


async def _rpc(name: str, authorization: str | None, payload: dict[str, Any]) -> Any:
    """Call a Supabase RPC as the user; RLS and the function checks decide access."""
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="sessão necessária")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                f"{supabase_url.rstrip('/')}/rest/v1/rpc/{name}",
                headers={"apikey": supabase_key, "Authorization": authorization, "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="sessão inválida")
    if response.status_code >= 400:
        try:
            code = response.json().get("code")
        except ValueError:
            code = None
        status, detail = _RPC_ERRORS.get(code, (403, "operação não permitida nesta campanha"))
        raise HTTPException(status_code=status, detail=detail)
    return response.json()


async def _sheet_and_template(sheet_id: UUID, authorization: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    sheet = await get_sheet(sheet_id, authorization)
    template = await _get_template(UUID(sheet["campaign_id"]), UUID(sheet["template_id"]), authorization or "")
    return sheet, template


async def _current_user_id(authorization: str | None) -> str:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="sessão necessária")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": supabase_key, "Authorization": authorization},
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="serviço de autenticação indisponível") from error
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="sessão inválida")
    try:
        return str(UUID(response.json()["id"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="sessão inválida") from error


def _template_fields(template: dict[str, Any]) -> dict[str, dict[str, Any]]:
    try:
        draft = approved_template_draft(template)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {field.id: field.model_dump(mode="json") for field in draft.fields}


def _validate_values(values: dict[str, Any], fields: dict[str, dict[str, Any]]) -> None:
    try:
        validate_sheet_values(values, fields)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


async def _get_template(campaign_id: UUID, template_id: UUID, authorization: str) -> dict[str, Any]:
    result = await _request(
        "GET",
        "system_templates",
        authorization,
        params={
            "select": "id,campaign_id,owner_id,name,version,status,schema",
            "id": f"eq.{template_id}",
            "campaign_id": f"eq.{campaign_id}",
            "status": "eq.approved",
            "limit": "1",
        },
    )
    if not result:
        raise HTTPException(status_code=404, detail="template aprovado não encontrado nesta campanha")
    return result[0]


@router.get("/campaigns/{campaign_id}/templates")
async def list_campaign_templates(
    campaign_id: UUID,
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    await _current_user_id(authorization)
    result = await _request(
        "GET",
        "system_templates",
        authorization,
        params={
            "select": "id,campaign_id,owner_id,name,version,status,schema,page_references,created_at,approved_at",
            "campaign_id": f"eq.{campaign_id}",
            "status": "eq.approved",
            "order": "name.asc,version.desc",
        },
    )
    return result


@router.get("/campaigns/{campaign_id}/sheets")
async def list_campaign_sheets(
    campaign_id: UUID,
    authorization: str | None = Header(default=None),
    owner_id: UUID | None = Query(default=None),
) -> list[dict[str, Any]]:
    await _current_user_id(authorization)
    params = {
        "select": "id,campaign_id,template_id,owner_id,name,values,version,updated_at",
        "campaign_id": f"eq.{campaign_id}",
        "order": "updated_at.desc",
    }
    if owner_id is not None:
        params["owner_id"] = f"eq.{owner_id}"
    return await _request("GET", "character_sheets", authorization, params=params)


class CreationCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: UUID
    values: dict[str, Any] = Field(default_factory=dict, max_length=200)

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, Any]) -> dict[str, Any]:
        _check_values_size(value)
        return value


@router.post("/campaigns/{campaign_id}/sheets/validate-creation")
async def validate_creation(
    campaign_id: UUID,
    payload: CreationCheck,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Checks a wizard draft against the approved template's limits and creation rules."""
    await _current_user_id(authorization)
    template = await _get_template(campaign_id, payload.template_id, authorization or "")
    try:
        errors, violations = creation_report(template, payload.values)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "valid": not errors and not violations,
        "field_errors": errors,
        "violations": [violation.model_dump() for violation in violations],
    }


@router.post("/campaigns/{campaign_id}/sheets", status_code=201)
async def create_campaign_sheet(
    campaign_id: UUID,
    payload: SheetCreate,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = await _current_user_id(authorization)
    _check_portrait_owner(payload.portrait_path, campaign_id, user_id)
    template = await _get_template(campaign_id, payload.template_id, authorization or "")
    try:
        _, sheet_name, sheet_values = prepare_sheet_creation(template, payload.name, payload.values)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    result = await _request(
        "POST",
        "character_sheets",
        authorization,
        payload={
            "campaign_id": str(campaign_id),
            "template_id": str(payload.template_id),
            "owner_id": user_id,
            "name": sheet_name,
            "values": sheet_values,
            "portrait_path": payload.portrait_path,
        },
    )
    if not result:
        raise HTTPException(status_code=403, detail="operação não permitida nesta campanha")
    return result[0]


@router.get("/sheets/{sheet_id}")
async def get_sheet(sheet_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await _current_user_id(authorization)
    result = await _request(
        "GET",
        "character_sheets",
        authorization,
        params={"select": "id,campaign_id,template_id,owner_id,name,values,version,updated_at", "id": f"eq.{sheet_id}", "limit": "1"},
    )
    if not result:
        raise HTTPException(status_code=404, detail="ficha não encontrada")
    return result[0]


@router.patch("/sheets/{sheet_id}")
async def update_sheet(
    sheet_id: UUID,
    payload: SheetUpdate,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await _current_user_id(authorization)
    changes = payload.model_dump(exclude={"expected_version"}, exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="informe nome ou valores para salvar")
    if "values" in changes and changes["values"] is not None:
        current = await get_sheet(sheet_id, authorization)
        template = await _get_template(UUID(current["campaign_id"]), UUID(current["template_id"]), authorization or "")
        _validate_values(changes["values"], _template_fields(template))
    result = await _request(
        "PATCH",
        "character_sheets",
        authorization,
        params={"id": f"eq.{sheet_id}", "version": f"eq.{payload.expected_version}"},
        payload=changes,
    )
    if not result:
        raise HTTPException(status_code=409, detail="ficha alterada ou inacessível; recarregue antes de salvar")
    return result[0]


@router.post("/sheets/{sheet_id}/adjust")
async def adjust_sheet(
    sheet_id: UUID,
    payload: SheetAdjust,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Add a delta to a number field atomically; concurrent edits never return 409."""
    await _current_user_id(authorization)
    return await _rpc(
        "adjust_sheet_number_idempotent",
        authorization,
        {"p_sheet_id": str(sheet_id), "p_operation_id": str(payload.operation_id), "p_field_id": payload.field_id, "p_delta": payload.delta, "p_reason": payload.reason},
    )


@router.post("/sheets/{sheet_id}/experience")
async def adjust_experience(
    sheet_id: UUID,
    payload: ExperienceAdjust,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Positive amounts are master-only grants; the owner spends with negative amounts."""
    await _current_user_id(authorization)
    return await _rpc(
        "increment_xp",
        authorization,
        {"p_sheet_id": str(sheet_id), "p_amount": payload.amount, "p_reason": payload.reason},
    )


@router.post("/sheets/{sheet_id}/meta-currencies/{currency_id}")
async def spend_meta_currency(
    sheet_id: UUID,
    currency_id: str,
    payload: MetaCurrencySpend,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await _current_user_id(authorization)
    sheet, template = await _sheet_and_template(sheet_id, authorization)
    try:
        draft = approved_template_draft(template)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    currency = next((item for item in draft.meta_currencies if item.id == currency_id), None)
    if currency is None:
        raise HTTPException(status_code=404, detail="recurso não existe neste modelo")
    if currency.max_field is not None:
        # Formula maxima (e.g. Willpower = Composure + Resolve) are only
        # computable here; the RPC enforces the zero floor and fixed maxima.
        delta = payload.amount if currency.mode == "track" else -payload.amount
        current = sheet["values"].get(currency.field, 0)
        inputs = {key: value for key, value in sheet["values"].items() if value is not None}
        try:
            maximum = calculate_sheet(draft, inputs).get(currency.max_field)
        except (ValueError, KeyError, ArithmeticError) as error:
            raise HTTPException(status_code=422, detail="não foi possível calcular o máximo do recurso") from error
        if isinstance(current, (int, float)) and isinstance(maximum, (int, float)) and current + delta > maximum:
            raise HTTPException(status_code=422, detail=f"{currency.label} não pode passar de {maximum}")
    return await _rpc(
        "spend_meta_currency",
        authorization,
        {"p_sheet_id": str(sheet_id), "p_currency_id": currency_id, "p_amount": payload.amount, "p_reason": payload.reason},
    )


@router.get("/sheets/{sheet_id}/events")
async def list_sheet_events(
    sheet_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    await _current_user_id(authorization)
    return await _request(
        "GET",
        "character_sheet_events",
        authorization,
        params={
            "select": "id,kind,field_id,currency_id,delta,value_before,value_after,sheet_version,actor_id,reason,created_at",
            "sheet_id": f"eq.{sheet_id}",
            "order": "id.desc",
            "limit": str(limit),
        },
    )


@router.delete("/sheets/{sheet_id}", status_code=204)
async def delete_sheet(
    sheet_id: UUID,
    expected_version: int = Query(ge=1),
    authorization: str | None = Header(default=None),
) -> None:
    await _current_user_id(authorization)
    result = await _request(
        "DELETE",
        "character_sheets",
        authorization,
        params={"id": f"eq.{sheet_id}", "version": f"eq.{expected_version}"},
    )
    if not result:
        raise HTTPException(status_code=409, detail="ficha alterada ou inacessível; recarregue antes de excluir")
