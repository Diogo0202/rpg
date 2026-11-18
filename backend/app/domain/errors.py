"""Erros de negócio independentes do transporte.

O núcleo da aplicação levanta estes erros; o adaptador HTTP decide o status de cada um.
"""

from __future__ import annotations


class DomainError(Exception):
    """Falha esperada de uma regra de negócio, com mensagem pronta para o usuário."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class Unauthenticated(DomainError):
    """A sessão está ausente ou não foi aceita."""


class Forbidden(DomainError):
    """A sessão existe, mas não pode executar a operação."""


class NotFound(DomainError):
    """O registro pedido não existe ou não está visível para a sessão."""


class Conflict(DomainError):
    """O registro mudou desde a última leitura ou a operação já foi usada."""


class InvalidInput(DomainError):
    """Os dados enviados violam uma regra do modelo ou do sistema de regras."""


class ServiceUnavailable(DomainError):
    """Um serviço externo necessário está fora do ar ou sem configuração."""


class UnexpectedUpstreamResponse(DomainError):
    """Um serviço externo respondeu num formato que o sistema não reconhece."""
