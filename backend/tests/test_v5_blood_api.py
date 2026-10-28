from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routes.generators import require_signed_in_user
from app.routes.v5 import router as v5_router

SHEET_ID = str(uuid4())
OPERATION_ID = str(uuid4())
AUTH = {"Authorization": "Bearer token"}
VALUES = {"potencia_sangue": 1, "fome": 2, "humanidade": 7, "manchas": 0, "autocontrole": 2, "resolucao": 2, "cla": "Brujah"}


@pytest.fixture
def client():
    test_app = FastAPI()
    test_app.include_router(v5_router)
    test_app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(test_app) as test_client:
        yield test_client


def _result(outcome, values=None, dice=None, replayed=False):
    return {"sheet": {"id": SHEET_ID, "version": 4, "values": {**VALUES, **(values or {})}}, "event": {"id": 9},
            "replayed": replayed, "outcome": outcome, "dice": dice or [3]}


def test_rouse_forwards_operation_and_level_and_derives_state(client, monkeypatch):
    calls = []

    async def fake_rpc(name, authorization, payload):
        calls.append((name, payload))
        return _result({"success": False, "hunger_after": 3}, {"fome": 3}, [3, 2])

    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/rouse",
                           json={"operation_id": OPERATION_ID, "discipline_level": 1, "reason": "Rapidez"}, headers=AUTH)
    assert response.status_code == 200
    assert calls == [("v5_rouse_check", {"p_sheet_id": SHEET_ID, "p_operation_id": OPERATION_ID, "p_discipline_level": 1, "p_reason": "Rapidez"})]
    body = response.json()
    assert body["dice"] == [3, 2] and body["event_id"] == 9 and body["state"]["hunger"] == 3
    assert body["state"]["potency"]["rouse_reroll_level"] == 1


@pytest.mark.parametrize(("path", "payload", "rpc", "expected"), [
    ("awaken", {}, "v5_awaken", {}),
    ("remorse", {}, "v5_remorse_check", {}),
    ("frenzy", {"difficulty": 3, "kind": "terror"}, "v5_frenzy_check", {"p_difficulty": 3, "p_kind": "terror"}),
    ("compulsion", {"compulsion": "Paranoia"}, "v5_set_compulsion", {"p_compulsion": "Paranoia"}),
    ("compulsion", {}, "v5_set_compulsion", {"p_compulsion": None}),
    ("torpor", {"in_torpor": True}, "v5_set_torpor", {"p_in_torpor": True}),
])
def test_blood_actions_call_their_rpc(client, monkeypatch, path, payload, rpc, expected):
    calls = []

    async def fake_rpc(name, authorization, body):
        calls.append((name, body))
        return _result({"success": True})

    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/{path}", json={"operation_id": OPERATION_ID, **payload}, headers=AUTH)
    assert response.status_code == 200
    assert calls == [(rpc, {"p_sheet_id": SHEET_ID, "p_operation_id": OPERATION_ID, **expected})]


@pytest.mark.parametrize(("path", "payload"), [
    ("rouse", {}),
    ("rouse", {"operation_id": OPERATION_ID, "discipline_level": 0}),
    ("rouse", {"operation_id": OPERATION_ID, "dice": [6]}),
    ("frenzy", {"operation_id": OPERATION_ID, "difficulty": 11}),
    ("frenzy", {"operation_id": OPERATION_ID, "difficulty": 2, "kind": "rage"}),
    ("compulsion", {"operation_id": OPERATION_ID, "compulsion": "Xyz"}),
    ("torpor", {"operation_id": OPERATION_ID}),
])
def test_blood_actions_validate_and_never_accept_client_dice(client, monkeypatch, path, payload):
    async def never(*args, **kwargs):
        raise AssertionError("must not call the database")

    monkeypatch.setattr("app.routes.v5._rpc", never)
    assert client.post(f"/api/v1/v5/sheets/{SHEET_ID}/{path}", json=payload, headers=AUTH).status_code == 422


@pytest.mark.parametrize(("status", "fragment"), [(403, "dono da ficha"), (409, "já foi usado"), (422, "inválida")])
def test_blood_errors_are_mapped(client, monkeypatch, status, fragment):
    async def fake_rpc(*args, **kwargs):
        raise HTTPException(status_code=status, detail="x")

    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/remorse", json={"operation_id": OPERATION_ID}, headers=AUTH)
    assert response.status_code == status and fragment in response.json()["detail"]


def test_sheet_blood_state_and_events(client, monkeypatch):
    seen = []

    async def fake_request(method, path, authorization, *, params=None, payload=None):
        seen.append((path, params))
        if path == "character_sheets":
            return [{"id": SHEET_ID, "values": {**VALUES, "manchas": 2}}]
        return [{"id": 3, "kind": "rouse", "dice": [7], "outcome": {"success": True}}]

    monkeypatch.setattr("app.routes.v5._request", fake_request)
    state = client.get(f"/api/v1/v5/sheets/{SHEET_ID}/blood", headers=AUTH).json()
    assert state["remorse_pool"] == 1 and state["frenzy_pool"]["fury"] == 4
    events = client.get(f"/api/v1/v5/sheets/{SHEET_ID}/blood-events?limit=5", headers=AUTH)
    assert events.status_code == 200 and events.json()[0]["kind"] == "rouse"
    assert seen[1][0] == "v5_blood_events" and seen[1][1]["limit"] == "5"


def test_potency_table_route(client):
    body = client.get("/api/v1/v5/blood-potency").json()
    assert len(body["rows"]) == 11 and body["clan_compulsions"]["Ventrue"]["name"] == "Arrogância" and body["review"]


def test_blood_routes_require_session():
    test_app = FastAPI()
    test_app.include_router(v5_router)
    with TestClient(test_app) as unauthenticated:
        assert unauthenticated.post(f"/api/v1/v5/sheets/{SHEET_ID}/rouse", json={"operation_id": OPERATION_ID}).status_code in {401, 503}
