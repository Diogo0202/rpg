from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import second_inquisition as route


api_app = FastAPI()
api_app.include_router(route.router)
client = TestClient(api_app)
CAMPAIGN_ID = "00000000-0000-0000-0000-000000000001"
USER_ID = "00000000-0000-0000-0000-000000000002"
OWNER_ID = "00000000-0000-0000-0000-000000000003"
EVENT_IDS = [
    "10000000-0000-0000-0000-000000000001",
    "10000000-0000-0000-0000-000000000002",
    "10000000-0000-0000-0000-000000000003",
]
NOW = "2026-10-15T12:00:00+00:00"


def install_auth(monkeypatch: pytest.MonkeyPatch, role: str = "master") -> None:
    async def current_user(authorization: str | None) -> str:
        if authorization != "Bearer valid-token":
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="sessão inválida")
        return USER_ID

    monkeypatch.setattr(route, "_current_user_id", current_user)
    monkeypatch.setattr(route, "_supabase_config", lambda: ("https://example.supabase.co", "public-test-key"))
    original = route._supabase_request

    async def request(method: str, path: str, authorization: str, *, params=None, payload=None):
        if path == "campaigns":
            return [{"id": CAMPAIGN_ID, "owner_id": OWNER_ID}]
        if path == "campaign_members":
            return [{"role": role}] if role else []
        return await original(method, path, authorization, params=params, payload=payload)

    monkeypatch.setattr(route, "_supabase_request", request)


def event_row(event_id: str, kind: str) -> dict[str, object]:
    return {
        "id": event_id,
        "campaign_id": CAMPAIGN_ID,
        "event_kind": kind,
        "area_id": "centro",
        "occurred_at": NOW,
        "verified_at": NOW,
        "created_by": USER_ID,
        "version": 1,
    }


def test_routes_require_a_bearer_session(monkeypatch: pytest.MonkeyPatch) -> None:
    install_auth(monkeypatch)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition")
    assert response.status_code == 401


