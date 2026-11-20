"""Sala de voz da campanha no Discord.

O armazenamento confirma dono ou mestre e decide se há convite válido para reaproveitar ou
pedido em andamento. Só quando ele devolve ``should_create`` a criação da sala é agendada.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

Row = dict[str, Any]


class VoiceSessionRequests(Protocol):
    async def request(self, campaign_id: UUID) -> Row:
        """Registra o pedido e devolve o estado atual da sala da campanha."""


class VoiceRooms(Protocol):
    def is_configured(self) -> bool: ...

    def ensure_configured(self) -> None:
        """Levanta ``ServiceUnavailable`` quando falta configuração."""

    async def provision(self, campaign_id: str, campaign_name: Any, channel_id: str | None) -> None:
        """Cria canal e convite, grava o resultado e avisa a mesa; nunca levanta exceção."""


@dataclass(frozen=True)
class VoiceSessionRequest:
    view: Row
    provision: Callable[[], Awaitable[None]] | None

    @property
    def scheduled(self) -> bool:
        return self.provision is not None


class VoiceSessionService:
    def __init__(self, requests: VoiceSessionRequests, rooms: VoiceRooms) -> None:
        self._requests = requests
        self._rooms = rooms

    def config(self) -> dict[str, bool]:
        return {"enabled": self._rooms.is_configured()}

    async def request_room(self, campaign_id: UUID) -> VoiceSessionRequest:
        # Sem configuração nada é reservado no banco.
        self._rooms.ensure_configured()
        row = await self._requests.request(campaign_id)
        provision = None
        if row.get("should_create"):
            async def provision() -> None:
                await self._rooms.provision(str(campaign_id), row.get("campaign_name"), row.get("channel_id"))
        ready = row.get("status") == "ready"
        view = {
            "campaign_id": str(campaign_id),
            "status": row.get("status") or "pending",
            "invite_url": row.get("invite_url") if ready else None,
            "expires_at": row.get("expires_at") if ready else None,
            "scheduled": provision is not None,
        }
        return VoiceSessionRequest(view, provision)
