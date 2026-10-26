from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routes.generators import require_signed_in_user
from app.routes.v5 import router as v5_router

SHEET_ID = str(uuid4())
ROLL_ID = str(uuid4())
AUTH = {"Authorization": "Bearer token"}


@pytest.fixture
def client():
    test_app = FastAPI()
    test_app.include_router(v5_router)
    test_app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.pop(require_signed_in_user, None)


def _row(**overrides):
    row = {
        "id": ROLL_ID, "sheet_id": SHEET_ID, "campaign_id": str(uuid4()), "author_id": str(uuid4()),
        "pool": 4, "hunger": 1, "difficulty": 3, "normal_dice": [2, 7, 1], "hunger_dice": [5],
        "outcome": {"successes": 1, "success": False}, "details": {}, "original_normal_dice": None,
        "rerolled_indices": None, "willpower_event_id": None,
        "created_at": "2026-10-26T12:00:00+00:00", "rerolled_at": None,
    }
    row.update(overrides)
    return row


def _sheet(values=None, effects=None):
    base = {"fome": 3, "vigor": 2, "autocontrole": 2, "resolucao": 2}
    return [{"id": SHEET_ID, "values": {**base, **(values or {})}, "effects": effects or []}]


def test_curve_returns_each_pool_against_each_difficulty(client):
    response = client.post("/api/v1/v5/probability-curve", json={
        "pools": [2, 6], "difficulties": [3, 1], "hunger": 3, "willpower_dice": 3,
    })
    assert response.status_code == 200
    body = response.json()
    assert [series["hunger_dice"] for series in body["series"]] == [2, 3]
    assert [point["difficulty"] for point in body["series"][1]["points"]] == [1, 3]
    point = body["series"][1]["points"][0]
    assert point["with_reroll"]["success"] >= point["without_reroll"]["success"]


@pytest.mark.parametrize("payload", [
    {"pools": [1, 1], "difficulties": [1], "hunger": 0},
    {"pools": list(range(7)), "difficulties": [1], "hunger": 0},
    {"pools": [31], "difficulties": [1], "hunger": 0},
    {"pools": [3], "difficulties": [0], "hunger": 0},
    {"pools": [3], "difficulties": [1], "hunger": 6},
])
def test_curve_rejects_invalid_requests(client, payload):
    assert client.post("/api/v1/v5/probability-curve", json=payload).status_code == 422


def test_create_roll_uses_sheet_hunger_and_effects_and_db_dice(client, monkeypatch):
    calls = []

    async def fake_request(method, path, authorization, *, params=None, payload=None):
        assert path == "character_sheets"
        return _sheet(effects=[{"id": "ferido", "label": "Ferido", "delta": -1}])

    async def fake_rpc(name, authorization, payload):
        calls.append((name, payload))
        return _row(pool=payload["p_pool"], hunger=payload["p_hunger"], normal_dice=[2, 7], hunger_dice=[5, 9, 1])

    monkeypatch.setattr("app.routes.v5._request", fake_request)
    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/rolls", json={"pool": 6, "difficulty": 3}, headers=AUTH)
    assert response.status_code == 201
    name, payload = calls[0]
    assert name == "record_v5_roll"
    assert payload["p_pool"] == 5 and payload["p_hunger"] == 3
    assert payload["p_details"]["base_pool"] == 6
    body = response.json()
    assert body["recommended_reroll"] == [0]


def test_create_roll_rejects_zero_dice_without_calling_database(client, monkeypatch):
    async def fake_request(*args, **kwargs):
        return _sheet(effects=[{"id": "x", "label": "X", "delta": -5}])

    async def fake_rpc(*args, **kwargs):
        raise AssertionError("must not roll")

    monkeypatch.setattr("app.routes.v5._request", fake_request)
    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/rolls", json={"pool": 2, "difficulty": 1}, headers=AUTH)
    assert response.status_code == 422


def test_history_lists_newest_rolls_with_recommendation_only_before_reroll(client, monkeypatch):
    seen = {}

    async def fake_request(method, path, authorization, *, params=None, payload=None):
        seen.update(path=path, params=params)
        return [
            _row(),
            _row(id=str(uuid4()), normal_dice=[9, 7, 4], original_normal_dice=[2, 7, 1], rerolled_indices=[0, 2],
                 rerolled_at="2026-10-26T12:01:00+00:00", willpower_event_id=7),
        ]

    monkeypatch.setattr("app.routes.v5._request", fake_request)
    response = client.get(f"/api/v1/v5/sheets/{SHEET_ID}/rolls?limit=10", headers=AUTH)
    assert response.status_code == 200
    assert seen["path"] == "v5_roll_records"
    assert seen["params"]["order"] == "created_at.desc,id.desc" and seen["params"]["limit"] == "10"
    first, second = response.json()
    assert first["recommended_reroll"] == [0, 2]
    assert second["recommended_reroll"] == []
    assert client.get(f"/api/v1/v5/sheets/{SHEET_ID}/rolls?limit=51", headers=AUTH).status_code == 422


