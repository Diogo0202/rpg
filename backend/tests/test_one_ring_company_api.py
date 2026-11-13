from uuid import UUID

import pytest
from fastapi import HTTPException

from app.routes.one_ring_company import CompanyCommand, _validate_payload


def command(kind, payload, *, version=0):
    return CompanyCommand(operation_id=UUID("b1000000-0000-0000-0000-000000000001"), expected_version=version, kind=kind, payload=payload)


def test_create_payload_is_closed_and_bounded():
    item = command("create", {"name": "Companhia", "patron_id": "bilbo", "safe_havens": ["Rivendell"]})
    assert _validate_payload(item)["name"] == "Companhia"
    with pytest.raises(HTTPException) as error:
        _validate_payload(command("create", {"name": "Companhia", "patron_id": "bilbo", "safe_havens": [], "extra": "private"}))
    assert error.value.status_code == 422


@pytest.mark.parametrize("kind,payload", [
    ("spend", {"amount": 0, "reason": "test"}),
    ("restore", {"amount": True, "reason": "test"}),
    ("reset_session", {"session_id": "not-a-uuid"}),
    ("set_focus", {"source_sheet_id": "not-a-uuid", "target_sheet_id": None}),
])
def test_rejects_malformed_command_payload(kind, payload):
    with pytest.raises(HTTPException) as error:
        _validate_payload(command(kind, payload))
    assert error.value.status_code == 422


def test_valid_focus_accepts_clear_command():
    result = _validate_payload(command("set_focus", {
        "source_sheet_id": "b1000000-0000-0000-0000-000000000002", "target_sheet_id": None,
    }))
    assert result["target_sheet_id"] is None


def test_expected_version_rejects_bool():
    with pytest.raises(ValueError):
        CompanyCommand(operation_id=UUID("b1000000-0000-0000-0000-000000000001"), expected_version=True,
                       kind="create", payload={})


@pytest.mark.parametrize("payload", [
    {"name": "Companhia", "patron_id": [], "safe_havens": []},
    {"name": "Companhia", "patron_id": "Gandalf", "safe_havens": []},
    {"name": "Companhia", "patron_id": None, "safe_havens": ["x" * 121]},
])
def test_invalid_configuration_returns_422(payload):
    with pytest.raises(HTTPException) as error:
        _validate_payload(command("configure", payload))
    assert error.value.status_code == 422


def test_patron_catalog_is_accepted():
    from app.services.one_ring_creation import catalog
    for patron in catalog()["patrons"]:
        assert _validate_payload(command("create", {"name": "Companhia", "patron_id": patron["id"], "safe_havens": []}))["patron_id"] == patron["id"]


def make_client(monkeypatch, *, status=200, result=None):
    import httpx
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routes import one_ring_company

    captured = []
    class StubClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, url, **kwargs):
            captured.append((url, kwargs))
            return httpx.Response(status, json=result)
    monkeypatch.setenv("SUPABASE_URL", "https://unit.example.test")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable-test")
    monkeypatch.setattr(one_ring_company.httpx, "AsyncClient", StubClient)
    app = FastAPI()
    app.include_router(one_ring_company.router)
    return TestClient(app), captured


BASE_URL = "/api/v1/campaigns/72000000-0000-4000-8000-000000000001/one-ring/company"


def test_api_preserves_user_bearer_for_rpc_authorization(monkeypatch):
    client, captured = make_client(monkeypatch, result={"company": None, "members": []})
    response = client.get(BASE_URL, headers={"Authorization": "Bearer test-user-jwt"})
    assert response.status_code == 200
    assert response.json() == {"company": None, "members": []}
    assert captured[0][1]["headers"]["Authorization"] == "Bearer test-user-jwt"
    assert captured[0][1]["json"] == {"p_campaign_id": "72000000-0000-4000-8000-000000000001"}


@pytest.mark.parametrize("code,status", [("42501", 403), ("40001", 409), ("23505", 409), ("23514", 422), ("22023", 422), ("P0002", 404)])
def test_api_maps_database_failures_without_exposing_details(monkeypatch, code, status):
    client, captured = make_client(monkeypatch, status=400, result={"code": code, "message": "private database internals"})
    response = client.post(BASE_URL + "/commands", headers={"Authorization": "Bearer test-user-jwt"}, json={
        "operation_id": "b1000000-0000-0000-0000-000000000001", "expected_version": 4,
        "kind": "spend", "payload": {"amount": 1, "reason": "Viagem"},
    })
    assert response.status_code == status
    assert "private database internals" not in response.text
    assert captured[0][1]["json"]["p_expected_version"] == 4


def test_api_requires_bearer_without_reaching_database(monkeypatch):
    client, captured = make_client(monkeypatch)
    assert client.get(BASE_URL).status_code == 401
    assert captured == []
