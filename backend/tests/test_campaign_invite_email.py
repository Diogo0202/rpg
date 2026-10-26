from __future__ import annotations

import json
import logging

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import campaign_invites as route
from app.services import invite_email


INVITE = "3e000000-0000-4000-8000-000000000001"
TOKEN = "Bearer invite-email-test-token"
ROW = {
    "invite_id": INVITE,
    "email": "convidada@example.test",
    "code": "ABCDEF123456",
    "role": "player",
    "expires_at": "2026-11-09T00:00:00Z",
    "campaign_name": "Mesa do Correio",
    "inviter_name": "Dona da Mesa",
    "email_sent_count": 1,
    "last_email_sent_at": "2026-10-26T12:00:00Z",
}


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(route.router)
    return TestClient(app)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("INVITE_EMAIL_PROVIDER", "smtp")
    monkeypatch.setenv("INVITE_EMAIL_FROM", "RPG Atlas <convites@example.test>")
    monkeypatch.setenv("APP_BASE_URL", "https://rpg.example.test/")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")


def test_unconfigured_provider_returns_503_without_reserving(monkeypatch) -> None:
    for name in ("INVITE_EMAIL_PROVIDER", "INVITE_EMAIL_FROM", "APP_BASE_URL", "RESEND_API_KEY", "SMTP_HOST"):
        monkeypatch.delenv(name, raising=False)

    async def reserve(*_args):
        raise AssertionError("must not reserve a send without a provider")

    monkeypatch.setattr(route, "reserve_send", reserve)
    response = _client().post(f"/api/v1/campaign-invites/{INVITE}/email", headers={"Authorization": TOKEN})
    assert response.status_code == 503
    assert "não está configurado" in response.json()["detail"]


def test_sends_to_the_recipient_stored_in_the_database(monkeypatch, configured) -> None:
    calls: list[tuple] = []
    sent: list[invite_email.InviteEmail] = []

    async def reserve(invite_id, authorization):
        calls.append((str(invite_id), authorization))
        return dict(ROW)

    async def deliver(settings, message):
        sent.append(message)

    monkeypatch.setattr(route, "reserve_send", reserve)
    monkeypatch.setattr(invite_email, "deliver", deliver)
    response = _client().post(
        f"/api/v1/campaign-invites/{INVITE}/email",
        headers={"Authorization": TOKEN},
        json={"email": "atacante@example.test"},
    )
    assert response.status_code == 200
    assert response.json()["email_sent_count"] == 1
    assert calls == [(INVITE, TOKEN)]
    assert sent[0].to == "convidada@example.test"
    assert "ABCD-EF12-3456" in sent[0].text
    assert "https://rpg.example.test/app" in sent[0].html
    assert "Mesa do Correio" in sent[0].subject


def test_invalid_invite_id_is_rejected(configured) -> None:
    response = _client().post("/api/v1/campaign-invites/nao-e-uuid/email", headers={"Authorization": TOKEN})
    assert response.status_code == 422


def test_html_is_escaped_and_subject_has_no_header_injection() -> None:
    row = dict(ROW, campaign_name="<script>x</script>\r\nBcc: vitima@example.test", inviter_name='"><img src=x onerror=1>')
    message = invite_email.build_invite_email(row, "https://rpg.example.test")
    assert "\r" not in message.subject and "\n" not in message.subject
    assert "<script>" not in message.html and "&lt;script&gt;" in message.html
    assert "<img" not in message.html
    with pytest.raises(invite_email.EmailDeliveryError):
        invite_email.build_invite_email(dict(ROW, email="a@example.test\r\nBcc: b@example.test"), "https://rpg.example.test")


def test_reserve_maps_cooldown_and_limit_errors(monkeypatch, configured) -> None:
    def factory(code: str):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.headers["authorization"] == TOKEN
            assert json.loads(request.content) == {"p_invite_id": INVITE}
            return httpx.Response(400, json={"code": code, "message": "x"})
        return handler

    real_client = httpx.AsyncClient
    for code, status in (("54001", 429), ("54000", 429), ("42501", 403), ("55000", 409), ("22023", 422)):
        transport = httpx.MockTransport(factory(code))
        monkeypatch.setattr(route.httpx, "AsyncClient", lambda *a, _t=transport, **k: real_client(transport=_t, **k))
        response = _client().post(f"/api/v1/campaign-invites/{INVITE}/email", headers={"Authorization": TOKEN})
        assert response.status_code == status, code


def test_missing_session_is_refused(configured) -> None:
    response = _client().post(f"/api/v1/campaign-invites/{INVITE}/email")
    assert response.status_code == 401


def test_delivery_failure_is_502_and_logs_no_code(monkeypatch, configured, caplog) -> None:
    async def reserve(*_args):
        return dict(ROW)

    async def deliver(settings, message):
        raise invite_email.EmailDeliveryError("SMTPAuthenticationError")

    monkeypatch.setattr(route, "reserve_send", reserve)
    monkeypatch.setattr(invite_email, "deliver", deliver)
    with caplog.at_level(logging.INFO):
        response = _client().post(f"/api/v1/campaign-invites/{INVITE}/email", headers={"Authorization": TOKEN})
    assert response.status_code == 502
    assert "ABCDEF123456" not in caplog.text and "ABCD-EF12" not in caplog.text
    assert "convidada@example.test" not in caplog.text


def test_smtp_uses_starttls(monkeypatch, configured) -> None:
    events: list[str] = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            events.append(f"connect {host}:{port}")

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def ehlo(self):
            pass

        def starttls(self, context):
            events.append("starttls")

        def login(self, user, password):
            events.append("login")

        def send_message(self, mail):
            events.append(f"send {mail['To']} {mail['Subject']}")

    monkeypatch.setattr(invite_email.smtplib, "SMTP", FakeSMTP)
    settings = invite_email.email_settings()
    message = invite_email.build_invite_email(ROW, settings.app_base_url)
    import asyncio
    asyncio.run(invite_email.deliver(settings, message))
    assert events[0] == "connect smtp.example.test:587"
    assert events[1] == "starttls"
    assert "login" not in events
    assert events[-1].startswith("send convidada@example.test Convite para a campanha")


def test_resend_http_api(monkeypatch) -> None:
    monkeypatch.setenv("INVITE_EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("INVITE_EMAIL_FROM", "convites@example.test")
    monkeypatch.setenv("APP_BASE_URL", "https://rpg.example.test")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"id": "x"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(invite_email.httpx, "AsyncClient", lambda *a, **k: real_client(transport=httpx.MockTransport(handler), **k))
    settings = invite_email.email_settings()
    import asyncio
    asyncio.run(invite_email.deliver(settings, invite_email.build_invite_email(ROW, settings.app_base_url)))
    body = json.loads(captured[0].content)
    assert str(captured[0].url) == invite_email.RESEND_ENDPOINT
    assert captured[0].headers["authorization"] == "Bearer re_test_key"
    assert body["to"] == ["convidada@example.test"]


def test_resend_without_key_is_not_configured(monkeypatch) -> None:
    monkeypatch.setenv("INVITE_EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("INVITE_EMAIL_FROM", "convites@example.test")
    monkeypatch.setenv("APP_BASE_URL", "https://rpg.example.test")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with pytest.raises(invite_email.EmailNotConfigured):
        invite_email.email_settings()
