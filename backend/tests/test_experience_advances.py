import asyncio
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import experience, sheets


app = FastAPI()
app.include_router(experience.router)
client = TestClient(app)
SHEET_ID = "43500000-0000-0000-0000-000000000001"
ADVANCE_ID = "63500000-0000-0000-0000-000000000001"
CAMPAIGN_ID = "23500000-0000-0000-0000-000000000001"
OPERATION_ID = "53500000-0000-0000-0000-000000000001"
AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def calls(monkeypatch) -> list[tuple[str, dict[str, Any]]]:
    recorded: list[tuple[str, dict[str, Any]]] = []

    async def current_user(_authorization):
        return "13500000-0000-0000-0000-000000000001"

    async def rpc(name, _authorization, payload):
        recorded.append((name, payload))
        return {"advance": {"status": "applied"}, "sheet": {"id": SHEET_ID}}

    async def request(method, path, _authorization, *, params=None, payload=None):
        recorded.append((f"{method} {path}", {"params": params, "payload": payload}))
        return [{"campaign_id": CAMPAIGN_ID, "requires_approval": True}] if method != "GET" or "settings" in path else []

    monkeypatch.setattr(sheets, "_current_user_id", current_user)
    monkeypatch.setattr(experience, "_advance_rpc", rpc)
    monkeypatch.setattr(sheets, "_request", request)
    return recorded


def test_purchase_forwards_request_without_any_cost(calls) -> None:
    body = {"trait": "forca", "target_level": 3, "expected_version": 4, "operation_id": OPERATION_ID}
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/advances", json=body, headers=AUTH)
    assert response.status_code == 200
    assert calls == [("purchase_advance", {
        "p_sheet_id": SHEET_ID, "p_trait": "forca", "p_target_level": 3, "p_expected_version": 4,
        "p_operation_id": OPERATION_ID, "p_item_name": None, "p_reason": None,
    })]


@pytest.mark.parametrize("body", [
    {"trait": "forca", "target_level": 3, "expected_version": 4, "operation_id": OPERATION_ID, "cost": 1},
    {"trait": "forca", "target_level": 3, "expected_version": 4},
    {"trait": "Forca", "target_level": 3, "expected_version": 4, "operation_id": OPERATION_ID},
    {"trait": "forca", "target_level": 0, "expected_version": 4, "operation_id": OPERATION_ID},
    {"trait": "forca", "target_level": 3, "expected_version": 0, "operation_id": OPERATION_ID},
])
def test_purchase_rejects_client_cost_and_bad_payloads(calls, body) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/advances", json=body, headers=AUTH)
    assert response.status_code == 422
    assert calls == []


def test_quote_forwards_item_name(calls) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/advances/quote",
                           json={"trait": "vantagens", "target_level": 2, "item_name": "Recursos"}, headers=AUTH)
    assert response.status_code == 200
    assert calls == [("quote_advance", {"p_sheet_id": SHEET_ID, "p_trait": "vantagens", "p_target_level": 2, "p_item_name": "Recursos"})]


def test_review_and_refund(calls) -> None:
    assert client.post(f"/api/v1/advances/{ADVANCE_ID}/review", json={"approve": True}, headers=AUTH).status_code == 200
    assert client.post(f"/api/v1/advances/{ADVANCE_ID}/refund", json={}, headers=AUTH).status_code == 200
    assert calls == [
        ("review_advance", {"p_advance_id": ADVANCE_ID, "p_approve": True, "p_note": None}),
        ("refund_advance", {"p_advance_id": ADVANCE_ID, "p_note": None}),
    ]
    assert client.post(f"/api/v1/advances/{ADVANCE_ID}/review", json={"approve": "yes"}, headers=AUTH).status_code == 422


def test_history_reads_remote_table(calls) -> None:
    response = client.get(f"/api/v1/sheets/{SHEET_ID}/advances?limit=10", headers=AUTH)
    assert response.status_code == 200
    name, args = calls[0]
    assert name == "GET character_advances"
    assert args["params"]["sheet_id"] == f"eq.{SHEET_ID}" and args["params"]["limit"] == "10"


def test_settings_update_then_return(calls) -> None:
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/experience-settings", json={"requires_approval": True}, headers=AUTH)
    assert response.status_code == 200
    assert response.json()["requires_approval"] is True
    assert calls[0][0] == "PATCH campaign_experience_settings"
    assert calls[0][1]["payload"]["updated_by"] == "13500000-0000-0000-0000-000000000001"


@pytest.mark.parametrize(("code", "status", "text"), [
    ("XP001", 422, "XP insuficiente"), ("40001", 409, "recarregue"), ("23505", 409, "ID da operação"),
    ("42501", 403, "não permitida"), ("22023", 422, "não é válido"), ("XX000", 403, "não permitida"),
])
def test_rpc_maps_advance_errors_without_leaking(monkeypatch, code, status, text) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/rpc/purchase_advance"
        return httpx.Response(400, json={"code": code, "message": "internal detail"})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(experience.httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    with pytest.raises(experience.HTTPException) as error:
        asyncio.run(experience._advance_rpc("purchase_advance", "Bearer test-token", {}))
    assert error.value.status_code == status
    assert text in error.value.detail
    assert "internal detail" not in error.value.detail
