from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from app.routes import marketplace as route
from app.services import marketplace


USER = "71000000-0000-4000-8000-000000000001"
SYSTEM = "73000000-0000-4000-8000-000000000001"
CAMPAIGN = "72000000-0000-4000-8000-000000000001"
TOKEN = "Bearer verified-marketplace-test-token"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(route.router)
    return TestClient(app)


def _publish_body() -> dict:
    return {
        "template": {"name": "Simple Game", "fields": [{"id": "health", "label": "Health", "kind": "number"}]},
        "description": "A small test system.",
        "tags": ["D20"],
        "author_name": "RPG Author",
        "dependencies": [],
        "rights_confirmed": True,
    }


@pytest.mark.parametrize("fields", [
    [{"id": "result", "label": "Resultado", "kind": "formula", "expression": "1 + +"}],
    [{"id": "first", "label": "A", "kind": "formula", "expression": "second + 1"},
     {"id": "second", "label": "B", "kind": "formula", "expression": "first + 1"}],
    [{"id": "label", "label": "Texto", "kind": "text"},
     {"id": "result", "label": "Resultado", "kind": "formula", "expression": "label + 1"}],
])
def test_publication_rejects_invalid_formula_graph(fields):
    body = _publish_body()
    body["template"]["fields"] = fields
    with pytest.raises(HTTPException) as error:
        marketplace.validate_publication(marketplace.PublishRequest.model_validate(body))
    assert error.value.status_code == 422


def test_publish_requires_authenticated_session(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    response = _client().post("/api/v1/marketplace/systems", json=_publish_body())
    assert response.status_code == 401


def test_publish_rejects_unknown_nested_fields_before_service_insert(monkeypatch) -> None:
    body = _publish_body()
    body["template"]["fields"][0]["eval"] = "__import__('os').system('whoami')"
    response = _client().post("/api/v1/marketplace/systems", headers={"Authorization": TOKEN}, json=body)
    assert response.status_code == 422


def test_recursive_strict_validation_allows_declared_numeric_rule_maps() -> None:
    body = _publish_body()
    body["template"]["fields"] = [
        {"id": "focus", "label": "Focus", "kind": "number"},
        {"id": "stamina", "label": "Stamina", "kind": "number"},
    ]
    body["template"]["creation_rules"] = [{
        "type": "group_distribution", "id": "stats", "label": "Stats", "fields": ["focus", "stamina"],
        "options": [{"label": "Balanced", "counts": {"3": 1}, "rest": 1}],
    }]
    parsed = marketplace.PublishRequest.model_validate(body)
    record = marketplace.validate_publication(parsed)
    assert record["template"]["creation_rules"][0]["options"][0]["counts"] == {"3": 1}


def test_publish_uses_shared_expression_validator(monkeypatch) -> None:
    calls = []

    async def current_user(_authorization):
        return USER

    async def publish(owner_id, record):
        calls.append((owner_id, record))
        return {"id": SYSTEM, **record, "owner_id": owner_id, "updated_at": "2026-10-25T10:00:00Z", "usage_count": 0, "likes": 0, "dislikes": 0}

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "publish_as_service", publish)
    body = _publish_body()
    body["template"]["fields"] = [{"id": "health", "label": "Health", "kind": "formula", "expression": "__import__('os')"}]
    response = _client().post("/api/v1/marketplace/systems", headers={"Authorization": TOKEN}, json=body)
    assert response.status_code == 422
    assert calls == []


def test_publish_sets_automation_and_needs_rights_confirmation(monkeypatch) -> None:
    calls = []

    async def current_user(_authorization):
        return USER

    async def publish(owner_id, record):
        calls.append(record)
        return {"id": SYSTEM, **record, "owner_id": owner_id, "updated_at": "2026-10-25T10:00:00Z", "usage_count": 0, "likes": 0, "dislikes": 0}

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "publish_as_service", publish)
    body = _publish_body()
    body["template"]["fields"] = [{"id": "health", "label": "Health", "kind": "formula", "expression": "stamina + 1"}, {"id": "stamina", "label": "Stamina", "kind": "number"}]
    body["template"]["fields"].reverse()
    response = _client().post("/api/v1/marketplace/systems", headers={"Authorization": TOKEN}, json=body)
    assert response.status_code == 200
    assert response.json()["automation_level"] == "formulas"
    assert calls[0]["name"] == "Simple Game"

    body["rights_confirmed"] = False
    declined = _client().post("/api/v1/marketplace/systems", headers={"Authorization": TOKEN}, json=body)
    assert declined.status_code == 422


