"""Optional global API admission backed by a Supabase RPC lease."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx


LOGGER = logging.getLogger(__name__)
API_PREFIX = "/api/v1"
CAPACITY = 10
LEASE_SECONDS = 120
REQUEST_BUDGET_SECONDS = 60
ACQUIRE_TIMEOUT_SECONDS = 3
RELEASE_TIMEOUT_SECONDS = 3
_BUSY_BODY = b'{"detail":"limite de requisicoes simultaneas atingido"}'
_UNAVAILABLE_BODY = b'{"detail":"controle de concorrencia indisponivel"}'
_TIMEOUT_BODY = b'{"detail":"tempo limite da requisicao excedido"}'


class AdmissionCoordinator(Protocol):
    async def acquire(self, token: str) -> bool: ...

    async def release(self, token: str) -> None: ...


class CoordinatorUnavailable(RuntimeError):
    """The shared admission store could not safely answer an RPC."""


class SupabaseAdmissionCoordinator:
    def __init__(self, url: str, service_role_key: str, *, timeout: float = ACQUIRE_TIMEOUT_SECONDS):
        parsed = urlsplit(url)
        if (parsed.scheme not in {"http", "https"} or not parsed.netloc
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}):
            raise ValueError("SUPABASE_URL inválida")
        if not service_role_key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY ausente")
        self.rpc_base = url.rstrip("/") + "/rest/v1/rpc/"
        self.service_role_key = service_role_key
        self.timeout = timeout

    async def _rpc(self, name: str, payload: dict[str, str]) -> object:
        headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout)) as client:
                response = await client.post(self.rpc_base + name, headers=headers, json=payload)
        except httpx.HTTPError as error:
            raise CoordinatorUnavailable("admission RPC unavailable") from error
        if response.status_code != 200 or len(response.content) > 128:
            raise CoordinatorUnavailable("admission RPC returned an invalid response")
        try:
            return response.json()
        except ValueError as error:
            raise CoordinatorUnavailable("admission RPC returned invalid JSON") from error

    async def acquire(self, token: str) -> bool:
        result = await self._rpc("api_concurrency_acquire", {"p_lease_token": token})
        if not isinstance(result, bool):
            raise CoordinatorUnavailable("admission RPC returned an invalid decision")
        return result

    async def release(self, token: str) -> None:
        result = await self._rpc("api_concurrency_release", {"p_lease_token": token})
        if not isinstance(result, bool):
            raise CoordinatorUnavailable("release RPC returned an invalid result")


def _is_true_environment_value(value: str | None) -> bool:
    return bool(value and value.strip().lower() not in {"0", "false", "no", "off"})


def is_serverless_or_multiworker(environ: dict[str, str] | None = None) -> bool:
    env = os.environ if environ is None else environ
    if any(_is_true_environment_value(env.get(name)) for name in (
        "VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "K_SERVICE"
    )):
        return True
    try:
        return int(env.get("WEB_CONCURRENCY", "1")) > 1
    except ValueError:
        return True


def resolve_backend(environ: dict[str, str] | None = None) -> tuple[str, str | None]:
    """Resolve backend and a generic configuration error, if any."""
    env = os.environ if environ is None else environ
    requested = env.get("API_CONCURRENCY_BACKEND", "").strip().lower()
    distributed_runtime = is_serverless_or_multiworker(env)
    if requested and requested not in {"process", "supabase"}:
        return requested, "API_CONCURRENCY_BACKEND inválido"
    backend = requested or ("supabase" if distributed_runtime else "process")
    if backend == "process" and distributed_runtime:
        return backend, "backend process não garante o limite global neste runtime"
    if backend == "supabase" and (not env.get("SUPABASE_URL") or not env.get("SUPABASE_SERVICE_ROLE_KEY")):
        return backend, "configuração Supabase necessária"
    return backend, None


async def _send_json(send: Callable[[dict[str, Any]], Awaitable[None]], status: int, body: bytes,
                     headers: list[tuple[bytes, bytes]] | None = None) -> None:
    response_headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    response_headers.extend(headers or [])
    await send({"type": "http.response.start", "status": status, "headers": response_headers})
    await send({"type": "http.response.body", "body": body})


class SharedAdmissionMiddleware:
    """Optional global cap; process mode leaves admission to ApiSecurityMiddleware."""

    def __init__(
        self,
        app: Any,
        *,
        coordinator: AdmissionCoordinator | None = None,
        request_timeout: float = REQUEST_BUDGET_SECONDS,
        acquire_timeout: float = ACQUIRE_TIMEOUT_SECONDS,
        release_timeout: float = RELEASE_TIMEOUT_SECONDS,
        environ: dict[str, str] | None = None,
    ) -> None:
        if not 0 < request_timeout <= REQUEST_BUDGET_SECONDS:
            raise ValueError("request_timeout precisa estar entre 0 e 60 segundos")
        if not 0 < acquire_timeout <= ACQUIRE_TIMEOUT_SECONDS:
            raise ValueError("acquire_timeout precisa estar entre 0 e 3 segundos")
        if not 0 < release_timeout <= RELEASE_TIMEOUT_SECONDS:
            raise ValueError("release_timeout precisa estar entre 0 e 3 segundos")
        self.app = app
        self.request_timeout = request_timeout
        self.acquire_timeout = acquire_timeout
        self.release_timeout = release_timeout
        self.backend, self.config_error = resolve_backend(environ)
        self.coordinator = coordinator
        if self.backend == "supabase" and self.config_error is None and coordinator is None:
            env = os.environ if environ is None else environ
            try:
                self.coordinator = SupabaseAdmissionCoordinator(
                    env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], timeout=acquire_timeout
                )
            except ValueError:
                self.config_error = "configuração Supabase inválida"

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http" or scope.get("method", "").upper() == "OPTIONS" or not (
            scope.get("path", "") == API_PREFIX or scope.get("path", "").startswith(API_PREFIX + "/")
        ):
            await self.app(scope, receive, send)
            return

        if self.backend == "process" and self.config_error is None:
            await self.app(scope, receive, send)
            return
        if self.backend != "supabase" or self.config_error is not None or self.coordinator is None:
            await _send_json(send, 503, _UNAVAILABLE_BODY)
            return

        token = str(uuid.uuid4())
        response_started = False

        async def tracked_send(message: dict[str, Any]) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        acquired = False
        try:
            async with asyncio.timeout(self.request_timeout):
                try:
                    acquired = await asyncio.wait_for(
                        self.coordinator.acquire(token), timeout=self.acquire_timeout
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    LOGGER.warning("Shared API admission acquire failed")
                    await _send_json(tracked_send, 503, _UNAVAILABLE_BODY)
                    return
                if not acquired:
                    await _send_json(tracked_send, 429, _BUSY_BODY, [(b"retry-after", b"1")])
                    return
                await self.app(scope, receive, tracked_send)
        except TimeoutError:
            if response_started:
                raise
            await _send_json(tracked_send, 504, _TIMEOUT_BODY)
        finally:
            if acquired:
                await self._release_bounded(token)

    async def _release_bounded(self, token: str) -> None:
        assert self.coordinator is not None
        release_task = asyncio.create_task(self.coordinator.release(token))
        try:
            await asyncio.wait_for(asyncio.shield(release_task), timeout=self.release_timeout)
        except asyncio.CancelledError:
            try:
                await asyncio.wait_for(asyncio.shield(release_task), timeout=self.release_timeout)
            except BaseException:
                release_task.cancel()
                LOGGER.warning("Shared API admission release failed")
            raise
        except Exception:
            release_task.cancel()
            LOGGER.warning("Shared API admission release failed")
