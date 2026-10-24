"""ASGI authentication and bounded in-process rate limiting for the API.

Limits are per process. Deployments with multiple Uvicorn workers need a shared
limiter for global quotas. Configure Uvicorn's proxy headers only for trusted
proxy addresses; this middleware deliberately ignores X-Forwarded-For.
"""
from __future__ import annotations

import os
import re
import secrets
import threading
import time
import heapq
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx


@dataclass(frozen=True)
class Limit:
    count: int
    seconds: int


@dataclass
class _Bucket:
    count: int
    expires_at: float


class BoundedRateLimiter:
    """Fixed-window limiter that never evicts a live bucket to make room."""

    def __init__(self, capacity: int = 20_000, clock: Callable[[], float] = time.monotonic):
        self.capacity = capacity
        self._clock = clock
        self._buckets: dict[tuple[str, str], _Bucket] = {}
        self._expiry_heap: list[tuple[float, tuple[str, str]]] = []
        self._lock = threading.Lock()

    def consume(self, key: tuple[str, str], limit: Limit) -> tuple[bool, int]:
        now = self._clock()
        with self._lock:
            while self._expiry_heap and self._expiry_heap[0][0] <= now:
                expires_at, bucket_key = heapq.heappop(self._expiry_heap)
                bucket = self._buckets.get(bucket_key)
                if bucket is not None and bucket.expires_at == expires_at:
                    del self._buckets[bucket_key]
            bucket = self._buckets.get(key)
            if bucket is None:
                if len(self._buckets) >= self.capacity:
                    return False, limit.seconds
                bucket = _Bucket(0, now + limit.seconds)
                self._buckets[key] = bucket
                heapq.heappush(self._expiry_heap, (bucket.expires_at, key))
            if bucket.count >= limit.count:
                return False, max(1, int(bucket.expires_at - now + 0.999))
            bucket.count += 1
            return True, max(1, int(bucket.expires_at - now + 0.999))


class ConcurrencyGate:
    """Non-queuing process-wide cap; every tool shares the same ten slots.

    Multiple processes must sit behind a shared admission controller with the
    same global cap. This object deliberately makes no distributed guarantee.
    """

    def __init__(self, capacity: int = 10):
        if isinstance(capacity, bool) or not isinstance(capacity, int) or not 1 <= capacity <= 10:
            raise ValueError("API_MAX_CONCURRENT_REQUESTS deve ser um inteiro entre 1 e 10")
        self.capacity = capacity
        self._active = 0
        self._lock = threading.Lock()

    @property
    def active(self) -> int:
        with self._lock:
            return self._active

    def acquire(self) -> bool:
        with self._lock:
            if self._active >= self.capacity:
                return False
            self._active += 1
            return True

    def release(self) -> None:
        with self._lock:
            if self._active <= 0:
                raise RuntimeError("concurrency slot released without acquisition")
            self._active -= 1


_IP_LIMITS: dict[str, Limit] = {
    "default": Limit(180, 60),
    "probability": Limit(180, 60),
    "calculate": Limit(180, 60),
    "roll": Limit(180, 60),
    "generation": Limit(20, 60),
    "extraction": Limit(10, 60),
}
_USER_LIMITS: dict[str, Limit] = {
    "default": Limit(120, 60),
    "probability": Limit(120, 60),
    "calculate": Limit(120, 60),
    "roll": Limit(120, 60),
    "generation": Limit(8, 60),
    "extraction": Limit(10, 60),
}


def _category(path: str) -> str:
    if path.endswith("/extractions/draft"):
        return "extraction"
    if path.endswith("/probabilities"):
        return "probability"
    if path.endswith("/calculate"):
        return "calculate"
    if path.endswith("/roll") or "/system-rolls/" in path:
        return "roll"
    if path.endswith("/generate") or "/maps/generate" in path or "/content/generate" in path:
        return "generation"
    return "default"


async def _send_json(send: Any, status: int, body: bytes, headers: list[tuple[bytes, bytes]] | None = None) -> None:
    response_headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    response_headers.extend(headers or [])
    await send({"type": "http.response.start", "status": status, "headers": response_headers})
    await send({"type": "http.response.body", "body": body})


class AuthenticationError(Exception):
    def __init__(self, status: int):
        self.status = status


async def verify_supabase_user(authorization: str) -> dict[str, Any]:
    """Resolve a bearer token through Supabase Auth without logging credentials."""
    supabase_url = os.getenv("SUPABASE_URL")
    publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise AuthenticationError(401)
    if len(authorization.encode("latin-1", errors="ignore")) > 8192:
        raise AuthenticationError(401)
    if not supabase_url or not publishable_key:
        raise AuthenticationError(503)
    try:
        parsed = urlsplit(supabase_url)
        user_url = parsed._replace(path=parsed.path.rstrip("/") + "/auth/v1/user").geturl()
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(user_url, headers={"apikey": publishable_key, "Authorization": authorization})
        if response.status_code != 200:
            raise AuthenticationError(503 if response.status_code == 429 or response.status_code >= 500 else 401)
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
            raise AuthenticationError(401)
        try:
            payload["id"] = str(uuid.UUID(payload["id"]))
        except (AttributeError, TypeError, ValueError) as error:
            raise AuthenticationError(401) from error
        return payload
    except AuthenticationError:
        raise
    except (httpx.HTTPError, ValueError, TypeError) as error:
        raise AuthenticationError(503) from error


