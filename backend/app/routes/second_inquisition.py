from __future__ import annotations

import os
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

from app.services.second_inquisition import (
    EventKind,
    VerificationBasis,
    VerifiedEvent,
    assess_threat,
)


router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}/second-inquisition", tags=["second-inquisition"])
MAX_EVENTS = 1000
PAGE_SIZE = 500


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_kind: EventKind
    occurred_at: datetime
    area_id: StrictStr = Field(min_length=1, max_length=100)

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("occurred_at precisa informar o fuso horário")
        return value

    @field_validator("area_id")
    @classmethod
    def clean_area_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("informe uma área")
        return value


def _supabase_config() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    return url.rstrip("/"), key


def _require_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="sessão necessária")
    return authorization


async def _supabase_request(
    method: str,
    path: str,
    authorization: str,
    *,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    url, key = _supabase_config()
    headers = {"apikey": key, "Authorization": authorization, "Accept": "application/json"}
    if method in {"POST", "DELETE"}:
        headers["Prefer"] = "return=representation"
    if payload is not None:
        headers["Content-Type"] = "application/json"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.request(method, f"{url}/rest/v1/{path}", headers=headers, params=params, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="acesso não permitido nesta campanha")
    if response.status_code == 409:
        raise HTTPException(status_code=409, detail="conflito ao alterar a confirmação")
    if response.status_code >= 400:
        if response.status_code == 400 and payload is not None:
            raise HTTPException(status_code=422, detail="dados da confirmação rejeitados pelo Supabase")
        raise HTTPException(status_code=403, detail="operação não permitida nesta campanha")
    return response.json() if response.content else []


async def _current_user_id(authorization: str | None) -> str:
    token = _require_bearer(authorization)
    url, key = _supabase_config()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(f"{url}/auth/v1/user", headers={"apikey": key, "Authorization": token})
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="serviço de autenticação indisponível") from error
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="sessão inválida")
    try:
        return str(UUID(response.json()["id"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="sessão inválida") from error


async def _require_campaign_manager(campaign_id: UUID, authorization: str | None) -> tuple[str, str]:
    token = _require_bearer(authorization)
    user_id = await _current_user_id(token)
    campaigns = await _supabase_request(
        "GET", "campaigns", token,
        params={"select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1"},
    )
    if not campaigns:
        raise HTTPException(status_code=404, detail="campanha não encontrada")
    is_owner = campaigns[0].get("owner_id") == user_id
    members = await _supabase_request(
        "GET", "campaign_members", token,
        params={"select": "role", "campaign_id": f"eq.{campaign_id}", "user_id": f"eq.{user_id}", "limit": "1"},
    )
    is_master = bool(members and members[0].get("role") in {"master", "owner"})
    if not (is_owner or is_master):
        raise HTTPException(status_code=403, detail="somente mestre ou proprietário pode consultar confirmações")
    return token, user_id


def _verified_event(row: dict[str, Any], campaign_id: UUID) -> VerifiedEvent:
    if row.get("campaign_id") != str(campaign_id):
        raise ValueError("evento retornado fora da campanha solicitada")
    occurred_at = _parse_timestamp(row["occurred_at"])
    verified_at = _parse_timestamp(row["verified_at"])
    return VerifiedEvent(
        event_id=str(row["id"]),
        campaign_id=str(campaign_id),
        event_kind=EventKind(row["event_kind"]),
        occurred_at=occurred_at,
        area_id=row["area_id"],
        verification_basis=VerificationBasis.NARRATOR_CONFIRMATION,
        verified_at=verified_at,
    )


def _parse_timestamp(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp de evento inválido")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp de evento sem fuso horário")
    return parsed


async def _read_all_events(campaign_id: UUID, authorization: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = await _supabase_request(
            "GET", "second_inquisition_events", authorization,
            params={
                "select": "id,campaign_id,event_kind,area_id,occurred_at,verified_at,created_by,version",
                "campaign_id": f"eq.{campaign_id}",
                "order": "verified_at.asc,id.asc",
                "limit": str(PAGE_SIZE),
                "offset": str(offset),
            },
        )
        if not isinstance(page, list):
            raise HTTPException(status_code=502, detail="resposta inválida ao ler eventos")
        events.extend(page)
        if len(events) > MAX_EVENTS:
            raise HTTPException(status_code=413, detail="esta campanha excede 1000 eventos; avaliação cancelada sem truncar dados")
        if len(page) < PAGE_SIZE:
            return events
        offset += PAGE_SIZE


@router.get("")
async def get_campaign_assessment(
    campaign_id: UUID,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    token, _ = await _require_campaign_manager(campaign_id, authorization)
    rows = await _read_all_events(campaign_id, token)
    try:
        events = [_verified_event(row, campaign_id) for row in rows]
        assessment = assess_threat(str(campaign_id), events)
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=409, detail="eventos confirmados inválidos; avaliação cancelada") from error
    return {"events": rows, "assessment": assessment.model_dump(mode="json")}


@router.post("", status_code=201)
async def confirm_campaign_event(
    campaign_id: UUID,
    payload: EventCreate,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    token, _ = await _require_campaign_manager(campaign_id, authorization)
    if len(await _read_all_events(campaign_id, token)) >= MAX_EVENTS:
        raise HTTPException(status_code=413, detail="limite de 1000 eventos alcançado; retire uma confirmação antes de registrar outra")
    rows = await _supabase_request(
        "POST", "second_inquisition_events", token,
        payload={
            "campaign_id": str(campaign_id),
            "event_kind": payload.event_kind.value,
            "area_id": payload.area_id,
            "occurred_at": payload.occurred_at.isoformat(),
        },
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=502, detail="Supabase não retornou a confirmação criada")
    return rows[0]


@router.delete("/{event_id}", status_code=204)
async def revoke_campaign_event(
    campaign_id: UUID,
    event_id: UUID,
    expected_version: int = Query(ge=1),
    authorization: str | None = Header(default=None),
) -> None:
    token, _ = await _require_campaign_manager(campaign_id, authorization)
    rows = await _supabase_request(
        "DELETE", "second_inquisition_events", token,
        params={
            "id": f"eq.{event_id}",
            "campaign_id": f"eq.{campaign_id}",
            "version": f"eq.{expected_version}",
            "select": "id",
        },
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=409, detail="evento alterado ou indisponível; atualize antes de retirar a confirmação")
