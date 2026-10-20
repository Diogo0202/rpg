from __future__ import annotations

import asyncio

import httpx
import pytest

from app.security import ApiSecurityMiddleware, ConcurrencyGate


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def request(app, path="/api/v1/test", client_id=1):
    transport = httpx.ASGITransport(app=app, client=(f"198.51.100.{client_id}", 1234))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path, headers={"Authorization": "Bearer test"})


async def respond(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


@pytest.mark.anyio
async def test_ten_requests_across_users_and_tools_block_eleventh_before_auth(monkeypatch):
    entered = asyncio.Event()
    resume = asyncio.Event()
    verified = 0
    running = 0

    async def verify(_):
        nonlocal verified
        verified += 1
        return {"id": f"30000000-0000-4000-8000-{verified:012d}"}

    async def blocked_app(scope, receive, send):
        nonlocal running
        if scope["path"] == "/health":
            await respond(scope, receive, send)
            return
        running += 1
        if running == 10:
            entered.set()
        await resume.wait()
        await respond(scope, receive, send)

    monkeypatch.setattr("app.security.verify_supabase_user", verify)
    gate = ConcurrencyGate()
    secured = ApiSecurityMiddleware(blocked_app, concurrency=gate)
    paths = ["/api/v1/dice/roll", "/api/v1/sheets/calculate", "/api/v1/maps/generate"]
    tasks = [asyncio.create_task(request(secured, paths[i % 3], i + 1)) for i in range(10)]
    try:
        await asyncio.wait_for(entered.wait(), 2)
        assert gate.active == 10
        denied = await request(secured, "/api/v1/other", 11)
        assert denied.status_code == 429
        assert denied.headers["retry-after"] == "1"
        assert verified == 10
        # Health remains available while admission is saturated.
        assert (await request(secured, "/health")).status_code == 200
    finally:
        resume.set()
        await asyncio.gather(*tasks)
    assert gate.active == 0
    assert (await request(secured)).status_code == 200


@pytest.mark.anyio
async def test_authentication_itself_occupies_a_slot_and_cancellation_releases(monkeypatch):
    entered = asyncio.Event()
    never = asyncio.Event()

    async def verify(_):
        entered.set()
        await never.wait()

    monkeypatch.setattr("app.security.verify_supabase_user", verify)
    gate = ConcurrencyGate(1)
    secured = ApiSecurityMiddleware(respond, concurrency=gate)
    task = asyncio.create_task(request(secured))
    await asyncio.wait_for(entered.wait(), 2)
    assert (await request(secured, client_id=2)).status_code == 429
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert gate.active == 0


@pytest.mark.anyio
async def test_application_exception_and_auth_denial_release_slots(monkeypatch):
    async def verify(_):
        return {"id": "30000000-0000-4000-8000-000000000001"}

    async def broken(scope, receive, send):
        raise RuntimeError("application failed")

    monkeypatch.setattr("app.security.verify_supabase_user", verify)
    gate = ConcurrencyGate(1)
    with pytest.raises(RuntimeError, match="application failed"):
        await request(ApiSecurityMiddleware(broken, concurrency=gate))
    assert gate.active == 0

    from app.security import AuthenticationError

    async def denied(_):
        raise AuthenticationError(401)

    monkeypatch.setattr("app.security.verify_supabase_user", denied)
    assert (await request(ApiSecurityMiddleware(respond, concurrency=gate))).status_code == 401
    assert gate.active == 0


@pytest.mark.anyio
async def test_disconnect_and_oversized_body_release_slot(monkeypatch):
    async def verify(_):
        return {"id": "30000000-0000-4000-8000-000000000001"}

    monkeypatch.setattr("app.security.verify_supabase_user", verify)
    gate = ConcurrencyGate(1)
    secured = ApiSecurityMiddleware(respond, concurrency=gate)
    scope = {"type": "http", "method": "POST", "path": "/api/v1/test", "headers": []}
    messages = []

    async def send(message):
        messages.append(message)

    async def disconnected():
        return {"type": "http.disconnect"}

    await secured(scope, disconnected, send)
    assert messages == []
    assert gate.active == 0

    async def oversized():
        return {"type": "http.request", "body": b"x" * 1_048_577}

    await secured(scope, oversized, send)
    assert messages[0]["status"] == 413
    assert gate.active == 0


@pytest.mark.parametrize("capacity", [0, 11, -1, True, 1.5, "10"])
def test_capacity_cannot_exceed_ten_or_be_invalid(capacity):
    with pytest.raises(ValueError):
        ConcurrencyGate(capacity)


def test_environment_cannot_raise_limit(monkeypatch):
    monkeypatch.setenv("API_MAX_CONCURRENT_REQUESTS", "11")
    with pytest.raises(ValueError):
        ApiSecurityMiddleware(respond)
