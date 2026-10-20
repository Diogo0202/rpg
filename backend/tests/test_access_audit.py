from __future__ import annotations

import asyncio
import json
import logging
import uuid

import httpx
import pytest

from app.access_audit import AccessAuditMiddleware, SupabaseAuditSink, configured_audit_sink
from app.security import ApiSecurityMiddleware, AuthenticationError, BoundedRateLimiter


@pytest.fixture
def anyio_backend():
    return "asyncio"


class CaptureHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


async def request(app, path="/api/v1/private", method="GET", headers=None):
    transport = httpx.ASGITransport(app=app, client=("203.0.113.44", 4321))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, headers=headers)


def capture_logger() -> tuple[logging.Logger, CaptureHandler]:
    logger = logging.Logger(f"test-audit-{uuid.uuid4()}", level=logging.INFO)
    handler = CaptureHandler()
    logger.addHandler(handler)
    return logger, handler


@pytest.mark.anyio
async def test_records_auth_denial_with_request_id_and_without_sensitive_values(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    logger, handler = capture_logger()
    persisted = []

    async def sink(record):
        persisted.append(record)

    async def reject_user(_authorization):
        raise AuthenticationError(401)

    monkeypatch.setattr("app.security.verify_supabase_user", reject_user)

    secured = ApiSecurityMiddleware(lambda_scope_app())
    app = AccessAuditMiddleware(secured, logger=logger, sink=sink)
    response = await request(
        app,
        "/api/v1/campaigns/secret-campaign-id/sheets?token=private-query",
        headers={"Authorization": "Bearer super-secret-token"},
    )

    assert response.status_code == 401
    request_id = response.headers["x-request-id"]
    assert str(uuid.UUID(request_id)) == request_id
    assert len(persisted) == 1
    record = persisted[0]
    assert record["request_id"] == request_id
    assert record["actor_id"] is None
    assert record["status"] == 401
    assert record["method"] == "GET"
    assert record["route"] == "campaigns"
    serialized = handler.messages[0]
    for sensitive in ("super-secret-token", "private-query", "secret-campaign-id", "203.0.113.44", "test"):
        assert sensitive not in serialized


@pytest.mark.anyio
async def test_records_rate_limit_denial_after_user_verification(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")

    async def verified_user(_authorization):
        return {"id": "30000000-0000-4000-8000-000000000001"}

    monkeypatch.setattr("app.security.verify_supabase_user", verified_user)
    logger, handler = capture_logger()
    persisted = []

    async def sink(record):
        persisted.append(record)

    class DenyLimiter(BoundedRateLimiter):
        def consume(self, key, limit):
            return not key[0].startswith("uid:"), 60

    secured = ApiSecurityMiddleware(lambda_scope_app(), DenyLimiter())
    response = await request(
        AccessAuditMiddleware(secured, logger=logger, sink=sink),
        headers={"Authorization": "Bearer dummy-jwt"},
    )

    assert response.status_code == 429
    assert response.headers.get("retry-after") == "60"
    assert persisted[0]["status"] == 429
    assert persisted[0]["actor_id"] == "30000000-0000-4000-8000-000000000001"
    assert persisted[0]["worker"] is False
    assert len(handler.messages) == 1

    accepted = await request(
        AccessAuditMiddleware(ApiSecurityMiddleware(lambda_scope_app()), logger=logger, sink=sink),
        headers={"Authorization": "Bearer dummy-jwt"},
    )
    assert accepted.status_code == 204
    assert persisted[1]["actor_id"] == "30000000-0000-4000-8000-000000000001"


@pytest.mark.anyio
async def test_logs_other_http_errors_and_omits_non_api_health_and_options(monkeypatch):
    logger, handler = capture_logger()

    async def reject_user(_authorization):
        raise AuthenticationError(401)

    monkeypatch.setattr("app.security.verify_supabase_user", reject_user)
    app = AccessAuditMiddleware(ApiSecurityMiddleware(lambda_scope_app()), logger=logger, sink=None)
    health = await request(app, "/health")
    options = await request(app, "/api/v1/private", method="OPTIONS")
    failed = await request(app, "/api/v1/private", method="TRACE")

    assert health.status_code == 204
    assert options.status_code == 204
    assert "x-request-id" not in health.headers
    assert "x-request-id" not in options.headers
    assert failed.status_code == 401
    assert len(handler.messages) == 1
    record = json.loads(handler.messages[0])
    assert record["method"] == "OTHER"
    assert record["route"] == "api_other"
    assert record["status"] == 401
    assert record["duration_ms"] >= 0


@pytest.mark.anyio
async def test_logs_unhandled_error_without_exception_text():
    logger, handler = capture_logger()

    async def broken_app(scope, receive, send):
        raise RuntimeError("secret payload and private query")

    with pytest.raises(RuntimeError):
        await request(AccessAuditMiddleware(broken_app, logger=logger, sink=None), "/api/v1/campaigns/private-id")

    assert len(handler.messages) == 1
    record = json.loads(handler.messages[0])
    assert record["status"] == 500
    assert record["route"] == "campaigns"
    assert "secret payload" not in handler.messages[0]
    assert "private-id" not in handler.messages[0]


@pytest.mark.anyio
async def test_sink_failure_emits_fixed_warning_and_keeps_response():
    logger, handler = capture_logger()

    async def failed_sink(_record):
        raise RuntimeError("service key and provider response body")

    response = await request(AccessAuditMiddleware(lambda_scope_app(), logger=logger, sink=failed_sink))

    assert response.status_code == 204
    entries = [json.loads(message) for message in handler.messages]
    warning = next(entry for entry in entries if entry.get("event") == "audit_persistence_failed")
    assert warning["request_id"] == response.headers["x-request-id"]
    assert "service key" not in handler.messages[-1]
    assert "provider response" not in handler.messages[-1]


@pytest.mark.anyio
async def test_cancelled_request_and_cancelled_sink_keep_499_and_original_cancel():
    logger, handler = capture_logger()

    async def cancelled_app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise asyncio.CancelledError("private request detail")

    async def cancelled_sink(_record):
        raise asyncio.CancelledError("private sink detail")

    with pytest.raises(asyncio.CancelledError):
        await request(AccessAuditMiddleware(cancelled_app, logger=logger, sink=cancelled_sink))

    entries = [json.loads(message) for message in handler.messages]
    request_record = next(entry for entry in entries if "status" in entry)
    warning = next(entry for entry in entries if entry.get("event") == "audit_persistence_failed")
    assert request_record["status"] == 499
    assert warning["request_id"] == request_record["request_id"]
    assert all("private" not in message for message in handler.messages)


@pytest.mark.anyio
async def test_disconnect_without_response_is_audited_as_499():
    logger, handler = capture_logger()

    async def disconnected_app(scope, receive, send):
        assert (await receive())["type"] == "http.disconnect"

    scope = {"type": "http", "method": "POST", "path": "/api/v1/sheets", "state": {}}

    async def receive():
        return {"type": "http.disconnect"}

    async def send(_message):
        raise AssertionError("disconnected request must not send a response")

    await AccessAuditMiddleware(disconnected_app, logger=logger, sink=None)(scope, receive, send)

    assert json.loads(handler.messages[0])["status"] == 499


def test_sink_rejects_untrusted_urls_and_warns_without_configuration_details(monkeypatch):
    for base_url in (
        "http://audit.example.com",
        "https://user:secret@audit.example.com",
        "https://audit.example.com?key=secret",
        "https://audit.example.com?",
        "https://audit.example.com#secret",
    ):
        with pytest.raises(ValueError):
            SupabaseAuditSink(base_url, "service-role-secret")
    assert SupabaseAuditSink("http://127.0.0.1:54321", "service-role-secret")

    logger, handler = capture_logger()
    monkeypatch.setattr("app.access_audit._LOGGER", logger)
    monkeypatch.setenv("SUPABASE_URL", "http://audit.example.com?key=secret")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret")
    assert configured_audit_sink() is None
    assert json.loads(handler.messages[0]) == {"event": "audit_sink_configuration_invalid"}
    assert "secret" not in handler.messages[0]


def lambda_scope_app():
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})
    return app
