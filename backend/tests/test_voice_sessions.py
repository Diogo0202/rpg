from __future__ import annotations

import json
import logging

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import voice_sessions as route
from app.services import discord_voice


CAMPAIGN = "2e000000-0000-4000-8000-000000000001"
TOKEN = "Bearer voice-user-token"
BOT_TOKEN = "bot-secret-token-value"
SERVICE_KEY = "service-role-secret"
GUILD = "111111111111111111"
CHANNEL = "222222222222222222"
SUPABASE = "https://example.supabase.co"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(route.router)
    return TestClient(app)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", SUPABASE)
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    monkeypatch.setenv("DISCORD_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setenv("DISCORD_GUILD_ID", GUILD)
    monkeypatch.setenv("DISCORD_VOICE_CATEGORY_ID", "333333333333333333")
    monkeypatch.setenv("DISCORD_INVITE_MAX_AGE", "3600")
    monkeypatch.setenv("DISCORD_INVITE_MAX_USES", "10")
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr(discord_voice, "sleep", fake_sleep)
    return slept


class FakeBackend:
    """Supabase (RPC, PATCH, broadcast) e Discord atrás de um único MockTransport."""

    def __init__(self, rpc_row: dict | None = None, rpc_error: tuple[int, dict] | None = None, discord=None):
        self.rpc_row = rpc_row if rpc_row is not None else {
            "campaign_id": CAMPAIGN, "campaign_name": "Mesa\nda Voz", "status": "pending",
            "channel_id": None, "invite_url": None, "expires_at": None, "error": None, "should_create": True,
        }
        self.rpc_error = rpc_error
        self.discord = discord or (lambda request, calls: self.default_discord(request))
        self.requests: list[httpx.Request] = []
        self.discord_calls: list[httpx.Request] = []
        self.patches: list[dict] = []
        self.broadcasts: list[dict] = []

    @staticmethod
    def default_discord(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(f"/guilds/{GUILD}/channels"):
            return httpx.Response(201, json={"id": CHANNEL, "type": 2})
        if request.url.path.endswith(f"/channels/{CHANNEL}/invites"):
            return httpx.Response(200, json={"code": "AbCd123", "expires_at": "2026-10-27T13:00:00+00:00"})
        return httpx.Response(404, json={"message": "Unknown"})

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "discord.com":
            self.discord_calls.append(request)
            return self.discord(request, self.discord_calls)
        if request.url.path == "/rest/v1/rpc/request_campaign_voice_session":
            assert request.headers["authorization"] == TOKEN
            assert json.loads(request.content) == {"p_campaign_id": CAMPAIGN}
            if self.rpc_error:
                return httpx.Response(self.rpc_error[0], json=self.rpc_error[1])
            return httpx.Response(200, json=[self.rpc_row])
        if request.url.path == "/rest/v1/campaign_voice_sessions" and request.method == "PATCH":
            assert request.headers["authorization"] == f"Bearer {SERVICE_KEY}"
            assert request.url.params["campaign_id"] == f"eq.{CAMPAIGN}"
            assert request.url.params["status"] == "eq.pending"
            self.patches.append(json.loads(request.content))
            return httpx.Response(204)
        if request.url.path == "/realtime/v1/api/broadcast":
            self.broadcasts.append(json.loads(request.content))
            return httpx.Response(202)
        return httpx.Response(500)

    def install(self, monkeypatch) -> None:
        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(self.handler)
        monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: real_client(*a, transport=transport, **k))


def _post():
    return _client().post(f"/api/v1/campaigns/{CAMPAIGN}/voice-session", headers={"Authorization": TOKEN})


def test_success_creates_channel_invite_saves_and_broadcasts(monkeypatch, configured, caplog) -> None:
    backend = FakeBackend()
    backend.install(monkeypatch)
    with caplog.at_level(logging.DEBUG):
        response = _post()
    assert response.status_code == 202
    assert response.json()["status"] == "pending" and response.json()["scheduled"] is True

    channel_call, invite_call = backend.discord_calls
    assert channel_call.headers["authorization"] == f"Bot {BOT_TOKEN}"
    assert json.loads(channel_call.content) == {"name": "Mesa Mesa da Voz", "type": 2, "parent_id": "333333333333333333"}
    assert json.loads(invite_call.content)["max_age"] == 3600
    assert json.loads(invite_call.content)["max_uses"] == 10

    assert backend.patches[-1]["status"] == "ready"
    assert backend.patches[-1]["invite_url"] == "https://discord.gg/AbCd123"
    assert backend.patches[-1]["channel_id"] == CHANNEL
    message = backend.broadcasts[-1]["messages"][0]
    assert message["topic"] == f"campaign:{CAMPAIGN}:live" and message["private"] is True
    assert message["event"] == "voice" and message["payload"] == {"status": "ready"}
    assert BOT_TOKEN not in caplog.text and SERVICE_KEY not in caplog.text


def test_valid_invite_is_reused_without_calling_discord(monkeypatch, configured) -> None:
    backend = FakeBackend(rpc_row={
        "campaign_id": CAMPAIGN, "status": "ready", "channel_id": CHANNEL, "invite_url": "https://discord.gg/AbCd123",
        "expires_at": "2026-10-27T13:00:00+00:00", "should_create": False,
    })
    backend.install(monkeypatch)
    response = _post()
    assert response.status_code == 200
    assert response.json()["invite_url"] == "https://discord.gg/AbCd123"
    assert backend.discord_calls == [] and backend.patches == []


def test_rate_limit_retries_once_after_retry_after(monkeypatch, configured) -> None:
    def discord(request, calls):
        if len(calls) == 1:
            return httpx.Response(429, json={"message": "rate limited", "retry_after": 1.5, "global": False})
        return FakeBackend.default_discord(request)

    backend = FakeBackend(discord=discord)
    backend.install(monkeypatch)
    assert _post().status_code == 202
    assert configured == [1.5]
    assert len(backend.discord_calls) == 3
    assert backend.patches[-1]["status"] == "ready"


def test_rate_limit_twice_marks_failed(monkeypatch, configured) -> None:
    backend = FakeBackend(discord=lambda request, calls: httpx.Response(429, json={"retry_after": 0.2}))
    backend.install(monkeypatch)
    assert _post().status_code == 202
    assert len(backend.discord_calls) == 2
    assert backend.patches[-1]["status"] == "failed"
    assert "limite de taxa" in backend.patches[-1]["error"]
    assert backend.broadcasts[-1]["messages"][0]["payload"] == {"status": "failed"}


def test_long_retry_after_is_not_awaited(monkeypatch, configured) -> None:
    backend = FakeBackend(discord=lambda request, calls: httpx.Response(429, json={"retry_after": 120}))
    backend.install(monkeypatch)
    _post()
    assert configured == [] and len(backend.discord_calls) == 1
    assert backend.patches[-1]["status"] == "failed"


@pytest.mark.parametrize("status,fragment", [(403, "recusou o pedido (403)"), (502, "indisponível (502)")])
def test_discord_errors_mark_failed_without_secrets(monkeypatch, configured, caplog, status, fragment) -> None:
    backend = FakeBackend(discord=lambda request, calls: httpx.Response(status, json={"message": "Missing Permissions"}))
    backend.install(monkeypatch)
    with caplog.at_level(logging.DEBUG):
        _post()
    error = backend.patches[-1]["error"]
    assert backend.patches[-1]["status"] == "failed" and fragment in error
    assert BOT_TOKEN not in error and BOT_TOKEN not in caplog.text


def test_timeout_marks_failed(monkeypatch, configured) -> None:
    def discord(request, calls):
        raise httpx.ReadTimeout("timed out", request=request)

    backend = FakeBackend(discord=discord)
    backend.install(monkeypatch)
    _post()
    assert backend.patches[-1] == {**backend.patches[-1], "status": "failed", "error": "o Discord não respondeu a tempo"}


def test_deleted_channel_is_recreated(monkeypatch, configured) -> None:
    old = "444444444444444444"

    def discord(request, calls):
        if request.url.path.endswith(f"/channels/{old}/invites"):
            return httpx.Response(404, json={"message": "Unknown Channel", "code": 10003})
        return FakeBackend.default_discord(request)

    row = {"campaign_id": CAMPAIGN, "campaign_name": "Mesa", "status": "pending", "channel_id": old, "should_create": True}
    backend = FakeBackend(rpc_row=row, discord=discord)
    backend.install(monkeypatch)
    _post()
    assert [call.url.path.rsplit("/", 1)[-1] for call in backend.discord_calls] == ["invites", "channels", "invites"]
    assert backend.patches[-1]["channel_id"] == CHANNEL


def test_without_configuration_returns_503_and_touches_nothing(monkeypatch) -> None:
    for name in ("DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_VOICE_CATEGORY_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SUPABASE_URL", SUPABASE)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    backend = FakeBackend()
    backend.install(monkeypatch)
    response = _post()
    assert response.status_code == 503
    assert "não está configurada" in response.json()["detail"]
    assert backend.requests == []
    assert _client().get("/api/v1/voice-sessions/config").json() == {"enabled": False}


def test_missing_service_key_is_not_configured(monkeypatch, configured) -> None:
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    assert _post().status_code == 503


def test_config_reports_enabled(configured) -> None:
    assert _client().get("/api/v1/voice-sessions/config").json() == {"enabled": True}


def test_non_narrator_gets_403_and_nothing_is_scheduled(monkeypatch, configured) -> None:
    backend = FakeBackend(rpc_error=(400, {"code": "42501", "message": "only the campaign owner or a master"}))
    backend.install(monkeypatch)
    response = _post()
    assert response.status_code == 403
    assert "dono ou um mestre" in response.json()["detail"]
    assert backend.discord_calls == [] and backend.patches == []


def test_missing_session_is_refused(configured) -> None:
    response = _client().post(f"/api/v1/campaigns/{CAMPAIGN}/voice-session")
    assert response.status_code == 401


def test_settings_repr_hides_secrets(configured) -> None:
    text = repr(discord_voice.voice_settings())
    assert BOT_TOKEN not in text and SERVICE_KEY not in text
