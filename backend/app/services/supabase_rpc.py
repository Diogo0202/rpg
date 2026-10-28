"""Chamada de funcoes RPC do Supabase com o token do usuario (RLS e auth.uid preservados)."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException


_SQLSTATE_STATUS = {
    "42501": (403, "operação não permitida nesta campanha"),
    "P0002": (404, "combate não encontrado nesta campanha"),
    "55000": (409, "o combate já foi encerrado"),
    "54000": (409, "o combate atingiu o limite de 50 participantes"),
    "22023": (422, "dados rejeitados pelo banco"),
    # V3 (v3_* RPCs): limits of the sheet (blood per turn, Willpower left) and a reused operation id.
    "23514": (422, "limite da ficha atingido (sangue, sangue por turno ou Força de Vontade)"),
    "23505": (409, "operação já usada para outro ajuste"),
}


def supabase_config() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    return url.rstrip("/"), key


async def call_rpc(function: str, authorization: str, payload: dict[str, Any], *, timeout: float = 8) -> Any:
    """Executa ``/rest/v1/rpc/<function>`` e traduz erros SQL em respostas HTTP."""
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    url, key = supabase_config()
    headers = {"apikey": key, "Authorization": authorization, "Accept": "application/json", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(f"{url}/rest/v1/rpc/{function}", headers=headers, json=payload)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code >= 400:
        code = None
        try:
            body = response.json()
            code = body.get("code") if isinstance(body, dict) else None
        except ValueError:
            pass
        if code in _SQLSTATE_STATUS:
            status, detail = _SQLSTATE_STATUS[code]
            raise HTTPException(status_code=status, detail=detail)
        if response.status_code in (401, 403):
            raise HTTPException(status_code=403, detail="operação não permitida nesta campanha")
        raise HTTPException(status_code=503, detail="não foi possível concluir a operação no Supabase")
    try:
        return response.json() if response.content else None
    except ValueError as error:
        raise HTTPException(status_code=503, detail="resposta inválida do Supabase") from error