def test_player_cannot_read_confirmed_events(monkeypatch: pytest.MonkeyPatch) -> None:
    install_auth(monkeypatch, role="player")
    response = client.get(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert response.status_code == 403


@pytest.mark.parametrize("action", ["create", "delete"])
def test_player_cannot_change_confirmed_events(monkeypatch: pytest.MonkeyPatch, action: str) -> None:
    install_auth(monkeypatch, role="player")
    headers = {"Authorization": "Bearer valid-token"}
    base = f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition"
    if action == "create":
        response = client.post(
            base,
            headers=headers,
            json={"event_kind": "digital_trace", "occurred_at": NOW, "area_id": "centro"},
        )
    else:
        response = client.delete(f"{base}/{EVENT_IDS[0]}?expected_version=1", headers=headers)
    assert response.status_code == 403


def test_get_reconstructs_all_event_pages_and_original_assessment(monkeypatch: pytest.MonkeyPatch) -> None:
    install_auth(monkeypatch)
    monkeypatch.setattr(route, "PAGE_SIZE", 2)
    rows = [
        event_row(EVENT_IDS[0], "public_discipline"),
        event_row(EVENT_IDS[1], "masquerade_breach"),
        event_row(EVENT_IDS[2], "digital_trace"),
    ]
    offsets: list[str] = []

    async def request(method: str, path: str, authorization: str, *, params=None, payload=None):
        if path == "campaigns":
            return [{"id": CAMPAIGN_ID, "owner_id": OWNER_ID}]
        if path == "campaign_members":
            return [{"role": "master"}]
        if path == "second_inquisition_events":
            offsets.append(params["offset"])
            offset = int(params["offset"])
            return rows[offset : offset + int(params["limit"])]
        raise AssertionError(path)

    monkeypatch.setattr(route, "_supabase_request", request)
    response = client.get(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert response.status_code == 200
    body = response.json()
    assessment = body["assessment"]
    assert [row["id"] for row in body["events"]] == EVENT_IDS
    assert offsets == ["0", "2"]
    assert assessment["verified_event_count"] == 3
    assert assessment["score"] == 38
    assert assessment["level"] == 1
    assert assessment["score_by_event_kind"] == {
        "digital_trace": 8,
        "masquerade_breach": 20,
        "public_discipline": 10,
    }
    assert assessment["responses"][0]["kind"] == "wiretap"


def test_get_returns_explicit_error_instead_of_truncating_over_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    install_auth(monkeypatch)
    monkeypatch.setattr(route, "MAX_EVENTS", 2)
    monkeypatch.setattr(route, "PAGE_SIZE", 2)
    rows = [event_row(EVENT_IDS[0], "public_discipline"), event_row(EVENT_IDS[1], "digital_trace"), event_row(EVENT_IDS[2], "masquerade_breach")]

    async def request(method: str, path: str, authorization: str, *, params=None, payload=None):
        if path == "campaigns":
            return [{"id": CAMPAIGN_ID, "owner_id": OWNER_ID}]
        if path == "campaign_members":
            return [{"role": "master"}]
        if path == "second_inquisition_events":
            offset = int(params["offset"])
            return rows[offset : offset + int(params["limit"])]
        raise AssertionError(path)

    monkeypatch.setattr(route, "_supabase_request", request)
    response = client.get(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert response.status_code == 413
    assert "sem truncar" in response.json()["detail"]


def test_master_confirms_server_stamped_event_and_cannot_choose_author(monkeypatch: pytest.MonkeyPatch) -> None:
    install_auth(monkeypatch)
    inserted: list[dict[str, object]] = []

    async def request(method: str, path: str, authorization: str, *, params=None, payload=None):
        if path == "campaigns":
            return [{"id": CAMPAIGN_ID, "owner_id": OWNER_ID}]
        if path == "campaign_members":
            return [{"role": "master"}]
        if path == "second_inquisition_events" and method == "POST":
            inserted.append(payload)
            return [{**payload, "id": EVENT_IDS[0], "verified_at": NOW, "created_by": USER_ID, "version": 1}]
        if path == "second_inquisition_events" and method == "GET":
            return []
        raise AssertionError((method, path))

    monkeypatch.setattr(route, "_supabase_request", request)
    headers = {"Authorization": "Bearer valid-token"}
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition",
        headers=headers,
        json={"event_kind": "masquerade_breach", "occurred_at": NOW, "area_id": " centro "},
    )
    assert response.status_code == 201, response.text
    assert inserted == [{"campaign_id": CAMPAIGN_ID, "event_kind": "masquerade_breach", "area_id": "centro", "occurred_at": NOW}]
    spoofed = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition",
        headers=headers,
        json={"event_kind": "masquerade_breach", "occurred_at": NOW, "area_id": "centro", "created_by": OWNER_ID},
    )
    assert spoofed.status_code == 422


def test_event_revocation_uses_version_compare_and_swap(monkeypatch: pytest.MonkeyPatch) -> None:
    install_auth(monkeypatch)
    deleted: list[dict[str, str]] = []

    async def request(method: str, path: str, authorization: str, *, params=None, payload=None):
        if path == "campaigns":
            return [{"id": CAMPAIGN_ID, "owner_id": OWNER_ID}]
        if path == "campaign_members":
            return [{"role": "owner"}]
        if path == "second_inquisition_events" and method == "DELETE":
            deleted.append(params)
            return [{"id": EVENT_IDS[0]}]
        raise AssertionError((method, path))

    monkeypatch.setattr(route, "_supabase_request", request)
    response = client.delete(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition/{EVENT_IDS[0]}?expected_version=1",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert response.status_code == 204
    assert deleted == [{"id": f"eq.{EVENT_IDS[0]}", "campaign_id": f"eq.{CAMPAIGN_ID}", "version": "eq.1", "select": "id"}]


def test_create_refuses_to_make_the_assessment_unreadable_at_its_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    install_auth(monkeypatch)
    monkeypatch.setattr(route, "MAX_EVENTS", 1)

    async def existing_events(campaign_id, authorization):
        return [event_row(EVENT_IDS[0], "digital_trace")]

    monkeypatch.setattr(route, "_read_all_events", existing_events)
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition",
        headers={"Authorization": "Bearer valid-token"},
        json={"event_kind": "digital_trace", "occurred_at": NOW, "area_id": "centro"},
    )
    assert response.status_code == 413
