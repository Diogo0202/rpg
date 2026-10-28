"""Sala de voz da campanha no Discord.

``POST /api/v1/campaigns/{id}/voice-session``: a RPC ``request_campaign_voice_session``, chamada
com o token de quem pede, confirma dono/mestre no banco e decide se há convite válido para
reaproveitar ou pedido em andamento. Só quando ela devolve ``should_create`` a criação no Discord
é agendada em ``BackgroundTasks``. ``GET /api/v1/voice-sessions/config`` diz se o recurso está
configurado, para a interface esconder o botão.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Response

from app.services import discord_voice
from app.services.supabase_rpc import supabase_config


router = APIRouter(prefix="/api/v1", tags=["voice-sessions"])

_NOT_CONFIGURED = "A sala de voz no Discord não está configurada neste servidor."
_RPC_ERRORS = {
    "42501": (403, "Só o dono ou um mestre da campanha cria a sala de voz."),
}


async def request_session(campaign_id: UUID, authorization: str) -> dict[str, Any]:
    if not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    url, key = supabase_config()
    headers = {"apikey": key, "Authorization": authorization, "Accept": "application/json", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                f"{url}/rest/v1/rpc/request_campaign_voice_session", headers=headers, json={"p_campaign_id": str(campaign_id)}
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = None
        code = body.get("code") if isinstance(body, dict) else None
        if code in _RPC_ERRORS:
            status, detail = _RPC_ERRORS[code]
            raise HTTPException(status_code=status, detail=detail)
        if response.status_code in (401, 403):
            raise HTTPException(status_code=403, detail=_RPC_ERRORS["42501"][1])
        raise HTTPException(status_code=503, detail="não foi possível consultar a sala de voz")
    try:
        rows = response.json()
    except ValueError as error:
        raise HTTPException(status_code=503, detail="resposta inválida do Supabase") from error
    row = rows[0] if isinstance(rows, list) and rows else rows if isinstance(rows, dict) else None
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="campanha não encontrada")
    return row


@router.get("/voice-sessions/config")
def voice_config() -> dict[str, bool]:
    return {"enabled": discord_voice.voice_enabled()}


@router.post("/campaigns/{campaign_id}/voice-session")
async def create_voice_session(
    campaign_id: UUID,
    background_tasks: BackgroundTasks,
    response: Response,
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    # Sem configuração nada é reservado no banco.
    try:
        settings = discord_voice.voice_settings()
    except discord_voice.VoiceNotConfigured as error:
        raise HTTPException(status_code=503, detail=_NOT_CONFIGURED) from error
    row = await request_session(campaign_id, authorization)
    scheduled = bool(row.get("should_create"))
    if scheduled:
        background_tasks.add_task(
            discord_voice.provision_voice_room, settings, str(campaign_id), row.get("campaign_name"), row.get("channel_id")
        )
        response.status_code = 202
    return {
        "campaign_id": str(campaign_id),
        "status": row.get("status") or "pending",
        "invite_url": row.get("invite_url") if row.get("status") == "ready" else None,
        "expires_at": row.get("expires_at") if row.get("status") == "ready" else None,
        "scheduled": scheduled,
    }