class ApiSecurityMiddleware:
    def __init__(self, app: Any, limiter: BoundedRateLimiter | None = None, concurrency: ConcurrencyGate | None = None):
        self.app = app
        self.limiter = limiter or BoundedRateLimiter()
        self.concurrency = concurrency if concurrency is not None else ConcurrencyGate(
            int(os.getenv("API_MAX_CONCURRENT_REQUESTS", "10"))
        )

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        if method == "OPTIONS" or path == "/health" or not (path == "/api/v1" or path.startswith("/api/v1/")):
            await self.app(scope, receive, send)
            return

        if not self.concurrency.acquire():
            await _send_json(send, 429, b'{"detail":"limite de requisicoes simultaneas atingido"}', [(b"retry-after", b"1")])
            return
        try:
            # Includes Auth I/O, body reads and the whole response lifetime.
            # No unbounded wait queue is created when all slots are occupied.
            await self._protected_request(scope, receive, send, path, method)
        finally:
            self.concurrency.release()

    async def _protected_request(self, scope: dict[str, Any], receive: Any, send: Any, path: str, method: str) -> None:
        raw_headers = [(key.lower(), value) for key, value in scope.get("headers", [])]
        authorization_values = [value for key, value in raw_headers if key == b"authorization"]
        worker_values = [value for key, value in raw_headers if key == b"x-worker-token"]
        if len(authorization_values) > 1:
            await _send_json(send, 401, b'{"detail":"sessao invalida"}')
            return
        if len(worker_values) > 1:
            await _send_json(send, 403, b'{"detail":"worker nao autorizado"}')
            return
        headers = dict(raw_headers)
        client = scope.get("client")
        ip = str(client[0]) if client else "unknown"
        category = _category(path)
        allowed, retry = self.limiter.consume(("ip:" + ip, category), _IP_LIMITS[category])
        if not allowed:
            await _send_json(send, 429, b'{"detail":"limite de requisicoes excedido"}', [(b"retry-after", str(retry).encode())])
            return

        # The extraction worker is a separate, secret-only principal. The
        # endpoint still checks its configured secret and denies bad tokens.
        worker_secret = os.getenv("EXTRACTION_WORKER_TOKEN")
        supplied_worker = headers.get(b"x-worker-token", b"")
        worker_route = path == "/api/v1/extractions/draft" and method == "POST"
        worker_authenticated = False
        if worker_route and headers.get(b"x-worker-token") is not None:
            if len(headers[b"x-worker-token"]) > 8192:
                await _send_json(send, 403, b'{"detail":"worker nao autorizado"}')
                return
        if worker_route:
            if not worker_secret:
                await _send_json(send, 503, b'{"detail":"extracao indisponivel"}')
                return
            if not supplied_worker or not secrets.compare_digest(supplied_worker, worker_secret.encode("utf-8")):
                await _send_json(send, 403, b'{"detail":"worker nao autorizado"}')
                return
            worker_authenticated = True

        user: dict[str, Any] | None = None
        public_marketplace_read = method == "GET" and re.fullmatch(
            r"/api/v1/marketplace/systems(?:/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})?/?", path
        ) is not None and not authorization_values
        if not worker_authenticated and not public_marketplace_read:
            authorization = headers.get(b"authorization", b"").decode("latin-1")
            try:
                # Resolve the function at request time so tests can inject a
                # verifier even when the framework middleware stack exists.
                user = await verify_supabase_user(authorization)
            except AuthenticationError as error:
                status = error.status
                detail = b'{"detail":"sessao invalida"}' if status == 401 else b'{"detail":"autenticacao indisponivel"}'
                await _send_json(send, status, detail)
                return

            # Retain only the verified identity even if the following quota
            # check denies access. Auditing must attribute authenticated abuse.
            scope.setdefault("state", {})["supabase_user"] = user
            user_id = user["id"]
            allowed, retry = self.limiter.consume(("uid:" + user_id, category), _USER_LIMITS[category])
            if not allowed:
                await _send_json(send, 429, b'{"detail":"limite de requisicoes excedido"}', [(b"retry-after", str(retry).encode())])
                return

        state = scope.setdefault("state", {})
        state["supabase_user"] = user
        state["extraction_worker_authenticated"] = worker_authenticated
        body_messages: list[dict[str, Any]] = []
        body_size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body_size += len(message.get("body", b""))
            if body_size > 1_048_576:
                await _send_json(send, 413, b'{"detail":"corpo excede o limite"}')
                return
            body_messages.append(message)
            if not message.get("more_body", False):
                break
        iterator = iter(body_messages)

        async def replay_receive() -> dict[str, Any]:
            try:
                return next(iterator)
            except StopIteration:
                return await receive()

        await self.app(scope, replay_receive, send)
