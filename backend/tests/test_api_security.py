from __future__ import annotations

import json

import httpx
import pytest

from app.security import ApiSecurityMiddleware, BoundedRateLimiter, Limit

ASGIAsyncClient = httpx.AsyncClient


class MockAuthClient:
    def __init__(self, *, timeout: int):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, url: str, headers: dict[str, str]):
        assert url.endswith("/auth/v1/user")
        assert headers["apikey"] == "test-publishable-key"
        assert headers["Authorization"] == "Bearer dummy-jwt"
        return httpx.Response(200, json={"id": "30000000-0000-4000-8000-000000000001", "email": "test@example.invalid"})


@pytest.fixture
def anyio_backend():
    return "asyncio"


def make_app():
    async def app(scope, receive, send):
        state = scope.get("state", {})
        body = json.dumps({"user": state.get("supabase_user"), "worker": state.get("extraction_worker_authenticated")}).encode()
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})
    return app


async def _user():
    return {"id": "30000000-0000-4000-8000-000000000001"}


async def request(app, path="/api/v1/private", method="GET", headers=None, client="198.51.100.9", content=None):
    transport = httpx.ASGITransport(app=app, client=(client, 1234))
    async with ASGIAsyncClient(transport=transport, base_url="http://test") as client_http:
        return await client_http.request(method, path, headers=headers, content=content)


@pytest.mark.anyio
async def test_health_and_options_are_public_and_options_does_not_consume(monkeypatch):
    limiter = BoundedRateLimiter(capacity=1)
    secured = ApiSecurityMiddleware(make_app(), limiter)
    assert (await request(secured, "/health")).status_code == 200
    assert (await request(secured, "/api/v1/private", method="OPTIONS")).status_code == 200
    # A full one-slot limiter still accepts the first real request.
    assert (await request(secured)).status_code == 401


@pytest.mark.anyio
async def test_api_requires_verified_supabase_user_and_stores_it(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")
    monkeypatch.setattr("app.security.httpx.AsyncClient", MockAuthClient)
    secured = ApiSecurityMiddleware(make_app())
    response = await request(secured, headers={"Authorization": "Bearer dummy-jwt"})
    assert response.status_code == 200
    assert response.json()["user"]["id"] == "30000000-0000-4000-8000-000000000001"


@pytest.mark.anyio
async def test_bearer_without_configuration_is_503_but_missing_bearer_is_401(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    secured = ApiSecurityMiddleware(make_app())
    missing = await request(secured)
    configured_missing_session = await request(secured, headers={"Authorization": "Bearer dummy-jwt"})
    assert missing.status_code == 401
    assert configured_missing_session.status_code == 503


@pytest.mark.anyio
async def test_invalid_auth_user_id_fails_closed_as_401(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")

    class InvalidUserClient(MockAuthClient):
        async def get(self, url: str, headers: dict[str, str]):
            return httpx.Response(200, json={"id": "not-a-uuid"})

    monkeypatch.setattr("app.security.httpx.AsyncClient", InvalidUserClient)
    response = await request(ApiSecurityMiddleware(make_app()), headers={"Authorization": "Bearer dummy-jwt"})
    assert response.status_code == 401


@pytest.mark.anyio
@pytest.mark.parametrize("upstream_status", [429, 500, 503])
async def test_supabase_auth_throttle_or_outage_returns_503(monkeypatch, upstream_status):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")

    class UnavailableAuthClient(MockAuthClient):
        async def get(self, url: str, headers: dict[str, str]):
            return httpx.Response(upstream_status)

    monkeypatch.setattr("app.security.httpx.AsyncClient", UnavailableAuthClient)
    response = await request(ApiSecurityMiddleware(make_app()), headers={"Authorization": "Bearer dummy-jwt"})
    assert response.status_code == 503


@pytest.mark.anyio
async def test_worker_token_is_separate_and_ip_limited(monkeypatch):
    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "dummy-worker-secret")
    secured = ApiSecurityMiddleware(make_app())
    response = await request(secured, "/api/v1/extractions/draft", method="POST", headers={"X-Worker-Token": "dummy-worker-secret"})
    assert response.status_code == 200
    assert response.json() == {"user": None, "worker": True}


@pytest.mark.anyio
async def test_worker_limit_is_applied_by_ip(monkeypatch):
    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "dummy-worker-secret")
    from app import security
    old_limit = security._IP_LIMITS["extraction"]
    security._IP_LIMITS["extraction"] = Limit(1, 60)
    try:
        secured = ApiSecurityMiddleware(make_app())
        headers = {"X-Worker-Token": "dummy-worker-secret"}
        first = await request(secured, "/api/v1/extractions/draft", method="POST", headers=headers)
        second = await request(secured, "/api/v1/extractions/draft", method="POST", headers=headers)
        assert first.status_code == 200
        assert second.status_code == 429
        assert second.headers["retry-after"]
    finally:
        security._IP_LIMITS["extraction"] = old_limit


@pytest.mark.anyio
async def test_worker_missing_or_invalid_secret_keeps_worker_statuses(monkeypatch):
    monkeypatch.delenv("EXTRACTION_WORKER_TOKEN", raising=False)
    secured = ApiSecurityMiddleware(make_app())
    missing = await request(secured, "/api/v1/extractions/draft", method="POST")
    assert missing.status_code == 503
    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "dummy-worker-secret")
    invalid = await request(secured, "/api/v1/extractions/draft", method="POST", headers={"X-Worker-Token": "wrong"})
    assert invalid.status_code == 403
    other_path = await request(secured, "/api/v1/extractions/other", method="POST", headers={"X-Worker-Token": "dummy-worker-secret"})
    assert other_path.status_code == 401


