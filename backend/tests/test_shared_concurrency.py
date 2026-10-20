from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from app.shared_concurrency import SharedAdmissionMiddleware, is_serverless_or_multiworker, resolve_backend


class SharedFakeCoordinator:
    def __init__(self, capacity: int = 10):
        self.capacity = capacity
        self.active = 0
        self.peak = 0
        self.tokens: set[str] = set()
        self.lock = asyncio.Lock()
        self.fail_acquire = False
        self.fail_release = False

    async def acquire(self, token: str) -> bool:
        if self.fail_acquire:
            raise RuntimeError("secret should not be logged")
        async with self.lock:
            if self.active >= self.capacity:
                return False
            self.active += 1
            self.peak = max(self.peak, self.active)
            self.tokens.add(token)
            return True

    async def release(self, token: str) -> None:
        if self.fail_release:
            raise RuntimeError("service key must not be logged")
        async with self.lock:
            if token in self.tokens:
                self.tokens.remove(token)
                self.active -= 1


def environment(**extra: str) -> dict[str, str]:
    return {
        "API_CONCURRENCY_BACKEND": "supabase",
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "test-only-service-role-key",
        **extra,
    }


async def request(app: Any, path: str = "/api/v1/example") -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    await app({"type": "http", "method": "GET", "path": path, "headers": []}, receive, send)
    return messages


def status(messages: list[dict[str, Any]]) -> int:
    return next(message["status"] for message in messages if message["type"] == "http.response.start")


@pytest.mark.anyio
async def test_two_middleware_instances_share_one_global_limit_of_ten() -> None:
    coordinator = SharedFakeCoordinator()
    release = asyncio.Event()
    ten_inside = asyncio.Event()
    entered = 0

    async def blocked_app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        nonlocal entered
        entered += 1
        if entered == 10:
            ten_inside.set()
        await release.wait()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    left = SharedAdmissionMiddleware(blocked_app, coordinator=coordinator, environ=environment())
    right = SharedAdmissionMiddleware(blocked_app, coordinator=coordinator, environ=environment())
    tasks = [asyncio.create_task(request(left if index % 2 else right)) for index in range(11)]
    await asyncio.wait_for(ten_inside.wait(), timeout=1)
    release.set()
    results = await asyncio.gather(*tasks)

    assert coordinator.peak == 10
    assert entered == 10
    assert [status(result) for result in results].count(429) == 1
    assert [status(result) for result in results].count(200) == 10
    assert coordinator.active == 0


@pytest.mark.anyio
async def test_process_mode_bypasses_shared_storage_and_calls_inner_local_gate() -> None:
    calls = 0

    async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        nonlocal calls
        calls += 1
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    wrapped = SharedAdmissionMiddleware(app, environ={"API_CONCURRENCY_BACKEND": "process"})
    assert status(await request(wrapped)) == 204
    assert calls == 1


@pytest.mark.anyio
async def test_missing_supabase_configuration_fails_closed_without_calling_app() -> None:
    called = False

    async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        nonlocal called
        called = True

    wrapped = SharedAdmissionMiddleware(
        app,
        environ={"API_CONCURRENCY_BACKEND": "supabase", "VERCEL": "1"},
    )
    messages = await request(wrapped)
    assert status(messages) == 503
    assert called is False


@pytest.mark.anyio
async def test_acquire_failure_returns_503_without_memory_fallback() -> None:
    coordinator = SharedFakeCoordinator()
    coordinator.fail_acquire = True
    called = False

    async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        nonlocal called
        called = True

    wrapped = SharedAdmissionMiddleware(app, coordinator=coordinator, environ=environment())
    assert status(await request(wrapped)) == 503
    assert called is False


def test_backend_detection_requires_shared_storage_for_distributed_runtimes() -> None:
    assert is_serverless_or_multiworker({"VERCEL": "1"})
    assert is_serverless_or_multiworker({"AWS_LAMBDA_FUNCTION_NAME": "api"})
    assert is_serverless_or_multiworker({"K_SERVICE": "api"})
    assert is_serverless_or_multiworker({"WEB_CONCURRENCY": "2"})
    assert resolve_backend({"VERCEL": "1"}) == ("supabase", "configuração Supabase necessária")
    assert resolve_backend({"API_CONCURRENCY_BACKEND": "process", "K_SERVICE": "api"})[1] is not None
    assert resolve_backend({}) == ("process", None)


@pytest.mark.anyio
async def test_timeout_before_response_returns_504_and_releases_lease() -> None:
    coordinator = SharedFakeCoordinator()
    never = asyncio.Event()

    async def blocked_app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await never.wait()

    wrapped = SharedAdmissionMiddleware(
        blocked_app,
        coordinator=coordinator,
        request_timeout=0.02,
        environ=environment(),
    )
    assert status(await request(wrapped)) == 504
    assert coordinator.active == 0


@pytest.mark.anyio
async def test_timeout_after_response_start_rethrows_without_second_headers() -> None:
    coordinator = SharedFakeCoordinator()
    never = asyncio.Event()
    messages: list[dict[str, Any]] = []

    async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await never.wait()

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    wrapped = SharedAdmissionMiddleware(app, coordinator=coordinator, request_timeout=0.02, environ=environment())
    with pytest.raises(TimeoutError):
        await wrapped({"type": "http", "method": "GET", "path": "/api/v1/example", "headers": []}, receive, send)
    assert sum(message["type"] == "http.response.start" for message in messages) == 1
    assert coordinator.active == 0


@pytest.mark.anyio
async def test_release_failure_logs_generic_message_and_keeps_response(caplog: pytest.LogCaptureFixture) -> None:
    coordinator = SharedFakeCoordinator()
    coordinator.fail_release = True

    async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    wrapped = SharedAdmissionMiddleware(app, coordinator=coordinator, environ=environment())
    assert status(await request(wrapped)) == 200
    assert "Shared API admission release failed" in caplog.text
    assert "service key must not be logged" not in caplog.text


@pytest.mark.anyio
async def test_cancellation_releases_lease() -> None:
    coordinator = SharedFakeCoordinator()
    entered = asyncio.Event()
    never = asyncio.Event()

    async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        entered.set()
        await never.wait()

    wrapped = SharedAdmissionMiddleware(app, coordinator=coordinator, environ=environment())
    task = asyncio.create_task(request(wrapped))
    await asyncio.wait_for(entered.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert coordinator.active == 0


def test_migration_has_bounded_global_capacity_and_service_role_only_grants() -> None:
    migration = Path(__file__).parents[2] / "supabase" / "migrations" / "20261018130000_api_concurrency.sql"
    sql = migration.read_text(encoding="utf-8").lower()
    assert "slot_id between 1 and 10" in sql
    assert "generate_series(1, 10)" in sql
    assert "for update skip locked" in sql
    assert "clock_timestamp() + interval '120 seconds'" in sql
    assert "pg_try_advisory_xact_lock" not in sql
    assert "grant execute on function public.api_concurrency_acquire(uuid) to service_role" in sql
    assert "grant execute on function public.api_concurrency_release(uuid) to service_role" in sql
    assert "enable row level security" in sql
