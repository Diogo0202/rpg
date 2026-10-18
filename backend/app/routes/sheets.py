from __future__ import annotations

import json
import os
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator

from app.services.sheet_creation import prepare_sheet_creation
from app.services.sheet_values import validate_sheet_values


router = APIRouter(prefix="/api/v1", tags=["sheets"])
MAX_VALUES_BYTES = 32 * 1024


class SheetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: UUID
    name: StrictStr = Field(min_length=1, max_length=120)
    values: dict[str, Any] = Field(default_factory=dict, max_length=200)

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, Any]) -> dict[str, Any]:
        _check_values_size(value)
        return value


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
    schema = template.get("schema")
    if not isinstance(schema, dict) or not isinstance(schema.get("fields"), list):
        raise HTTPException(status_code=422, detail="template não possui campos modulares válidos")
    fields: dict[str, dict[str, Any]] = {}
    for field in schema["fields"]:
        if isinstance(field, dict) and isinstance(field.get("id"), str):
            fields[field["id"]] = field
    if len(fields) != len(schema["fields"]):
        raise HTTPException(status_code=422, detail="template contém campos inválidos")
    return fields


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


@router.post("/campaigns/{campaign_id}/sheets", status_code=201)
async def create_campaign_sheet(
    campaign_id: UUID,
    payload: SheetCreate,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = await _current_user_id(authorization)
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
