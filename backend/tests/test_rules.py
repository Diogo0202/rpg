from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import rules


rules_app = FastAPI()
rules_app.include_router(rules.router)
client = TestClient(rules_app)
CAMPAIGN = "00000000-0000-0000-0000-000000000001"
SOURCE = "00000000-0000-0000-0000-000000000002"


def test_rule_endpoints_require_a_session_before_returning_source_text(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN}/sources/{SOURCE}/pages/1")
    assert response.status_code == 401


def test_rule_endpoints_require_supabase_configuration(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get(
        f"/api/v1/campaigns/{CAMPAIGN}/rules/search?q=initiative",
        headers={"Authorization": "Bearer user-token"},
    )
    assert response.status_code == 503


def test_search_forwards_user_jwt_and_calls_scoped_rpc(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    calls: list[dict[str, Any]] = []

    class Response:
        status_code = 200
        content = b"[]"

        def json(self) -> list[dict[str, Any]]:
            return [{"source_id": SOURCE, "source_title": "Manual aprovado", "page_number": 3, "excerpt": "..."}]

    class FakeClient:
        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def get(self, url: str, *, headers: dict[str, str]) -> Response:
            calls.append({"method": "GET", "url": url, "headers": headers})
            return Response()

        async def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> Response:
            calls.append({"method": "POST", "url": url, "headers": headers, "json": json})
            return Response()

    monkeypatch.setattr(rules.httpx, "AsyncClient", lambda **_: FakeClient())
    response = client.get(
        f"/api/v1/campaigns/{CAMPAIGN}/rules/search?q=  initiative  &limit=4",
        headers={"Authorization": "Bearer user-session"},
    )
    assert response.status_code == 200
    assert response.json()[0]["page_number"] == 3
    assert calls[0]["url"].endswith("/auth/v1/user")
    assert calls[1]["url"].endswith("/rest/v1/rpc/search_campaign_rules")
    assert calls[1]["headers"]["Authorization"] == "Bearer user-session"
    assert calls[1]["headers"]["apikey"] == "public-test-key"
    assert calls[1]["json"] == {"p_campaign_id": CAMPAIGN, "p_query": "initiative", "p_limit": 4}


def test_page_returns_not_found_for_rpc_with_no_authorized_content(monkeypatch) -> None:
    async def empty_result(function: str, payload: dict[str, Any], authorization: str | None) -> list[Any]:
        assert function == "get_campaign_rule_page"
        return []

    monkeypatch.setattr(rules, "_authenticated_rpc", empty_result)
    response = client.get(
        f"/api/v1/campaigns/{CAMPAIGN}/sources/{SOURCE}/pages/12",
        headers={"Authorization": "Bearer user-session"},
    )
    assert response.status_code == 404


def test_page_rejects_non_positive_page_number() -> None:
    response = client.get(
        f"/api/v1/campaigns/{CAMPAIGN}/sources/{SOURCE}/pages/0",
        headers={"Authorization": "Bearer user-session"},
    )
    assert response.status_code == 422
