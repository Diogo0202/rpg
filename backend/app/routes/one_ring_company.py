"""Campaign level company state for The One Ring."""

from __future__ import annotations

import os
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.services.one_ring_creation import catalog

router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}/one-ring/company", tags=["one-ring-company"])


class CompanyCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    expected_version: StrictInt = Field(ge=0)
    kind: Literal["create", "configure", "add_member", "remove_member", "set_focus", "spend", "restore", "reset_session"]
    payload: dict[str, Any] = Field(max_length=20)


def _validate_payload(command: CompanyCommand) -> dict[str, Any]:
    p = command.payload
    keys: dict[str, set[str]] = {
        "create": {"name", "patron_id", "safe_havens"}, "configure": {"name", "patron_id", "safe_havens"},
        "add_member": {"sheet_id"}, "remove_member": {"sheet_id"},
        "set_focus": {"source_sheet_id", "target_sheet_id"}, "spend": {"amount", "reason"},
        "restore": {"amount", "reason"}, "reset_session": {"session_id"},
    }
    if set(p) != keys[command.kind]:
        raise HTTPException(status_code=422, detail="payload incompatível com o comando")
    if command.kind in {"create", "configure"}:
        if not isinstance(p["name"], str) or not 1 <= len(p["name"]) <= 120:
            raise HTTPException(status_code=422, detail="nome inválido")
        if p["patron_id"] is not None and (not isinstance(p["patron_id"], str) or p["patron_id"] not in {item["id"] for item in catalog()["patrons"]}):
            raise HTTPException(status_code=422, detail="patrono inválido")
        if not isinstance(p["safe_havens"], list) or len(p["safe_havens"]) > 30 or any(not isinstance(x, str) or not 1 <= len(x) <= 120 for x in p["safe_havens"]):
            raise HTTPException(status_code=422, detail="refúgios inválidos")
    elif command.kind in {"add_member", "remove_member"}:
        try:
            p["sheet_id"] = str(UUID(p["sheet_id"]))
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status_code=422, detail="ficha inválida")
    elif command.kind == "set_focus":
        try:
            p["source_sheet_id"] = str(UUID(p["source_sheet_id"]))
            p["target_sheet_id"] = str(UUID(p["target_sheet_id"])) if p["target_sheet_id"] is not None else None
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status_code=422, detail="foco inválido")
    elif command.kind in {"spend", "restore"}:
        if type(p["amount"]) is not int or not 1 <= p["amount"] <= 10000 or not isinstance(p["reason"], str) or not 1 <= len(p["reason"]) <= 200:
            raise HTTPException(status_code=422, detail="gasto inválido")
    elif command.kind == "reset_session":
        try:
            p["session_id"] = str(UUID(p["session_id"]))
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status_code=422, detail="sessão inválida")
    return p


async def _rpc(name: str, campaign_id: UUID, authorization: str | None, payload: dict[str, Any]) -> Any:
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(f"{url.rstrip('/')}/rest/v1/rpc/{name}",
                headers={"apikey": key, "Authorization": authorization, "Content-Type": "application/json"}, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code >= 400:
        try:
            code = response.json().get("code")
        except (ValueError, AttributeError):
            code = None
        statuses = {"42501": (403, "operação não permitida nesta campanha"), "40001": (409, "a companhia mudou; recarregue e tente de novo"),
                    "23505": (409, "ID de operação já usado com outro pedido"), "22023": (422, "comando inválido para esta companhia"), "23514": (422, "saldo ou foco inválido para esta companhia"), "P0002": (404, "campanha ou sessão não encontrada")}
        status, detail = statuses.get(code, (503, "não foi possível concluir a operação no Supabase"))
        raise HTTPException(status_code=status, detail=detail)
    try:
        return response.json() if response.content else None
    except ValueError as error:
        raise HTTPException(status_code=503, detail="resposta inválida do Supabase") from error


@router.get("")
async def get_company(campaign_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    return await _rpc("one_ring_company_snapshot", campaign_id, authorization, {"p_campaign_id": str(campaign_id)})


@router.post("/commands")
async def company_command(campaign_id: UUID, command: CompanyCommand, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    payload = _validate_payload(command)
    return await _rpc("one_ring_company_command", campaign_id, authorization, {
        "p_campaign_id": str(campaign_id), "p_operation_id": str(command.operation_id),
        "p_expected_version": command.expected_version, "p_kind": command.kind, "p_payload": payload,
    })
