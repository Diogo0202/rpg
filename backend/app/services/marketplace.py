from __future__ import annotations

import os
from typing import Any
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, ValidationError, field_validator

from app.models import TemplateDraft
from app.services.templates import validate_template
from app.services.system_schema import normalize_template_document


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template: TemplateDraft
    description: StrictStr = Field(min_length=1, max_length=2000)
    tags: list[StrictStr] = Field(min_length=1, max_length=20)
    author_name: StrictStr = Field(min_length=1, max_length=80)
    dependencies: list[StrictStr] = Field(default_factory=list, max_length=30)
    rights_confirmed: StrictBool

    @field_validator("template", mode="before")
    @classmethod
    def reject_unknown_schema_properties(cls, value: Any) -> Any:
        return normalize_template_document(value)

    @field_validator("tags")
    @classmethod
    def normalized_unique_tags(cls, tags: list[str]) -> list[str]:
        normalized = [tag.strip() for tag in tags]
        if any(not tag or len(tag) > 40 for tag in normalized):
            raise ValueError("cada tag deve ter entre 1 e 40 caracteres")
        if len({tag.casefold() for tag in normalized}) != len(normalized):
            raise ValueError("tags repetidas não são aceitas")
        return normalized

    @field_validator("dependencies")
    @classmethod
    def normalized_dependencies(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 120 for value in normalized):
            raise ValueError("cada dependência deve ter entre 1 e 120 caracteres")
        if len({value.casefold() for value in normalized}) != len(normalized):
            raise ValueError("dependências repetidas não são aceitas")
        return normalized

    @field_validator("description", "author_name")
    @classmethod
    def trimmed_text(cls, value: str) -> str:
        result = value.strip()
        if not result:
            raise ValueError("o campo não pode ficar vazio")
        return result


def validate_publication(payload: PublishRequest) -> dict[str, Any]:
    """Apply strict recursive shape checks, then the shared template validator."""
    raw_template = payload.template.model_dump(mode="json")
    try:
        draft = validate_template(TemplateDraft.model_validate(raw_template))
    except (ValueError, ValidationError) as error:
        raise HTTPException(status_code=422, detail="modelo inválido para publicação") from error
    if payload.rights_confirmed is not True:
        raise HTTPException(status_code=422, detail="confirme os direitos para publicar")
    schema_value = draft.model_dump(mode="json")
    automation_level = "formulas" if any(field.kind.value in {"formula", "roll"} for field in draft.fields) else "static"
    return {
        "name": draft.name,
        "description": payload.description,
        "tags": payload.tags,
        "author_name": payload.author_name,
        "dependencies": payload.dependencies,
        "automation_level": automation_level,
        "template": schema_value,
    }


def _config() -> tuple[str, str]:
    base = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not base or not key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    return base.rstrip("/"), key


async def current_user_id(authorization: str | None) -> str:
    base, key = _config()
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(f"{base}/auth/v1/user", headers={"apikey": key, "Authorization": authorization})
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="serviço de autenticação indisponível") from error
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="sessão inválida")
    try:
        return str(UUID(response.json()["id"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="sessão inválida") from error


async def request_public(method: str, path: str, *, params: dict[str, str] | None = None, payload: dict[str, Any] | None = None) -> Any:
    base, key = _config()
    headers = {"apikey": key, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if method in {"POST", "PATCH", "DELETE"}:
        headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.request(method, f"{base}/rest/v1/{path}", headers=headers, params=params, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="sistema não encontrado")
    if response.status_code >= 400:
        raise HTTPException(status_code=503 if response.status_code >= 500 else 403, detail="operação não permitida")
    return response.json() if response.content else []


async def request_user(method: str, path: str, authorization: str | None, *, payload: dict[str, Any] | None = None) -> Any:
    base, key = _config()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="sessão necessária")
    headers = {"apikey": key, "Authorization": authorization, "Accept": "application/json", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(f"{base}/rest/v1/{path}", headers=headers, json=payload or {})
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="sessão inválida")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="sistema ou campanha não encontrado")
    if response.status_code >= 400:
        try:
            code = response.json().get("code")
        except ValueError:
            code = None
        if code in {"42501", "P0001"}:
            raise HTTPException(status_code=403, detail="operação não permitida")
        if code == "22023":
            raise HTTPException(status_code=409, detail="chave repetida com dados diferentes ou operação inválida")
        raise HTTPException(status_code=403, detail="operação não permitida")
    return response.json() if response.content else None


async def publish_as_service(owner_id: str, record: dict[str, Any]) -> dict[str, Any]:
    base, _ = _config()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="publicação indisponível")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=representation", "Content-Type": "application/json"}
    body = {**record, "owner_id": owner_id, "status": "published"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(f"{base}/rest/v1/marketplace_systems", headers=headers, json=body)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="publicação indisponível") from error
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="não foi possível publicar o sistema")
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=503, detail="resposta inválida na publicação")
    return rows[0]
