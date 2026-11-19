"""Implementação de ``VoiceSessionRequests`` sobre a RPC ``request_campaign_voice_session``."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.rest_client import RpcErrors, SupabaseRest
from app.domain.errors import Forbidden, NotFound, ServiceUnavailable

ONLY_MANAGERS = "Só o dono ou um mestre da campanha cria a sala de voz."
REQUEST_ERRORS = RpcErrors(
    by_code={"42501": (Forbidden, ONLY_MANAGERS)},
    by_status={401: (Forbidden, ONLY_MANAGERS), 403: (Forbidden, ONLY_MANAGERS)},
    otherwise=(ServiceUnavailable, "não foi possível consultar a sala de voz"),
)


class SupabaseVoiceSessionRequests:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def request(self, campaign_id: UUID) -> dict[str, Any]:
        rows = await self._rest.rpc(
            "request_campaign_voice_session", {"p_campaign_id": str(campaign_id)}, errors=REQUEST_ERRORS,
        )
        row = rows[0] if isinstance(rows, list) and rows else rows
        if not isinstance(row, dict):
            raise NotFound("campanha não encontrada")
        return row
