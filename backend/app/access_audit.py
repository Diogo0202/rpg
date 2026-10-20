"""Privacy-bounded HTTP access auditing for the RPG-Atlas API."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any, cast
from urllib.parse import urlsplit, urlunsplit

import httpx

_API_PREFIX = "/api/v1"
_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}
_MAX_ROUTE_LENGTH = 256
_MAX_DURATION_MS = 86_400_000


def _configure_logger() -> logging.Logger:
    logger = logging.getLogger("rpg_nexus.access_audit")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    return logger


_LOGGER = _configure_logger()
AuditSink = Callable[[dict[str, Any]], Awaitable[None]]
_AUTO_SINK = object()


def _safe_category(path: str) -> str:
    """Map a request path to a fixed label without retaining user path data."""
    segments = [part for part in path.split("/") if part]
    if len(segments) < 3 or segments[:2] != ["api", "v1"]:
        return "api_other"
    known = {
        "campaigns", "sheets", "templates", "dice", "v5", "modifiers",
        "system-rolls", "maps", "content", "extractions", "sources",
    }
    return segments[2] if segments[2] in known else "api_other"


def _route_template(scope: dict[str, Any], path: str) -> str:
    route = scope.get("route")
    template = getattr(route, "path", None)
    if isinstance(template, str) and template.startswith(_API_PREFIX + "/") and len(template) <= _MAX_ROUTE_LENGTH:
        return template
    return _safe_category(path)


def _warn_configuration() -> None:
    try:
        _LOGGER.warning(json.dumps({"event": "audit_sink_configuration_invalid"}, separators=(",", ":")))
    except Exception:
        pass


def _verified_actor(scope: dict[str, Any]) -> str | None:
    state = scope.get("state")
    user = state.get("supabase_user") if isinstance(state, dict) else None
    identifier = user.get("id") if isinstance(user, dict) else None
    if not isinstance(identifier, str):
        return None
    try:
        return str(uuid.UUID(identifier))
    except (ValueError, TypeError, AttributeError):
        return None


class SupabaseAuditSink:
    """Optional bounded-time PostgREST writer, configured from server env."""

    def __init__(self, base_url: str, service_key: str, timeout_seconds: float = 1.5):
        parsed = urlsplit(base_url)
        try:
            hostname = parsed.hostname
            has_credentials = parsed.username is not None or parsed.password is not None
        except ValueError as error:
            raise ValueError("invalid Supabase URL") from error
        loopback_http = parsed.scheme == "http" and hostname in {"localhost", "127.0.0.1", "::1"}
        if (
            parsed.scheme != "https" and not loopback_http
            or not parsed.netloc
            or not hostname
            or has_credentials
            or parsed.query
            or parsed.fragment
            or "?" in base_url
            or "#" in base_url
            or len(base_url) > 2048
        ):
            raise ValueError("invalid Supabase URL")
        self.url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/") + "/rest/v1/access_audit_logs", "", ""))
        self.service_key = service_key
        self.timeout_seconds = timeout_seconds

    async def __call__(self, record: dict[str, Any]) -> None:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(self.url, headers=headers, json=record)
            response.raise_for_status()


def configured_audit_sink() -> AuditSink | None:
    base_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        if base_url or service_key:
            _warn_configuration()
        return None
    try:
        return SupabaseAuditSink(base_url, service_key)
    except (TypeError, ValueError):
        _warn_configuration()
        return None


class AccessAuditMiddleware:
    """Log API access around inner middleware, including early security denials."""

    def __init__(
        self,
        app: Any,
        *,
        logger: logging.Logger | None = None,
        sink: AuditSink | None | object = _AUTO_SINK,
        clock: Callable[[], float] = time.monotonic,
        timestamp: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        self.app = app
        self.logger = logger or _LOGGER
        self.sink: AuditSink | None = (
            configured_audit_sink() if sink is _AUTO_SINK else cast(AuditSink | None, sink)
        )
        self.clock = clock
        self.timestamp = timestamp

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = str(scope.get("method", "")).upper()
        if not isinstance(path, str) or not (path == _API_PREFIX or path.startswith(_API_PREFIX + "/")):
            await self.app(scope, receive, send)
            return
        # Health and CORS preflight carry no API action and are intentionally omitted.
        if method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        request_id = str(uuid.uuid4())
        started = self.clock()
        status_code: int | None = None
        disconnected = False

        async def audited_receive() -> dict[str, Any]:
            nonlocal disconnected
            message = await receive()
            if message.get("type") == "http.disconnect":
                disconnected = True
            return message

        async def audited_send(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = message.get("status")
                headers = list(message.get("headers", []))
                headers = [(key, value) for key, value in headers if key.lower() != b"x-request-id"]
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, audited_receive, audited_send)
        except asyncio.CancelledError:
            status_code = 499
            raise
        except BaseException:
            if status_code is None:
                status_code = 499 if disconnected else 500
            raise
        finally:
            if status_code is None:
                status_code = 499 if disconnected else 500
            elapsed = max(0.0, self.clock() - started)
            duration_ms = min(_MAX_DURATION_MS, int(elapsed * 1000))
            try:
                created_at = self.timestamp().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            except Exception:
                created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            actor_id = _verified_actor(scope)
            state = scope.get("state")
            record = {
                "timestamp": created_at,
                "request_id": request_id,
                "actor_id": actor_id,
                "worker": bool(state.get("extraction_worker_authenticated")) if isinstance(state, dict) else False,
                "method": method if method in _METHODS else "OTHER",
                "route": _route_template(scope, path),
                "status": status_code if isinstance(status_code, int) and 100 <= status_code <= 599 else 500,
                "duration_ms": duration_ms,
            }
            try:
                self.logger.info(json.dumps(record, separators=(",", ":"), ensure_ascii=True))
            except Exception:
                pass
            if self.sink is not None:
                try:
                    await asyncio.wait_for(self.sink(record), timeout=1.75)
                except asyncio.CancelledError:
                    self._warn_persistence_failure(request_id)
                except Exception:
                    self._warn_persistence_failure(request_id)

    def _warn_persistence_failure(self, request_id: str) -> None:
        try:
            self.logger.warning(json.dumps(
                {"event": "audit_persistence_failed", "request_id": request_id},
                separators=(",", ":"),
                ensure_ascii=True,
            ))
        except Exception:
            pass
