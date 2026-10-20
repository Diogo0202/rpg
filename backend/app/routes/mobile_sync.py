from __future__ import annotations

import json
import os
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import ValidationError

from app.services.mobile_sync import (
    ENTITY_FIELDS,
    MAX_SAFE_INTEGER,
    MAX_PAGE_SIZE,
    PROTOCOL_VERSION,
    SyncPushRequest,
    allowed_record_fields,
    strict_int,
    validate_json_value,
)


router = APIRouter(prefix="/api/v1", tags=["mobile-sync"])
_CAMPAIGN_FIELDS = {"id", "owner_id", "name", "description", "updated_at"}
_RESULT_STATUSES = {"applied", "duplicate", "conflict", "denied", "invalid", "dependency_failed"}
_CAMPAIGN_ROLES = {"owner", "master", "player", "guest"}


def _reject_json_constant(value: str):
    raise ValueError(f"valor JSON inválido: {value}")


def _verified_session(request: Request, authorization: str | None) -> dict[str, Any]:
    user = getattr(request.state, "supabase_user", None)
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="sessão necessária")
    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        raise HTTPException(status_code=401, detail="sessão verificada necessária")
    try:
        user["id"] = str(UUID(user["id"]))
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="sessão verificada necessária") from error
    return user


def _config() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    return url.rstrip("/"), key