def test_vote_report_and_clone_use_authenticated_atomic_rpcs(monkeypatch) -> None:
    rpc_calls = []

    async def current_user(_authorization):
        return USER

    async def request_user(_method, path, authorization, *, payload=None):
        rpc_calls.append((path, authorization, payload))
        return {"id": "84000000-0000-4000-8000-000000000001", "campaign_id": CAMPAIGN, "status": "needs_review"}

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)
    client = _client()

    vote = client.post(f"/api/v1/marketplace/systems/{SYSTEM}/vote", headers={"Authorization": TOKEN}, json={"value": 1})
    assert vote.status_code == 200 and vote.json() == {"ok": True}
    invalid_vote = client.post(f"/api/v1/marketplace/systems/{SYSTEM}/vote", headers={"Authorization": TOKEN}, json={"value": 0})
    assert invalid_vote.status_code == 422
    report = client.post(f"/api/v1/marketplace/systems/{SYSTEM}/report", headers={"Authorization": TOKEN}, json={"reason": "Possible copyrighted text"})
    clone = client.post(f"/api/v1/marketplace/systems/{SYSTEM}/clone", headers={"Authorization": TOKEN}, json={"campaign_id": CAMPAIGN, "idempotency_key": "clone-key-0001"})
    assert report.status_code == 200 and clone.status_code == 200
    assert [call[0] for call in rpc_calls] == ["rpc/marketplace_vote", "rpc/marketplace_report", "rpc/marketplace_clone"]
    assert rpc_calls[1][2]["p_reason"] == "Possible copyrighted text"
    assert rpc_calls[2][2]["p_idempotency_key"] == "clone-key-0001"


def test_admin_moderation_queue_and_resolution_use_restricted_rpcs(monkeypatch) -> None:
    rpc_calls = []

    async def current_user(_authorization):
        return USER

    async def request_user(_method, path, authorization, *, payload=None):
        rpc_calls.append((path, authorization, payload))
        if path.endswith("marketplace_moderation_queue"):
            return [{"id": "84000000-0000-4000-8000-000000000001", "reason": "Possible copied content", "reporter_id": USER, "owner_id": USER}]
        return None

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)
    client = _client()
    queue = client.get("/api/v1/marketplace/moderation/reports", headers={"Authorization": TOKEN})
    resolved = client.post(
        "/api/v1/marketplace/moderation/reports/84000000-0000-4000-8000-000000000001/resolve",
        headers={"Authorization": TOKEN}, json={"action": "remove", "note": "Rights holder confirmed"},
    )
    assert queue.status_code == 200 and len(queue.json()["items"]) == 1
    assert "reporter_id" not in queue.json()["items"][0] and "owner_id" not in queue.json()["items"][0]
    assert resolved.status_code == 200 and resolved.json() == {"ok": True}
    assert [call[0] for call in rpc_calls] == ["rpc/marketplace_moderation_queue", "rpc/marketplace_resolve_report"]
    assert rpc_calls[1][2] == {
        "p_report_id": "84000000-0000-4000-8000-000000000001",
        "p_action": "remove",
        "p_resolution_note": "Rights holder confirmed",
    }


def test_publish_cannot_claim_another_owner_or_status(monkeypatch) -> None:
    async def current_user(_authorization):
        return USER

    async def publish(_owner_id, _record):  # pragma: no cover - must not be reached
        raise AssertionError("publication must be rejected before the service insert")

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "publish_as_service", publish)
    client = _client()
    for extra in ({"owner_id": "71000000-0000-4000-8000-000000000009"}, {"status": "published"}, {"usage_count": 99}):
        body = {**_publish_body(), **extra}
        response = client.post("/api/v1/marketplace/systems", headers={"Authorization": TOKEN}, json=body)
        assert response.status_code == 422, extra


