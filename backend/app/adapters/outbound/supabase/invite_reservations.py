"""Implementação de ``InviteReservations`` sobre a RPC ``reserve_campaign_invite_email``."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.adapters.outbound.supabase.errors import RpcErrors
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.domain.errors import Conflict, Forbidden, InvalidInput, NotFound, RateLimited, ServiceUnavailable

ONLY_MANAGERS = "Só o dono ou um mestre da campanha envia este convite."
RESERVATION_ERRORS = RpcErrors(
    by_code={
        "42501": (Forbidden, ONLY_MANAGERS),
        "22023": (InvalidInput, "Este convite não tem e-mail; compartilhe o código."),
        "55000": (Conflict, "O convite não está mais pendente."),
        "54000": (RateLimited, "Limite de 5 envios por convite atingido; compartilhe o código."),
        "54001": (RateLimited, "O convite foi enviado há menos de 5 minutos. Aguarde para reenviar."),
    },
    by_status={401: (Forbidden, ONLY_MANAGERS), 403: (Forbidden, ONLY_MANAGERS)},
    otherwise=(ServiceUnavailable, "não foi possível consultar o convite"),
)


class SupabaseInviteReservations:
    def __init__(self, rest: SupabaseRest) -> None:
        self._rest = rest

    async def reserve_email(self, invite_id: UUID) -> dict[str, Any]:
        rows = await self._rest.rpc(
            "reserve_campaign_invite_email", {"p_invite_id": str(invite_id)}, errors=RESERVATION_ERRORS,
        )
        row = rows[0] if isinstance(rows, list) and rows else rows
        if not isinstance(row, dict):
            raise NotFound("convite não encontrado")
        return row
