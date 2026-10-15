from __future__ import annotations

import os
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query


router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}", tags=["rules"])


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


async def _authenticated_rpc(
    function: str,
    payload: dict[str, Any],
    authorization: str | None,
) -> Any:
    url, key = _supabase_config()
    token = _require_bearer(authorization)
    headers = {"apikey": key, "Authorization": token, "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            auth_response = await client.get(f"{url}/auth/v1/user", headers={"apikey": key, "Authorization": token})
            if auth_response.status_code != 200:
                raise HTTPException(status_code=401, detail="sessão inválida")
            response = await client.post(f"{url}/rest/v1/rpc/{function}", headers=headers, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error

    if response.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="acesso não permitido nesta campanha")
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail="consulta de regras rejeitada")
    return response.json() if response.content else []


@router.get("/rules/search")
async def search_campaign_rules(
    campaign_id: UUID,
    q: str = Query(min_length=2, max_length=160),
    limit: int = Query(default=5, ge=1, le=10),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="informe ao menos dois caracteres")
    return await _authenticated_rpc(
        "search_campaign_rules",
        {"p_campaign_id": str(campaign_id), "p_query": query, "p_limit": limit},
        authorization,
    )


@router.get("/sources/{source_id}/pages/{page_number}")
async def get_campaign_rule_page(
    campaign_id: UUID,
    source_id: UUID,
    page_number: int,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if page_number < 1:
        raise HTTPException(status_code=422, detail="página precisa ser positiva")
    rows = await _authenticated_rpc(
        "get_campaign_rule_page",
        {
            "p_campaign_id": str(campaign_id),
            "p_source_id": str(source_id),
            "p_page_number": page_number,
        },
        authorization,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="página aprovada não encontrada nesta campanha")
    return rows[0]