def test_publish_owner_comes_from_verified_session(monkeypatch) -> None:
    calls = []

    async def current_user(authorization):
        assert authorization == TOKEN
        return USER

    async def publish(owner_id, record):
        calls.append((owner_id, record))
        return {"id": SYSTEM, **record, "owner_id": owner_id, "updated_at": "2026-10-25T10:00:00Z", "usage_count": 0, "likes": 0, "dislikes": 0}

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "publish_as_service", publish)
    response = _client().post("/api/v1/marketplace/systems", headers={"Authorization": TOKEN}, json=_publish_body())
    assert response.status_code == 200
    assert calls[0][0] == USER
    assert "owner_id" not in calls[0][1] and "status" not in calls[0][1]
    assert "owner_id" not in response.json()


class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.content = b"x"

    def json(self):
        return self._payload


def _fake_httpx(monkeypatch, response, sent):
    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append({"url": url, "headers": headers, "json": json})
            return response

    monkeypatch.setattr(marketplace.httpx, "AsyncClient", FakeClient)


def test_service_publication_forces_session_owner_and_published_status(monkeypatch) -> None:
    import asyncio

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key")
    sent = []
    _fake_httpx(monkeypatch, _FakeResponse(201, [{"id": SYSTEM}]), sent)
    forged = {"name": "Simple Game", "owner_id": "71000000-0000-4000-8000-000000000009", "status": "hidden"}
    asyncio.run(marketplace.publish_as_service(USER, forged))
    assert sent[0]["url"].endswith("/rest/v1/marketplace_systems")
    assert sent[0]["json"]["owner_id"] == USER
    assert sent[0]["json"]["status"] == "published"


@pytest.mark.parametrize(("status_code", "code", "expected"), [
    (400, "42501", 403), (400, "P0001", 403), (400, "22023", 409), (401, None, 401), (404, None, 404),
])
def test_user_rpc_errors_are_mapped_without_leaking_details(monkeypatch, status_code, code, expected) -> None:
    import asyncio

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    sent = []
    _fake_httpx(monkeypatch, _FakeResponse(status_code, {"code": code, "message": "internal detail"}), sent)
    with pytest.raises(HTTPException) as error:
        asyncio.run(marketplace.request_user("POST", "rpc/marketplace_moderate_system", TOKEN, payload={}))
    assert error.value.status_code == expected
    assert "internal detail" not in str(error.value.detail)
    assert sent[0]["headers"]["Authorization"] == TOKEN


def test_moderator_system_actions_use_restricted_rpc(monkeypatch) -> None:
    rpc_calls = []

    async def current_user(_authorization):
        return USER

    async def request_user(_method, path, authorization, *, payload=None):
        rpc_calls.append((path, authorization, payload))
        return {"hide": "hidden", "restore": "published", "remove": "removed"}[payload["p_action"]]

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)
    client = _client()
    for action, status in (("hide", "hidden"), ("restore", "published"), ("remove", "removed")):
        response = client.post(f"/api/v1/marketplace/moderation/systems/{SYSTEM}", headers={"Authorization": TOKEN}, json={"action": action, "note": "Review"})
        assert response.status_code == 200 and response.json() == {"ok": True, "status": status}
    invalid = client.post(f"/api/v1/marketplace/moderation/systems/{SYSTEM}", headers={"Authorization": TOKEN}, json={"action": "publish"})
    assert invalid.status_code == 422
    assert [call[0] for call in rpc_calls] == ["rpc/marketplace_moderate_system"] * 3
    assert rpc_calls[0][2] == {"p_system_id": SYSTEM, "p_action": "hide", "p_note": "Review"}


