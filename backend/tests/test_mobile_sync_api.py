from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import mobile_sync
from app.services.mobile_sync import SyncPushRequest


USER_ID = "10000000-0000-0000-0000-000000000001"
CAMPAIGN_ID = "20000000-0000-0000-0000-000000000001"
DEVICE_ID = "30000000-0000-0000-0000-000000000001"
OPERATION_ID = "40000000-0000-0000-0000-000000000001"
ENTITY_ID = "50000000-0000-0000-0000-000000000001"
JWT = "Bearer verified-test-jwt"


class VerifiedTestState:
    """Test-only stand-in for the verified identity installed by ApiSecurityMiddleware."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and any(key.lower() == b"authorization" and value == JWT.encode() for key, value in scope.get("headers", [])):
            scope.setdefault("state", {})["supabase_user"] = {"id": USER_ID}
        await self.app(scope, receive, send)


app = FastAPI()
app.include_router(mobile_sync.router)
app.add_middleware(VerifiedTestState)
client = TestClient(app)


def mutation(*, action="create", changes=None, entity_type="campaign_factions", entity_id=ENTITY_ID, base_version=0):
    if changes is None:
        changes = [{"path": ["name"], "before": {"exists": False}, "after": {"exists": True, "value": "Facção Ω"}}]
    return {
        "operation_id": OPERATION_ID,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "base_version": base_version,
        "changes": changes,
        "depends_on": [],
    }


def push_payload(mutations=None):
    return {"protocol_version": 1, "device_id": DEVICE_ID, "mutations": mutations or [mutation()]}


class StubClient:
    def __init__(self, response, captured):
        self.response = response
        self.captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def request(self, method, url, **kwargs):
        self.captured.append((method, url, kwargs))
        return self.response


def stub_upstream(monkeypatch, *, status=200, body=None, content=None, headers=None):
    captured = []
    raw = content if content is not None else json.dumps(body if body is not None else {"protocol_version": 1, "campaign_id": CAMPAIGN_ID, "cursor": 1, "results": [{"operation_id": OPERATION_ID, "status": "applied"}]})
    response = SimpleNamespace(status_code=status, content=raw.encode() if isinstance(raw, str) else raw, headers=headers or {})
    response.json = lambda: json.loads(response.content)
    monkeypatch.setenv("SUPABASE_URL", "https://unit-test.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable-only")
    monkeypatch.setattr(mobile_sync.httpx, "AsyncClient", lambda **kwargs: StubClient(response, captured))
    return captured


def test_push_forwards_operation_and_uses_user_jwt_and_publishable_key(monkeypatch):
    calls = stub_upstream(monkeypatch)
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/push", headers={"Authorization": JWT}, json=push_payload())
    assert response.status_code == 200
    method, url, kwargs = calls[0]
    assert method == "POST" and url.endswith("/rpc/mobile_sync_push")
    assert kwargs["headers"]["Authorization"] == JWT
    assert kwargs["headers"]["apikey"] == "publishable-only"
    assert kwargs["json"]["p_mutations"][0]["operation_id"] == OPERATION_ID
    assert kwargs["json"]["p_mutations"][0]["entity_id"] == ENTITY_ID
    assert "owner_id" not in kwargs["json"]["p_mutations"][0]


def test_request_requires_explicit_verified_session_state():
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/changes?cursor=0")
    assert response.status_code == 401


def test_dependency_may_reference_receipt_from_an_earlier_batch():
    first = mutation()
    second = mutation()
    second["operation_id"] = "40000000-0000-0000-0000-000000000002"
    second["depends_on"] = ["40000000-0000-0000-0000-000000000003"]
    parsed = SyncPushRequest.model_validate(push_payload([first, second]))
    assert str(parsed.mutations[1].depends_on[0]) == second["depends_on"][0]


def test_dependency_cannot_point_to_later_operation_in_same_batch():
    first = mutation()
    first["depends_on"] = ["40000000-0000-0000-0000-000000000002"]
    second = mutation()
    second["operation_id"] = first["depends_on"][0]
    with pytest.raises(Exception):
        SyncPushRequest.model_validate(push_payload([first, second]))


@pytest.mark.parametrize(("upstream_status", "expected_status"), [(401, 403), (403, 403), (429, 429), (503, 503)])
def test_upstream_statuses_are_mapped_without_leaking_details(monkeypatch, upstream_status, expected_status):
    calls = stub_upstream(monkeypatch, status=upstream_status, body={"secret": "database internals"})
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/push", headers={"Authorization": JWT}, json=push_payload())
    assert response.status_code == expected_status
    assert "database internals" not in response.text
    assert len(calls) == 1


def test_malformed_rpc_json_maps_to_502(monkeypatch):
    stub_upstream(monkeypatch, content="<html>bad gateway</html>")
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/push", headers={"Authorization": JWT}, json=push_payload())
    assert response.status_code == 502
    assert "bad gateway" not in response.text


def test_rpc_response_with_unknown_fields_maps_to_502(monkeypatch):
    body = {"protocol_version": 1, "campaign_id": CAMPAIGN_ID, "cursor": 1, "results": [], "owner_id": USER_ID}
    stub_upstream(monkeypatch, body=body)
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/push", headers={"Authorization": JWT}, json=push_payload())
    assert response.status_code == 502


def test_changes_accepts_tombstone_version_dto(monkeypatch):
    body = {
        "protocol_version": 1,
        "campaign_id": CAMPAIGN_ID,
        "cursor": 4,
        "has_more": False,
        "changes": [{"revision": 4, "version": 3, "entity_type": "campaign_factions", "entity_id": ENTITY_ID, "action": "delete", "tombstone": True}],
    }
    stub_upstream(monkeypatch, body=body)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/changes?cursor=2", headers={"Authorization": JWT})
    assert response.status_code == 200, response.text
    assert response.json()["changes"][0]["version"] == 3


def test_maps_record_accepts_all_server_columns(monkeypatch):
    body = {
        "protocol_version": 1,
        "campaign_id": CAMPAIGN_ID,
        "cursor": 1,
        "has_more": False,
        "records": [{"entity_type": "maps", "entity_id": ENTITY_ID, "version": 1, "data": {
            "id": ENTITY_ID, "campaign_id": CAMPAIGN_ID, "name": "Mapa", "document": {"version": 1, "layers": []},
            "grid_kind": "square", "isometric": False, "created_by": USER_ID, "version": 1, "updated_at": "2026-10-19T00:00:00Z",
        }}],
        "next_after_id": ENTITY_ID,
    }
    stub_upstream(monkeypatch, body=body)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/snapshot?entity_type=maps", headers={"Authorization": JWT})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(("event_version", "current_version", "expected_status"), [(2, 3, 200), (3, 2, 502)])
def test_change_accepts_newer_current_record_but_never_older(monkeypatch, event_version, current_version, expected_status):
    body = {
        "protocol_version": 1,
        "campaign_id": CAMPAIGN_ID,
        "cursor": 4,
        "has_more": False,
        "changes": [{
            "revision": 4, "version": event_version, "entity_type": "maps", "entity_id": ENTITY_ID, "action": "update",
            "record": {"entity_type": "maps", "entity_id": ENTITY_ID, "version": current_version, "data": {
                "id": ENTITY_ID, "campaign_id": CAMPAIGN_ID, "name": "Mapa", "document": {"version": 1, "layers": []},
                "grid_kind": "square", "isometric": False, "created_by": USER_ID, "version": 1, "updated_at": "2026-10-19T00:00:00Z",
            }},
        }],
    }
    stub_upstream(monkeypatch, body=body)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/changes?cursor=3", headers={"Authorization": JWT})
    assert response.status_code == expected_status, response.text


def test_unsafe_javascript_integer_in_sync_response_maps_to_502(monkeypatch):
    body = {"protocol_version": 1, "campaign_id": CAMPAIGN_ID, "cursor": 2**53, "results": [{"operation_id": OPERATION_ID, "status": "applied"}]}
    stub_upstream(monkeypatch, body=body)
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/push", headers={"Authorization": JWT}, json=push_payload())
    assert response.status_code == 502


@pytest.mark.parametrize("change", [
    {"revision": 1, "version": 1, "entity_type": "campaign_factions", "entity_id": ENTITY_ID, "action": "delete"},
    {"revision": 1, "version": 1, "entity_type": "campaign_factions", "entity_id": ENTITY_ID, "action": "delete", "tombstone": False},
    {"revision": 1, "version": 1, "entity_type": "campaign_factions", "entity_id": ENTITY_ID, "action": "update", "tombstone": True},
    {"revision": 1, "version": 1, "entity_type": "campaign_factions", "entity_id": ENTITY_ID, "action": "update", "record": {"entity_type": "campaign_factions", "entity_id": "50000000-0000-0000-0000-000000000002", "version": 1, "data": {"id": ENTITY_ID, "campaign_id": CAMPAIGN_ID}}},
])
def test_malformed_change_dtos_map_to_502(monkeypatch, change):
    stub_upstream(monkeypatch, body={"protocol_version": 1, "campaign_id": CAMPAIGN_ID, "cursor": 1, "has_more": False, "changes": [change]})
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/changes?cursor=0", headers={"Authorization": JWT})
    assert response.status_code == 502


def test_capabilities_uses_rls_visible_campaign_and_role(monkeypatch):
    calls = []

    async def fake_upstream(method, path, authorization, *, params=None, payload=None):
        calls.append((path, authorization, params))
        if path == "campaigns":
            return [{"id": CAMPAIGN_ID, "owner_id": "90000000-0000-0000-0000-000000000001"}]
        if path == "campaign_members":
            return [{"role": "master"}]
        raise AssertionError(path)

    monkeypatch.setattr(mobile_sync, "_upstream", fake_upstream)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/capabilities", headers={"Authorization": JWT})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["role"] == "master"
    assert body["entity_fields"]["maps"] == sorted(mobile_sync.ENTITY_FIELDS["maps"])
    assert "campaigns" not in body["entity_fields"]
    assert calls[0][1] == JWT and calls[1][1] == JWT
    assert calls[1][2]["user_id"] == f"eq.{USER_ID}"


def test_capabilities_rejects_unknown_membership_role_as_bad_upstream(monkeypatch):
    async def fake_upstream(method, path, authorization, *, params=None, payload=None):
        if path == "campaigns":
            return [{"id": CAMPAIGN_ID, "owner_id": "90000000-0000-0000-0000-000000000001"}]
        return [{"role": "superuser"}]

    monkeypatch.setattr(mobile_sync, "_upstream", fake_upstream)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/capabilities", headers={"Authorization": JWT})
    assert response.status_code == 502


@pytest.mark.parametrize("bad", [
    {"path": ["name"], "before": {"exists": False}, "after": {"exists": True, "value": float("nan")}},
    {"path": ["constructor"], "before": {"exists": False}, "after": {"exists": True, "value": "x"}},
    {"path": ["body", "1"], "before": {"exists": False}, "after": {"exists": True, "value": "x"}},
])
def test_invalid_json_values_proto_keys_and_array_indices_rejected(bad):
    with pytest.raises(Exception):
        SyncPushRequest.model_validate(push_payload([mutation(changes=[bad], entity_type="world_entities")]))


def test_body_cannot_set_owner_or_unknown_fields():
    record = mutation()
    record["owner_id"] = USER_ID
    with pytest.raises(Exception):
        SyncPushRequest.model_validate(push_payload([record]))


def test_unicode_is_preserved_and_per_operation_size_is_bounded():
    accepted = SyncPushRequest.model_validate(push_payload([mutation(changes=[{"path": ["name"], "before": {"exists": False}, "after": {"exists": True, "value": "Māra Ω"}}])]))
    assert accepted.mutations[0].changes[0].after.value == "Māra Ω"
    too_large = mutation(changes=[{"path": ["name"], "before": {"exists": False}, "after": {"exists": True, "value": "é" * 33_000}}])
    with pytest.raises(Exception):
        SyncPushRequest.model_validate(push_payload([too_large]))


def test_sheet_create_forwards_original_mutation_for_receipt_hash(monkeypatch):
    template_id = "60000000-0000-0000-0000-000000000001"
    calls = stub_upstream(monkeypatch)
    changes = [
        {"path": ["template_id"], "before": {"exists": False}, "after": {"exists": True, "value": template_id}},
        {"path": ["name"], "before": {"exists": False}, "after": {"exists": True, "value": "  Mara  "}},
        {"path": ["values"], "before": {"exists": False}, "after": {"exists": True, "value": {"strength": 4, "pool": 7, "attack": 5}}},
    ]
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sync/push", headers={"Authorization": JWT}, json=push_payload([mutation(action="create", changes=changes, entity_type="character_sheets")]))
    assert response.status_code == 200, response.text
    sent = calls[0][2]["json"]["p_mutations"][0]
    wire_changes = {change["path"][0]: change["after"].get("value") for change in sent["changes"]}
    assert wire_changes["name"] == "  Mara  "
    assert wire_changes["template_id"] == template_id
    assert wire_changes["values"] == {"strength": 4, "pool": 7, "attack": 5}
    assert len(calls) == 1

