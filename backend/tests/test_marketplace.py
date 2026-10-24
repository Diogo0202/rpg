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
        if path.endswith("marketplace_list_reports"):
            return [{"id": "84000000-0000-4000-8000-000000000001", "reason": "Possible copied content"}]
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
    assert resolved.status_code == 200 and resolved.json() == {"ok": True}
    assert [call[0] for call in rpc_calls] == ["rpc/marketplace_list_reports", "rpc/marketplace_resolve_report"]
    assert rpc_calls[1][2] == {
        "p_report_id": "84000000-0000-4000-8000-000000000001",
        "p_action": "remove",
        "p_resolution_note": "Rights holder confirmed",
    }