async def _upstream(method: str, path: str, authorization: str, *, params=None, payload=None) -> Any:
    url, key = _config()
    headers = {"apikey": key, "Authorization": authorization, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.request(method, f"{url}/rest/v1/{path}", headers=headers, params=params, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code in {401, 403}:
        raise HTTPException(status_code=403, detail="acesso não permitido nesta campanha")
    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="limite do Supabase excedido", headers={"Retry-After": response.headers.get("Retry-After", "1")})
    if response.status_code >= 500:
        raise HTTPException(status_code=503, detail="Supabase indisponível")
    if response.status_code >= 400:
        raise HTTPException(status_code=403, detail="operação não permitida nesta campanha")
    if not response.content or len(response.content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=502, detail="resposta inválida do serviço de sincronização")
    try:
        return json.loads(response.content, parse_constant=_reject_json_constant)
    except (ValueError, TypeError, UnicodeDecodeError) as error:
        raise HTTPException(status_code=502, detail="resposta inválida do serviço de sincronização") from error


def _rpc_payload(value: Any, validator, *, label: str) -> dict[str, Any]:
    try:
        parsed = validator(value)
    except (ValidationError, ValueError, TypeError, KeyError, AttributeError, OverflowError) as error:
        raise HTTPException(status_code=502, detail=f"resposta inválida de {label}") from error
    return parsed


def _campaign_row(row: Any) -> dict[str, Any]:
    if type(row) is not dict or set(row) - _CAMPAIGN_FIELDS or not {"id", "owner_id", "name", "description", "updated_at"} <= set(row):
        raise ValueError("campanha inválida")
    UUID(row["id"])
    UUID(row["owner_id"])
    if not all(type(row[key]) is str for key in ("name", "description", "updated_at")):
        raise ValueError("campanha inválida")
    return row


def _check_record(record: Any, entity_type: str | None = None, campaign_id: UUID | None = None) -> dict[str, Any]:
    if type(record) is not dict or set(record) != {"entity_type", "entity_id", "version", "data"}:
        raise ValueError("record inválido")
    kind = record["entity_type"]
    if type(kind) is not str or kind not in ENTITY_FIELDS or (entity_type is not None and kind != entity_type):
        raise ValueError("entity_type inválido")
    UUID(record["entity_id"])
    strict_int(record["version"], minimum=1, maximum=MAX_SAFE_INTEGER, label="version")
    data = record["data"]
    if type(data) is not dict or set(data) != allowed_record_fields(kind):
        raise ValueError("dados do record inválidos")
    validate_json_value(data)
    if "id" not in data or UUID(data["id"]) != UUID(record["entity_id"]):
        raise ValueError("ID do record inválido")
    if kind != "campaigns" and "campaign_id" not in data:
        raise ValueError("vínculo da campanha ausente")
    if campaign_id is not None and "campaign_id" in data and UUID(data["campaign_id"]) != campaign_id:
        raise ValueError("record fora da campanha solicitada")
    if campaign_id is not None and kind == "campaigns" and UUID(record["entity_id"]) != campaign_id:
        raise ValueError("campanha do record inválida")
    return record


def _push_response(value: Any, campaign_id: UUID, operations) -> dict[str, Any]:
    if type(value) is not dict or set(value) != {"protocol_version", "campaign_id", "cursor", "results"}:
        raise ValueError("envelope inválido")
    if type(value["protocol_version"]) is not int or value["protocol_version"] != PROTOCOL_VERSION:
        raise ValueError("versão inválida")
    if UUID(value["campaign_id"]) != campaign_id:
        raise ValueError("campanha inválida")
    strict_int(value["cursor"], minimum=0, maximum=MAX_SAFE_INTEGER, label="cursor")
    if type(value["results"]) is not list or len(value["results"]) > 50 or len(value["results"]) != len(operations):
        raise ValueError("resultados inválidos")
    checked = []
    for index, result in enumerate(value["results"]):
        if type(result) is not dict or set(result) - {"operation_id", "status", "record", "conflict_paths", "message"}:
            raise ValueError("resultado inválido")
        operation = operations[index]
        if str(UUID(result["operation_id"])) != str(operation.operation_id):
            raise ValueError("ordem ou operation_id inválido")
        if result.get("status") not in _RESULT_STATUSES:
            raise ValueError("status inválido")
        output = {"operation_id": result["operation_id"], "status": result["status"]}
        if "record" in result:
            record = _check_record(result["record"], campaign_id=campaign_id)
            if record["entity_type"] != operation.entity_type or UUID(record["entity_id"]) != operation.entity_id:
                raise ValueError("record não corresponde à operação")
            output["record"] = record
        if "conflict_paths" in result:
            paths = result["conflict_paths"]
            if type(paths) is not list or len(paths) > 200 or any(type(path) is not list or not 1 <= len(path) <= 12 or any(type(part) is not str or not part or part.strip() != part or part.isdecimal() or part.lower() in {"__proto__", "prototype", "constructor"} for part in path) for path in paths):
                raise ValueError("conflict_paths inválido")
            output["conflict_paths"] = paths
        if "message" in result:
            if type(result["message"]) is not str or len(result["message"]) > 500:
                raise ValueError("message inválida")
            output["message"] = result["message"]
        checked.append(output)
    return {"protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id), "cursor": value["cursor"], "results": checked}


def _page_response(value: Any, campaign_id: UUID, *, snapshot: bool, entity_type: str | None = None) -> dict[str, Any]:
    common = {"protocol_version", "campaign_id", "cursor", "has_more"}
    extra = {"records", "next_after_id"} if snapshot else {"changes"}
    if type(value) is not dict or set(value) != common | extra:
        raise ValueError("envelope inválido")
    if type(value["protocol_version"]) is not int or value["protocol_version"] != PROTOCOL_VERSION or UUID(value["campaign_id"]) != campaign_id:
        raise ValueError("versão ou campanha inválida")
    strict_int(value["cursor"], minimum=0, maximum=MAX_SAFE_INTEGER, label="cursor")
    if type(value["has_more"]) is not bool:
        raise ValueError("has_more inválido")
    if snapshot:
        records = value["records"]
        if type(records) is not list or len(records) > MAX_PAGE_SIZE:
            raise ValueError("records inválido")
        checked_records = [_check_record(record, entity_type, campaign_id) for record in records]
        after = value["next_after_id"]
        if after is not None:
            UUID(after)
        if checked_records and UUID(after) != UUID(checked_records[-1]["entity_id"]):
            raise ValueError("next_after_id não corresponde à última linha")
        if value["has_more"] and (not checked_records or after is None):
            raise ValueError("cursor da página inválido")
        return {"protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id), "cursor": value["cursor"], "has_more": value["has_more"], "next_after_id": after, "records": checked_records}
    changes = value["changes"]
    if type(changes) is not list or len(changes) > MAX_PAGE_SIZE:
        raise ValueError("changes inválido")
    checked_changes = []
    for change in changes:
        if type(change) is not dict or set(change) - {"revision", "version", "entity_type", "entity_id", "action", "record", "tombstone"}:
            raise ValueError("change inválido")
        revision = strict_int(change.get("revision"), minimum=1, maximum=MAX_SAFE_INTEGER, label="revision")
        if revision > value["cursor"] or (checked_changes and revision <= checked_changes[-1]["revision"]):
            raise ValueError("revisões fora de ordem ou além do cursor")
        version = strict_int(change.get("version"), minimum=1, maximum=MAX_SAFE_INTEGER, label="version")
        kind = change.get("entity_type")
        if type(kind) is not str or kind not in ENTITY_FIELDS:
            raise ValueError("entity_type inválido")
        UUID(change.get("entity_id"))
        if change.get("action") not in {"create", "update", "delete"}:
            raise ValueError("action inválida")
        if "record" in change:
            record = _check_record(change["record"], kind, campaign_id)
            if record["version"] < version or UUID(record["entity_id"]) != UUID(change["entity_id"]):
                raise ValueError("versão do record anterior à mudança")
        action = change["action"]
        if action == "delete":
            if change.get("tombstone") is not True or "record" in change:
                raise ValueError("tombstone inválido")
        elif "record" not in change or "tombstone" in change:
            raise ValueError("record de mudança ausente ou tombstone inesperado")
        checked_changes.append(change)
    return {"protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id), "cursor": value["cursor"], "has_more": value["has_more"], "changes": checked_changes}


@router.get("/sync/campaigns")
async def list_sync_campaigns(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _verified_session(request, authorization)
    rows = await _upstream(
        "GET", "campaigns", authorization or "",
        params={"select": "id,owner_id,name,description,updated_at", "order": "updated_at.desc"},
    )
    try:
        if type(rows) is not list or len(rows) > 500:
            raise ValueError("lista inválida")
        campaigns = [_campaign_row(row) for row in rows]
    except (ValueError, TypeError, AttributeError, OverflowError) as error:
        raise HTTPException(status_code=502, detail="resposta inválida de campanhas") from error
    return {"protocol_version": PROTOCOL_VERSION, "campaigns": campaigns}


@router.get("/campaigns/{campaign_id}/sync/capabilities")
async def get_sync_capabilities(campaign_id: UUID, request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = _verified_session(request, authorization)
    headers = authorization or ""
    campaigns = await _upstream(
        "GET", "campaigns", headers,
        params={"select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1"},
    )
    if type(campaigns) is not list or len(campaigns) > 1:
        raise HTTPException(status_code=502, detail="resposta inválida de campanhas")
    if not campaigns:
        raise HTTPException(status_code=403, detail="acesso não permitido nesta campanha")
    campaign = campaigns[0]
    try:
        if type(campaign) is not dict or set(campaign) != {"id", "owner_id"} or UUID(campaign["id"]) != campaign_id:
            raise ValueError("campanha inválida")
        owner_id = UUID(campaign["owner_id"])
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise HTTPException(status_code=502, detail="resposta inválida de campanhas") from error

    if owner_id == UUID(user["id"]):
        role = "owner"
    else:
        memberships = await _upstream(
            "GET", "campaign_members", headers,
            params={"select": "role", "campaign_id": f"eq.{campaign_id}", "user_id": f"eq.{user['id']}", "limit": "1"},
        )
        if type(memberships) is not list or len(memberships) > 1:
            raise HTTPException(status_code=502, detail="resposta inválida de membros")
        if not memberships:
            raise HTTPException(status_code=403, detail="acesso não permitido nesta campanha")
        member = memberships[0]
        if type(member) is not dict or set(member) != {"role"} or type(member["role"]) is not str or member["role"] not in _CAMPAIGN_ROLES - {"owner"}:
            raise HTTPException(status_code=502, detail="resposta inválida de membros")
        role = member["role"]

    manager = role in {"owner", "master"}
    player = role == "player"
    writable = {}
    if role == "owner":
        writable["campaigns"] = sorted(ENTITY_FIELDS["campaigns"])
    if manager:
        for entity_type, fields in ENTITY_FIELDS.items():
            if entity_type not in {"campaigns", "character_sheets", "character_inventory"}:
                writable[entity_type] = sorted(fields)
    if manager or player:
        for entity_type in ("character_sheets", "character_inventory"):
            writable[entity_type] = sorted(ENTITY_FIELDS[entity_type])
    return {"protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id), "role": role, "entity_fields": writable}


@router.post("/campaigns/{campaign_id}/sync/push")
async def push_sync(campaign_id: UUID, payload: SyncPushRequest, request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _verified_session(request, authorization)
    response = await _upstream(
        "POST", "rpc/mobile_sync_push", authorization or "",
        payload={"p_campaign_id": str(campaign_id), "p_device_id": str(payload.device_id), "p_mutations": [item.model_dump(mode="json", exclude_unset=True) for item in payload.mutations]},
    )
    return _rpc_payload(response, lambda data: _push_response(data, campaign_id, payload.mutations), label="push")


@router.get("/campaigns/{campaign_id}/sync/snapshot")
async def get_sync_snapshot(
    campaign_id: UUID,
    request: Request,
    entity_type: str = Query(min_length=1, max_length=64),
    after_id: UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=MAX_PAGE_SIZE),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _verified_session(request, authorization)
    if entity_type not in ENTITY_FIELDS:
        raise HTTPException(status_code=422, detail="entidade não aceita sincronização")
    response = await _upstream("POST", "rpc/mobile_sync_snapshot", authorization or "", payload={"p_campaign_id": str(campaign_id), "p_entity_type": entity_type, "p_after_id": str(after_id) if after_id else None, "p_limit": limit})
    return _rpc_payload(response, lambda data: _page_response(data, campaign_id, snapshot=True, entity_type=entity_type), label="snapshot")


@router.get("/campaigns/{campaign_id}/sync/changes")
async def get_sync_changes(
    campaign_id: UUID,
    request: Request,
    cursor: int = Query(ge=0, le=MAX_SAFE_INTEGER),
    limit: int = Query(default=100, ge=1, le=MAX_PAGE_SIZE),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _verified_session(request, authorization)
    response = await _upstream("POST", "rpc/mobile_sync_changes", authorization or "", payload={"p_campaign_id": str(campaign_id), "p_cursor": cursor, "p_limit": limit})
    return _rpc_payload(response, lambda data: _page_response(data, campaign_id, snapshot=False), label="changes")
