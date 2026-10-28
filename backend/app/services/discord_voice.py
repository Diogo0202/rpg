"""Sala de voz da sessão no Discord pela REST API v10, sem bot WebSocket.

Fluxo: cria (ou reaproveita) um canal de voz no servidor configurado e gera um convite. O
resultado é gravado em ``campaign_voice_sessions`` com a chave de serviço do Supabase e um sinal
``voice`` é publicado no canal privado ``campaign:<id>:live`` (o cliente relê a tabela pela RLS).

O token do bot só vai no cabeçalho ``Authorization`` das chamadas ao Discord. Ele nunca entra em
logs, erros gravados no banco ou respostas.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx


logger = logging.getLogger(__name__)

DISCORD_API = "https://discord.com/api/v10"
VOICE_CHANNEL_TYPE = 2
MAX_RETRY_AFTER_SECONDS = 10.0
_SNOWFLAKE = re.compile(r"^[0-9]{5,25}$")
_INVITE_CODE = re.compile(r"^[A-Za-z0-9-]{2,32}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

# Substituível nos testes para não esperar de verdade.
sleep = asyncio.sleep


class VoiceNotConfigured(Exception):
    """Faltam variáveis do Discord ou a chave de serviço do Supabase."""


class DiscordError(Exception):
    """Falha resumida, sem segredos, própria para gravar em ``error``."""

    def __init__(self, summary: str, status: int | None = None):
        super().__init__(summary)
        self.summary = summary[:200]
        self.status = status


@dataclass(frozen=True)
class VoiceSettings:
    guild_id: str
    category_id: str | None
    invite_max_age: int
    invite_max_uses: int
    supabase_url: str
    bot_token: str = field(repr=False)
    service_key: str = field(repr=False)


def _int_env(name: str, default: int, low: int, high: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise VoiceNotConfigured() from error
    if not low <= value <= high:
        raise VoiceNotConfigured()
    return value


def voice_settings() -> VoiceSettings:
    token = os.getenv("DISCORD_BOT_TOKEN", "").strip()
    guild = os.getenv("DISCORD_GUILD_ID", "").strip()
    category = os.getenv("DISCORD_VOICE_CATEGORY_ID", "").strip() or None
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not token or not _SNOWFLAKE.fullmatch(guild) or not url or not service_key:
        raise VoiceNotConfigured()
    if _CONTROL.search(token) or (category is not None and not _SNOWFLAKE.fullmatch(category)):
        raise VoiceNotConfigured()
    return VoiceSettings(
        guild_id=guild,
        category_id=category,
        # Discord aceita 0 (sem expiração) até 7 dias; max_uses 0 (ilimitado) até 100.
        invite_max_age=_int_env("DISCORD_INVITE_MAX_AGE", 86400, 0, 604800),
        invite_max_uses=_int_env("DISCORD_INVITE_MAX_USES", 0, 0, 100),
        supabase_url=url,
        bot_token=token,
        service_key=service_key,
    )


def voice_enabled() -> bool:
    try:
        voice_settings()
    except VoiceNotConfigured:
        return False
    return True


def channel_name(campaign_name: Any) -> str:
    text = _CONTROL.sub(" ", str(campaign_name or ""))
    text = re.sub(r"\s+", " ", text).strip()[:80]
    return f"Mesa {text}" if text else "Mesa da campanha"


def _retry_after(response: httpx.Response) -> float | None:
    value: Any = None
    try:
        body = response.json()
        if isinstance(body, dict):
            value = body.get("retry_after")
    except ValueError:
        pass
    if value is None:
        value = response.headers.get("Retry-After")
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    return seconds if seconds >= 0 else None


async def discord_request(client: httpx.AsyncClient, settings: VoiceSettings, method: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Uma chamada ao Discord com no máximo uma nova tentativa após 429."""
    headers = {
        "Authorization": f"Bot {settings.bot_token}",
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/rpg-atlas, 1.0)",
        "X-Audit-Log-Reason": "RPG Atlas: sala de voz da campanha",
    }
    for attempt in (1, 2):
        try:
            response = await client.request(method, f"{DISCORD_API}{path}", headers=headers, json=payload)
        except httpx.TimeoutException as error:
            raise DiscordError("o Discord não respondeu a tempo") from error
        except httpx.HTTPError as error:
            raise DiscordError(f"falha de rede com o Discord ({type(error).__name__})") from error
        if response.status_code == 429:
            wait = _retry_after(response)
            if attempt == 1 and wait is not None and wait <= MAX_RETRY_AFTER_SECONDS:
                await sleep(wait)
                continue
            raise DiscordError("limite de taxa do Discord; tente de novo em instantes", 429)
        if response.status_code >= 500:
            raise DiscordError(f"Discord indisponível ({response.status_code})", response.status_code)
        if response.status_code >= 400:
            raise DiscordError(f"Discord recusou o pedido ({response.status_code})", response.status_code)
        try:
            body = response.json()
        except ValueError as error:
            raise DiscordError("resposta inválida do Discord") from error
        if not isinstance(body, dict):
            raise DiscordError("resposta inválida do Discord")
        return body
    raise DiscordError("limite de taxa do Discord; tente de novo em instantes", 429)