def test_moderation_requires_session(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    response = _client().post(f"/api/v1/marketplace/moderation/systems/{SYSTEM}", json={"action": "hide", "note": "Review"})
    assert response.status_code == 401
    for path in ("/api/v1/marketplace/moderation/me", "/api/v1/marketplace/moderation/reports",
                 "/api/v1/marketplace/moderation/systems", "/api/v1/marketplace/moderation/log"):
        assert _client().get(path).status_code == 401, path


def test_moderation_actions_require_a_reason(monkeypatch) -> None:
    async def current_user(_authorization):  # pragma: no cover - validation fails first
        return USER

    async def request_user(*_args, **_kwargs):  # pragma: no cover - must not be reached
        raise AssertionError("moderation without reason must be rejected before the RPC")

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)
    client = _client()
    for body in ({"action": "hide"}, {"action": "hide", "note": None}, {"action": "remove", "note": "   "}):
        response = client.post(f"/api/v1/marketplace/moderation/systems/{SYSTEM}", headers={"Authorization": TOKEN}, json=body)
        assert response.status_code == 422, body
    resolve = client.post(
        "/api/v1/marketplace/moderation/reports/84000000-0000-4000-8000-000000000001/resolve",
        headers={"Authorization": TOKEN}, json={"action": "remove"},
    )
    assert resolve.status_code == 422


def test_moderation_reads_use_restricted_rpcs_and_strip_user_ids(monkeypatch) -> None:
    rpc_calls = []

    async def current_user(_authorization):
        return USER

    async def request_user(_method, path, authorization, *, payload=None):
        rpc_calls.append((path, payload))
        if path.endswith("marketplace_is_moderator"):
            return True
        if path.endswith("marketplace_moderation_systems"):
            return [{"id": SYSTEM, "name": "Lantern", "author_name": "Author", "status": "hidden", "updated_at": "2026-10-26T10:00:00Z", "open_reports": 1, "owner_id": USER}]
        return [{"id": 1, "system_id": SYSTEM, "system_name": "Lantern", "action": "hide", "previous_status": "published",
                 "current_status": "hidden", "note": "Review", "from_report": False, "by_me": True, "created_at": "2026-10-26T10:00:00Z", "moderator_id": USER}]

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)
    client = _client()
    me = client.get("/api/v1/marketplace/moderation/me", headers={"Authorization": TOKEN})
    systems = client.get("/api/v1/marketplace/moderation/systems?status=hidden&q=%20lantern%20", headers={"Authorization": TOKEN})
    log = client.get("/api/v1/marketplace/moderation/log?page=2&limit=10", headers={"Authorization": TOKEN})
    assert me.json() == {"is_moderator": True}
    assert systems.status_code == 200 and "owner_id" not in systems.json()["items"][0]
    assert log.status_code == 200 and "moderator_id" not in log.json()["items"][0] and log.json()["items"][0]["by_me"] is True
    assert [call[0] for call in rpc_calls] == ["rpc/marketplace_is_moderator", "rpc/marketplace_moderation_systems", "rpc/marketplace_moderation_history"]
    assert rpc_calls[1][1] == {"p_status": "hidden", "p_q": "lantern", "p_page": 1, "p_limit": 20}
    assert rpc_calls[2][1] == {"p_page": 2, "p_limit": 10}
    invalid = client.get("/api/v1/marketplace/moderation/systems?status=deleted", headers={"Authorization": TOKEN})
    assert invalid.status_code == 422


def test_non_moderator_reads_are_forbidden_and_access_flag_is_false(monkeypatch) -> None:
    async def current_user(_authorization):
        return USER

    async def request_user(_method, path, _authorization, *, payload=None):
        if path.endswith("marketplace_is_moderator"):
            return False
        raise HTTPException(status_code=403, detail="operação não permitida")

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)
    client = _client()
    assert client.get("/api/v1/marketplace/moderation/me", headers={"Authorization": TOKEN}).json() == {"is_moderator": False}
    for path in ("/api/v1/marketplace/moderation/reports", "/api/v1/marketplace/moderation/systems", "/api/v1/marketplace/moderation/log"):
        assert client.get(path, headers={"Authorization": TOKEN}).status_code == 403, path


def test_hidden_system_detail_is_not_found(monkeypatch) -> None:
    captured = []

    async def request_public(method, path, *, params=None, payload=None):
        captured.append(params)
        return []

    monkeypatch.setattr(marketplace, "request_public", request_public)
    response = _client().get(f"/api/v1/marketplace/systems/{SYSTEM}")
    assert response.status_code == 404
    assert captured[0]["status"] == "eq.published"
