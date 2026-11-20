"""Tradução de erros do PostgREST em erros de domínio.

Toda RPC usa ``RpcErrors``: primeiro o SQLSTATE, depois o status HTTP, por fim o padrão. Cada
repositório escreve as próprias mensagens, porque o mesmo código significa coisas diferentes em cada
contexto (``23505`` é compra repetida no avanço e ajuste repetido na ficha).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from app.domain.errors import Conflict, DomainError, Forbidden, InvalidInput, NotFound, Unauthenticated

ErrorSpec = tuple[type[DomainError], str]
NOT_ALLOWED = "operação não permitida nesta campanha"
INVALID_SESSION: ErrorSpec = (Unauthenticated, "sessão inválida")


@dataclass(frozen=True)
class TableErrors:
    """Tradução própria de status HTTP para uma leitura ou escrita de tabela."""

    by_status: Mapping[int, ErrorSpec]
    otherwise: ErrorSpec


@dataclass(frozen=True)
class RpcErrors:
    """Tradução completa de uma RPC. Sem ``by_status`` e ``otherwise``, vale o padrão das fichas."""

    by_code: Mapping[str, ErrorSpec]
    by_status: Mapping[int, ErrorSpec] = field(default_factory=lambda: {401: INVALID_SESSION})
    otherwise: ErrorSpec = (Forbidden, NOT_ALLOWED)
    # Códigos cujo texto vem de ``RAISE`` escrito por nós no banco e pode ir para a interface.
    with_database_message: frozenset[str] = frozenset()

    def translate(self, status: int, body: Any) -> ErrorSpec:
        code = body.get("code") if isinstance(body, dict) else None
        if code in self.by_code:
            error_type, detail = self.by_code[code]
            message = body.get("message") if code in self.with_database_message else None
            return error_type, f"{detail} ({message})" if isinstance(message, str) and message else detail
        return self.by_status.get(status, self.otherwise)


# RPCs de fichas e do Vampiro V5 que não trazem tabela própria.
SHEET_RPC_ERRORS = RpcErrors(by_code={
    "42501": (Forbidden, "operação não permitida nesta ficha"),
    "23514": (InvalidInput, "valor sairia do limite permitido"),
    "23505": (Conflict, "ID da operação já foi usado para outro ajuste"),
    "22023": (InvalidInput, "ajuste inválido para esta ficha"),
    "40001": (Conflict, "ficha alterada em outra sessão; recarregue antes de restaurar"),
    "P0002": (NotFound, "versão não encontrada no histórico da ficha"),
})
