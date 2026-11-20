"""Adaptador de saída para a API REST do Supabase, sempre com o token do usuário.

Rodar como o usuário preserva o RLS e ``auth.uid()``. Erros do PostgREST viram erros de
domínio sem repassar mensagens internas do banco.
"""

from __future__ import annotations

import os
from typing import Any, Protocol
from uuid import UUID

import httpx

from app.adapters.outbound.supabase.errors import NOT_ALLOWED, SHEET_RPC_ERRORS, RpcErrors, TableErrors
from app.domain.errors import (
    Conflict,
    Forbidden,
    InvalidInput,
    NotFound,
    ServiceUnavailable,
    Unauthenticated,
    UnexpectedUpstreamResponse,
)

REQUEST_TIMEOUT_SECONDS = 8
MAX_AUTHORIZATION_LENGTH = 8192
WRITE_METHODS = frozenset({"POST", "PATCH", "DELETE"})


class SupabaseRest(Protocol):
    """Porta usada pelos repositórios Supabase; o teste troca a implementação por uma falsa."""

    async def current_user_id(self) -> str: ...

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        payload: dict[str, Any] | None = None,
        errors: TableErrors | None = None,
    ) -> Any: ...

    async def rpc(
        self,
        function: str,
        payload: dict[str, Any],
        *,
        errors: RpcErrors = SHEET_RPC_ERRORS,
        max_response_bytes: int | None = None,
    ) -> Any: ...


class SupabaseRestClient:
    """Cliente ligado ao cabeçalho ``Authorization`` de uma requisição."""

    def __init__(self, authorization: str | None, *, timeout: float = REQUEST_TIMEOUT_SECONDS) -> None:
        self._authorization = authorization
        self._timeout = timeout

    async def current_user_id(self) -> str:
        base_url, headers = self._session()
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(f"{base_url}/auth/v1/user", headers=headers)
        except httpx.HTTPError as error:
            raise ServiceUnavailable("serviço de autenticação indisponível") from error
        if response.status_code != 200:
            raise Unauthenticated("sessão inválida")
        try:
            return str(UUID(response.json()["id"]))
        except (KeyError, TypeError, ValueError) as error:
            raise Unauthenticated("sessão inválida") from error

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        payload: dict[str, Any] | None = None,
        errors: TableErrors | None = None,
    ) -> Any:
        base_url, headers = self._session()
        headers["Accept"] = "application/json"
        if method in WRITE_METHODS:
            headers["Prefer"] = "return=representation"
        if payload is not None:
            headers["Content-Type"] = "application/json"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(
                    method, f"{base_url}/rest/v1/{path}", headers=headers, params=params, json=payload,
                )
        except httpx.HTTPError as error:
            raise ServiceUnavailable("Supabase indisponível") from error
        if errors is None:
            _raise_for_table_status(response, has_payload=payload is not None)
        elif response.status_code >= 400:
            error_type, message = errors.by_status.get(response.status_code, errors.otherwise)
            raise error_type(message)
        if not response.content:
            return []
        try:
            return response.json()
        except ValueError as error:
            raise ServiceUnavailable("resposta inválida do Supabase") from error

    async def rpc(
        self,
        function: str,
        payload: dict[str, Any],
        *,
        errors: RpcErrors = SHEET_RPC_ERRORS,
        max_response_bytes: int | None = None,
    ) -> Any:
        base_url, headers = self._session()
        headers["Content-Type"] = "application/json"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(f"{base_url}/rest/v1/rpc/{function}", headers=headers, json=payload)
        except httpx.HTTPError as error:
            raise ServiceUnavailable("Supabase indisponível") from error
        if response.status_code >= 400:
            error_type, message = errors.translate(response.status_code, _json_or_none(response))
            raise error_type(message)
        if max_response_bytes is not None and len(response.content) > max_response_bytes:
            raise UnexpectedUpstreamResponse("resposta inválida do Supabase")
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as error:
            raise ServiceUnavailable("resposta inválida do Supabase") from error

    def _session(self) -> tuple[str, dict[str, str]]:
        """Confere a configuração antes da sessão, como as rotas sempre fizeram."""
        base_url = os.getenv("SUPABASE_URL")
        api_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
        if not base_url or not api_key:
            raise ServiceUnavailable("Supabase da API não está configurado")
        token = self._authorization
        if not token or not token.startswith("Bearer ") or len(token) > MAX_AUTHORIZATION_LENGTH:
            raise Unauthenticated("sessão necessária")
        return base_url.rstrip("/"), {"apikey": api_key, "Authorization": self._authorization}


def _raise_for_table_status(response: httpx.Response, *, has_payload: bool) -> None:
    """O RLS pode esconder linhas; não revelamos detalhes do PostgREST nem a existência do registro."""
    status = response.status_code
    if status < 400:
        return
    if status in (401, 403):
        raise Unauthenticated("sessão inválida")
    if status == 404:
        raise NotFound("registro não encontrado")
    if status == 409:
        raise Conflict("conflito ao salvar a ficha")
    if status == 400 and has_payload:
        raise InvalidInput("dados da ficha rejeitados pelo Supabase")
    raise Forbidden(NOT_ALLOWED)


def _json_or_none(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None