@pytest.mark.anyio
async def test_authenticated_request_body_is_bounded(monkeypatch):
    monkeypatch.setattr("app.security.verify_supabase_user", lambda _: _user())
    secured = ApiSecurityMiddleware(make_app())
    response = await request(
        secured,
        method="POST",
        headers={"Authorization": "Bearer dummy-jwt"},
        content=b"x" * (1_048_576 + 1),
    )
    assert response.status_code == 413


@pytest.mark.anyio
async def test_uid_quota_applies_across_ip_addresses(monkeypatch):
    from app import security
    old_limit = security._USER_LIMITS["default"]
    security._USER_LIMITS["default"] = Limit(1, 60)

    async def verified_user(_: str):
        return await _user()

    monkeypatch.setattr("app.security.verify_supabase_user", verified_user)
    try:
        secured = ApiSecurityMiddleware(make_app())
        headers = {"Authorization": "Bearer dummy-jwt"}
        first = await request(secured, headers=headers, client="198.51.100.1")
        second = await request(secured, headers=headers, client="198.51.100.2")
        assert first.status_code == 200
        assert second.status_code == 429
        assert second.headers["retry-after"]
    finally:
        security._USER_LIMITS["default"] = old_limit


@pytest.mark.anyio
async def test_worker_non_ascii_invalid_token_returns_403(monkeypatch):
    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "dummy-worker-secret")
    response = await request(
        ApiSecurityMiddleware(make_app()),
        "/api/v1/extractions/draft",
        method="POST",
        headers=[(b"X-Worker-Token", b"token-invalido-\xe7")],
    )
    assert response.status_code == 403


@pytest.mark.anyio
async def test_disconnected_request_is_not_forwarded_to_application(monkeypatch):
    called = False
    monkeypatch.setattr("app.security.verify_supabase_user", lambda _: _user())

    async def app(scope, receive, send):
        nonlocal called
        called = True

    async def receive():
        return {"type": "http.disconnect"}

    sent = []
    async def send(message):
        sent.append(message)

    secured = ApiSecurityMiddleware(app)
    await secured(
        {"type": "http", "path": "/api/v1/private", "method": "GET", "headers": [(b"authorization", b"Bearer dummy-jwt")], "client": ("198.51.100.9", 1234)},
        receive,
        send,
    )
    assert not called
    assert sent == []


@pytest.mark.anyio
async def test_replay_receive_delegates_disconnect_after_buffered_body(monkeypatch):
    monkeypatch.setattr("app.security.verify_supabase_user", lambda _: _user())
    received = []

    async def app(scope, receive, send):
        received.append(await receive())
        received.append(await receive())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    events = iter([
        {"type": "http.request", "body": b"abc", "more_body": False},
        {"type": "http.disconnect"},
    ])

    async def receive():
        return next(events)

    async def send(_message):
        return None

    await ApiSecurityMiddleware(app)(
        {"type": "http", "path": "/api/v1/private", "method": "POST", "headers": [(b"authorization", b"Bearer dummy-jwt")], "client": ("198.51.100.9", 1234)},
        receive,
        send,
    )
    assert received == [
        {"type": "http.request", "body": b"abc", "more_body": False},
        {"type": "http.disconnect"},
    ]


@pytest.mark.anyio
async def test_duplicate_authentication_headers_are_rejected():
    secured = ApiSecurityMiddleware(make_app())
    response = await request(
        secured,
        headers=[("Authorization", "Bearer dummy-jwt"), ("Authorization", "Bearer another-jwt")],
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_duplicate_worker_headers_are_rejected(monkeypatch):
    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "dummy-worker-secret")
    secured = ApiSecurityMiddleware(make_app())
    response = await request(
        secured,
        "/api/v1/extractions/draft",
        method="POST",
        headers=[("X-Worker-Token", "dummy-worker-secret"), ("X-Worker-Token", "wrong")],
    )
    assert response.status_code == 403


@pytest.mark.anyio
async def test_rate_limit_returns_retry_after_and_forwarded_ip_is_ignored():
    limiter = BoundedRateLimiter(capacity=10)
    secured = ApiSecurityMiddleware(make_app(), limiter)
    headers = {"X-Forwarded-For": "203.0.113.99"}
    # Without credentials, consume the per-IP quota before auth.
    from app import security
    old_limit = security._IP_LIMITS["default"]
    security._IP_LIMITS["default"] = Limit(1, 60)
    try:
        assert (await request(secured, headers=headers, client="198.51.100.9")).status_code == 401
        blocked = await request(secured, headers=headers, client="198.51.100.9")
        assert blocked.status_code == 429
        assert blocked.headers["retry-after"]
        assert (await request(secured, headers=headers, client="198.51.100.10")).status_code == 401
    finally:
        security._IP_LIMITS["default"] = old_limit


def test_limiter_expiration_is_fixed_and_capacity_fails_closed():
    now = [100.0]
    limiter = BoundedRateLimiter(capacity=1, clock=lambda: now[0])
    limit = Limit(2, 10)
    assert limiter.consume(("ip:one", "default"), limit)[0]
    now[0] = 105.0
    assert limiter.consume(("ip:one", "default"), limit)[0]
    assert limiter.consume(("ip:one", "default"), limit)[0] is False
    assert limiter.consume(("ip:two", "default"), limit)[0] is False
    now[0] = 111.0
    assert limiter.consume(("ip:two", "default"), limit)[0]
