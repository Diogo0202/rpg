"""Envio do e-mail de convite de campanha.

O pedido só informa o id do convite. A RPC ``reserve_campaign_invite_email``,
chamada com o token de quem pede (RLS e auth.uid preservados), confirma que a
pessoa administra o convite, que ele é por e-mail e está pendente, aplica o
limite de reenvio e devolve destinatário, código e nomes.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException

from app.services import invite_email
from app.services.supabase_rpc import supabase_config


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/campaign-invites", tags=["campaign-invites"])

_RPC_ERRORS = {
    "42501": (403, "Só o dono ou um mestre da campanha envia este convite."),
    "22023": (422, "Este convite não tem e-mail; compartilhe o código."),
    "55000": (409, "O convite não está mais pendente."),
    "54000": (429, "Limite de 5 envios por convite atingido; compartilhe o código."),
    "54001": (429, "O convite foi enviado há menos de 5 minutos. Aguarde para reenviar."),
}


async def reserve_send(invite_id: UUID, authorization: str) -> dict[str, Any]:
    if not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    url, key = supabase_config()
    headers = {"apikey": key, "Authorization": authorization, "Accept": "application/json", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                f"{url}/rest/v1/rpc/reserve_campaign_invite_email", headers=headers, json={"p_invite_id": str(invite_id)}
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
        raise HTTPException(status_code=503, detail="não foi possível consultar o convite")
    try:
        rows = response.json()
    except ValueError as error:
        raise HTTPException(status_code=503, detail="resposta inválida do Supabase") from error
    row = rows[0] if isinstance(rows, list) and rows else rows if isinstance(rows, dict) else None
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="convite não encontrado")
    return row


@router.post("/{invite_id}/email")
async def send_invite_email(invite_id: UUID, authorization: str = Header(default="")) -> dict[str, Any]:
    # Sem provedor, nada é reservado e a interface segue com o código.
    try:
        settings = invite_email.email_settings()
    except invite_email.EmailNotConfigured as error:
        raise HTTPException(
            status_code=503,
            detail="O envio de e-mail não está configurado neste servidor. Compartilhe o código do convite.",
        ) from error
    invite = await reserve_send(invite_id, authorization)
    try:
        message = invite_email.build_invite_email(invite, settings.app_base_url)
        await invite_email.deliver(settings, message)
    except invite_email.EmailDeliveryError as error:
        # Nunca registrar o código nem o destinatário.
        logger.warning("invite e-mail delivery failed invite=%s provider=%s reason=%s", invite_id, settings.provider, error)
        raise HTTPException(
            status_code=502,
            detail="O provedor de e-mail não aceitou o envio. A tentativa foi contada; compartilhe o código se persistir.",
        ) from error
    logger.info("invite e-mail sent invite=%s provider=%s count=%s", invite_id, settings.provider, invite.get("email_sent_count"))
    return {
        "sent": True,
        "invite_id": str(invite_id),
        "email_sent_count": invite.get("email_sent_count"),
        "last_email_sent_at": invite.get("last_email_sent_at"),
    }