def test_willpower_reroll_forwards_choice_and_reports_spend(client, monkeypatch):
    calls = []

    async def fake_rpc(name, authorization, payload):
        calls.append((name, payload))
        return {
            "roll": _row(normal_dice=[8, 7, 10], original_normal_dice=[2, 7, 1], rerolled_indices=[0, 2],
                         rerolled_at="2026-10-26T12:01:00+00:00", willpower_event_id=11),
            "willpower_spent": True,
            "sheet_values": {"vontade_superficial": 1},
        }

    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    response = client.post(f"/api/v1/v5/rolls/{ROLL_ID}/willpower-reroll", json={"normal_indices": [2, 0]}, headers=AUTH)
    assert response.status_code == 200
    assert calls == [("reroll_v5_roll", {"p_roll_id": ROLL_ID, "p_indices": [2, 0]})]
    body = response.json()
    assert body["willpower_spent"] is True
    assert body["roll"]["original_normal_dice"] == [2, 7, 1]
    assert body["sheet_values"] == {"vontade_superficial": 1}


@pytest.mark.parametrize("indices", [[], [0, 1, 2, 3], [1, 1], [-1], [True]])
def test_willpower_reroll_validates_choice(client, indices):
    response = client.post(f"/api/v1/v5/rolls/{ROLL_ID}/willpower-reroll", json={"normal_indices": indices}, headers=AUTH)
    assert response.status_code == 422


def test_second_reroll_maps_conflict(client, monkeypatch):
    async def fake_rpc(name, authorization, payload):
        raise HTTPException(status_code=409, detail="ID da operação já foi usado para outro ajuste")

    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    response = client.post(f"/api/v1/v5/rolls/{ROLL_ID}/willpower-reroll", json={"normal_indices": [0]}, headers=AUTH)
    assert response.status_code == 409
    assert "já foi rerrolada" in response.json()["detail"]


def test_new_routes_require_session():
    test_app = FastAPI()
    test_app.include_router(v5_router)
    with TestClient(test_app) as unauthenticated:
        # Without a session the auth dependency refuses (401, or 503 when auth is unconfigured).
        assert unauthenticated.post("/api/v1/v5/probability-curve", json={"pools": [1], "difficulties": [1], "hunger": 0}).status_code in {401, 503}
        assert unauthenticated.post(f"/api/v1/v5/rolls/{ROLL_ID}/willpower-reroll", json={"normal_indices": [0]}).status_code in {401, 503}


def test_create_roll_records_chronicle_activity_when_requested(client, monkeypatch):
    recorded = []

    async def fake_request(method, path, authorization, *, params=None, payload=None):
        return _sheet()

    async def fake_rpc(name, authorization, payload):
        return _row(pool=payload["p_pool"], hunger=payload["p_hunger"])

    async def fake_activity(authorization, context):
        from app.services.session_roll_activity import RollActivityResult
        recorded.append(context)
        return None if context is None else RollActivityResult(status="recorded")

    monkeypatch.setattr("app.routes.v5._request", fake_request)
    monkeypatch.setattr("app.routes.v5._rpc", fake_rpc)
    monkeypatch.setattr("app.routes.v5.record_from_context", fake_activity)
    chronicle = {"sheet_id": SHEET_ID, "trait_ids": ["forca", "briga"], "roll_key": "v5-action:1"}
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/rolls", json={"pool": 4, "difficulty": 2, "chronicle": chronicle}, headers=AUTH)
    assert response.status_code == 201
    assert response.headers["X-Chronicle-Activity"] == "recorded"
    assert recorded[0].trait_ids == ["forca", "briga"] and recorded[0].roll_key == "v5-action:1"

    plain = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/rolls", json={"pool": 4, "difficulty": 2}, headers=AUTH)
    assert plain.status_code == 201 and "X-Chronicle-Activity" not in plain.headers


def test_create_roll_rejects_chronicle_for_another_sheet(client, monkeypatch):
    async def never(*args, **kwargs):
        raise AssertionError("must not roll")

    monkeypatch.setattr("app.routes.v5._request", never)
    monkeypatch.setattr("app.routes.v5._rpc", never)
    other = {"sheet_id": str(uuid4()), "trait_ids": ["forca"], "roll_key": "k"}
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/rolls", json={"pool": 4, "difficulty": 2, "chronicle": other}, headers=AUTH)
    assert response.status_code == 422
