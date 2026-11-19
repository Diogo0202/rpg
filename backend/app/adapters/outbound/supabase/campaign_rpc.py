"""Tradução comum das RPCs de campanha (combate, conteúdo gerado, crônica, Vampiro V3).

Usada com ``SupabaseRest.rpc(..., errors=CAMPAIGN_RPC_ERRORS)``; ``call_rpc`` atende quem ainda
não recebe a porta por injeção.
"""

from __future__ import annotations

from typing import Any

from app.adapters.outbound.supabase.rest_client import RpcErrors, SupabaseRestClient
from app.domain.errors import Conflict, Forbidden, InvalidInput, NotFound, ServiceUnavailable

NOT_ALLOWED = "operação não permitida nesta campanha"
CAMPAIGN_RPC_ERRORS = RpcErrors(
    by_code={
        "42501": (Forbidden, NOT_ALLOWED),
        "P0002": (NotFound, "combate não encontrado nesta campanha"),
        "55000": (Conflict, "o combate já foi encerrado"),
        "54000": (Conflict, "o combate atingiu o limite de 50 participantes"),
        "22023": (InvalidInput, "dados rejeitados pelo banco"),
        # Vampiro V3: limites da ficha (sangue por turno, Força de Vontade) e ID de operação repetido.
        "23514": (InvalidInput, "limite da ficha atingido (sangue, sangue por turno ou Força de Vontade)"),
        "23505": (Conflict, "operação já usada para outro ajuste"),
    },
    by_status={401: (Forbidden, NOT_ALLOWED), 403: (Forbidden, NOT_ALLOWED)},
    otherwise=(ServiceUnavailable, "não foi possível concluir a operação no Supabase"),
)


async def call_rpc(function: str, authorization: str, payload: dict[str, Any]) -> Any:
    """Executa a RPC com o token do usuário; levanta erros de domínio."""
    return await SupabaseRestClient(authorization).rpc(function, payload, errors=CAMPAIGN_RPC_ERRORS)
