"""FIC-18 e FIC-11: rotas de histórico, restauração e exclusão de ficha."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import sheets


app = FastAPI()
app.include_router(sheets.router)
client = TestClient(app)
SHEET_ID = "47000000-0000-0000-0000-000000000001"
AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def recorded(monkeypatch) -> list[tuple[str, Any]]:
    calls: list[tuple[str, Any]] = []

    async def current_user(_authorization):
        return "17000000-0000-0000-0000-000000000001"

    async def rpc(name, _authorization, payload):
        calls.append((name, payload))
        return {"id": SHEET_ID, "version": payload["p_expected_version"] + 1}

    async def request(method, path, _authorization, *, params=None, payload=None):
        calls.append((f"{method} {path}", params))
        if method == "DELETE":
            return [{"id": SHEET_ID}] if params["version"] == "eq.4" else []
        return [{"version": 3, "name": "Lia", "values": {"vigor": 2}, "author_name": "Lia", "restored_from": None}]

    monkeypatch.setattr(sheets, "_current_user_id", current_user)
    monkeypatch.setattr(sheets, "_rpc", rpc)
    monkeypatch.setattr(sheets, "_request", request)
    return calls


def test_list_versions_reads_latest_snapshots_first(recorded) -> None:
    response = client.get(f"/api/v1/sheets/{SHEET_ID}/versions", headers=AUTH)
    assert response.status_code == 200
    assert response.json()[0]["version"] == 3
    method, params = recorded[0]
    assert method == "GET character_sheet_versions"
    assert params["sheet_id"] == f"eq.{SHEET_ID}"
    assert params["order"] == "version.desc"
    assert params["limit"] == "50"


@pytest.mark.parametrize("limit", [0, 51])
def test_list_versions_bounds_the_limit(recorded, limit: int) -> None:
    assert client.get(f"/api/v1/sheets/{SHEET_ID}/versions?limit={limit}", headers=AUTH).status_code == 422
    assert recorded == []


def test_restore_calls_rpc_with_expected_version(recorded) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/versions/2/restore", json={"expected_version": 5}, headers=AUTH)
    assert response.status_code == 200
    assert response.json()["version"] == 6
    assert recorded == [("restore_character_sheet_version", {"p_sheet_id": SHEET_ID, "p_version": 2, "p_expected_version": 5})]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("2", {}),
        ("2", {"expected_version": 0}),
        ("2", {"expected_version": 3, "values": {}}),
        ("0", {"expected_version": 3}),
    ],
)
def test_restore_rejects_invalid_payloads(recorded, path: str, body: dict[str, Any]) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/versions/{path}/restore", json=body, headers=AUTH)
    assert response.status_code == 422
    assert recorded == []


def test_delete_uses_expected_version(recorded) -> None:
    assert client.delete(f"/api/v1/sheets/{SHEET_ID}?expected_version=4", headers=AUTH).status_code == 204
    assert recorded == [("DELETE character_sheets", {"id": f"eq.{SHEET_ID}", "version": "eq.4"})]


def test_delete_with_stale_version_is_a_conflict(recorded) -> None:
    response = client.delete(f"/api/v1/sheets/{SHEET_ID}?expected_version=3", headers=AUTH)
    assert response.status_code == 409


@pytest.mark.parametrize(
    ("code", "status"),
    [("40001", 409), ("P0002", 404), ("42501", 403), ("22023", 422), ("XX000", 403)],
)
def test_rpc_errors_map_to_http_statuses(monkeypatch, code: str, status: int) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://supabase.test")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-key")
    transport = httpx.MockTransport(lambda request: httpx.Response(400, json={"code": code, "message": "erro"}))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(sheets.httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    with pytest.raises(sheets.HTTPException) as error:
        asyncio.run(sheets._rpc("restore_character_sheet_version", "Bearer test-token", {}))
    assert error.value.status_code == status