async def create_voice_channel(client: httpx.AsyncClient, settings: VoiceSettings, name: str) -> str:
    payload: dict[str, Any] = {"name": name[:100], "type": VOICE_CHANNEL_TYPE}
    if settings.category_id:
        payload["parent_id"] = settings.category_id
    body = await discord_request(client, settings, "POST", f"/guilds/{settings.guild_id}/channels", payload)
    channel_id = str(body.get("id", ""))
    if not _SNOWFLAKE.fullmatch(channel_id):
        raise DiscordError("o Discord não devolveu o canal criado")
    return channel_id


async def create_invite(client: httpx.AsyncClient, settings: VoiceSettings, channel_id: str) -> tuple[str, str | None]:
    body = await discord_request(
        client, settings, "POST", f"/channels/{channel_id}/invites",
        {"max_age": settings.invite_max_age, "max_uses": settings.invite_max_uses, "unique": True, "temporary": False},
    )
    code = body.get("code")
    if not isinstance(code, str) or not _INVITE_CODE.fullmatch(code):
        raise DiscordError("o Discord não devolveu um convite válido")
    expires = body.get("expires_at")
    if not isinstance(expires, str) or not expires:
        expires = None
        if settings.invite_max_age > 0:
            expires = (datetime.now(timezone.utc) + timedelta(seconds=settings.invite_max_age)).isoformat()
    return f"https://discord.gg/{code}", expires


def _service_headers(settings: VoiceSettings) -> dict[str, str]:
    return {
        "apikey": settings.service_key,
        "Authorization": f"Bearer {settings.service_key}",
        "Content-Type": "application/json",
    }


async def save_session(client: httpx.AsyncClient, settings: VoiceSettings, campaign_id: str, values: dict[str, Any]) -> bool:
    """Grava o resultado só se a sessão ainda estiver pending (não sobrescreve outro pedido)."""
    values = dict(values, updated_at=datetime.now(timezone.utc).isoformat())
    try:
        response = await client.patch(
            f"{settings.supabase_url}/rest/v1/campaign_voice_sessions",
            params={"campaign_id": f"eq.{campaign_id}", "status": "eq.pending"},
            headers={**_service_headers(settings), "Prefer": "return=minimal"},
            json=values,
        )
    except httpx.HTTPError as error:
        logger.warning("voice session save failed campaign=%s reason=%s", campaign_id, type(error).__name__)
        return False
    if response.status_code >= 400:
        logger.warning("voice session save failed campaign=%s status=%s", campaign_id, response.status_code)
        return False
    return True


async def broadcast_voice(client: httpx.AsyncClient, settings: VoiceSettings, campaign_id: str, status: str) -> None:
    """Sinal no canal privado da campanha. Leva só o status; o cliente relê a tabela pela RLS."""
    try:
        response = await client.post(
            f"{settings.supabase_url}/realtime/v1/api/broadcast",
            headers=_service_headers(settings),
            json={"messages": [{"topic": f"campaign:{campaign_id}:live", "event": "voice", "payload": {"status": status}, "private": True}]},
        )
    except httpx.HTTPError as error:
        logger.warning("voice broadcast failed campaign=%s reason=%s", campaign_id, type(error).__name__)
        return
    if response.status_code >= 400:
        logger.warning("voice broadcast failed campaign=%s status=%s", campaign_id, response.status_code)


async def provision_voice_room(settings: VoiceSettings, campaign_id: str, campaign_name: Any, channel_id: str | None) -> None:
    """Tarefa de fundo: canal + convite, grava e avisa a mesa. Nunca levanta exceção."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            invite_url = expires_at = None
            if channel_id and _SNOWFLAKE.fullmatch(channel_id):
                try:
                    invite_url, expires_at = await create_invite(client, settings, channel_id)
                except DiscordError as error:
                    if error.status != 404:  # canal apagado no Discord: cria outro
                        raise
                    channel_id = None
            else:
                channel_id = None
            if channel_id is None:
                channel_id = await create_voice_channel(client, settings, channel_name(campaign_name))
                invite_url, expires_at = await create_invite(client, settings, channel_id)
        except DiscordError as error:
            logger.warning("discord voice room failed campaign=%s reason=%s", campaign_id, error.summary)
            if await save_session(client, settings, campaign_id, {"status": "failed", "error": error.summary}):
                await broadcast_voice(client, settings, campaign_id, "failed")
            return
        saved = await save_session(client, settings, campaign_id, {
            "status": "ready", "channel_id": channel_id, "invite_url": invite_url, "expires_at": expires_at, "error": None,
        })
        if saved:
            logger.info("discord voice room ready campaign=%s channel=%s", campaign_id, channel_id)
            await broadcast_voice(client, settings, campaign_id, "ready")
