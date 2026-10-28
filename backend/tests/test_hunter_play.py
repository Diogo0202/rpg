"""F4: Caçador at the table (cell Desperation, Overreach/Despair, Willpower reroll, Redemption, Edges)."""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import hunter as hunter_routes
from app.routes import sheets as sheets_routes
from app.routes.generators import require_signed_in_user
from app.services import hunter_traits
from app.services.hunter_traits import (
    HUNTER_EDGES,
    HUNTER_PERKS,
    desperation_choices,
    hunter_creation_problems,
    hunter_edge_problems,
    roll_outcome,
    usable_edges,
)

SHEET = "4a000000-0000-0000-0000-000000000001"
ROLL = "6a000000-0000-0000-0000-000000000001"


def test_outcome_counts_pairs_across_desperation_dice_and_flags_ones() -> None:
    assert roll_outcome([10, 6], [10, 1], 4) == {
        "successes": 5, "success": True, "critical_pairs": 1, "critical": True,
        "desperation_ones": 1, "desperation_consequence": "table_choice",
    }
    assert roll_outcome([2, 3], [1], 1)["desperation_consequence"] == "despair"
    assert roll_outcome([7], [], 1)["desperation_consequence"] is None


def test_outcome_matches_enumeration_of_two_dice() -> None:
    # Every pair of faces: one ordinary die and one Desperation die against difficulty 1.
    for normal, desperate in itertools.product(range(1, 11), repeat=2):
        outcome = roll_outcome([normal], [desperate], 1)
        expected = (normal >= 6) + (desperate >= 6) + (2 if normal == desperate == 10 else 0)
        assert outcome["successes"] == expected
        assert outcome["desperation_ones"] == (desperate == 1)


def test_table_choices_follow_success() -> None:
    assert desperation_choices({"success": True, "desperation_ones": 1}) == ["overreach", "despair"]
    assert desperation_choices({"success": False, "desperation_ones": 2}) == ["despair"]
    assert desperation_choices({"success": True, "desperation_ones": 0}) == []


def test_edge_catalog_and_perks_belong_to_edges() -> None:
    assert len(HUNTER_EDGES) == 14
    assert all(perk.split(": ")[0] in HUNTER_EDGES for perk in HUNTER_PERKS)
    assert hunter_edge_problems({"triunfos": ["Arsenal"], "distincoes": ["Arsenal: Excepcional"]}) == []
    assert hunter_edge_problems({"triunfos": ["Arsenal"], "distincoes": ["Frota: Blindagem"]}) == ["Distinção Frota: Blindagem pede o Triunfo Frota"]
    assert "Triunfo Telecinese fora do catálogo" in hunter_edge_problems({"triunfos": ["Telecinese"]})
    assert hunter_edge_problems({"triunfos": ["Arsenal", "Arsenal"]}) == ["Triunfos e Distinções não se repetem"]


def test_creation_counts_and_despair_blocks_edges() -> None:
    base = {"credo": "Marcial", "impulso": "Juramento", "conviccao_1": "a", "pedra_toque_1": "b"}
    assert hunter_creation_problems({**base, "triunfos": ["Arsenal", "Frota"], "distincoes": ["Frota: Blindagem"]}) == []
    assert hunter_creation_problems({**base, "triunfos": [], "distincoes": []})[-1].startswith("Na criação")
    assert usable_edges({"triunfos": ["Arsenal"]}) == ["Arsenal"]
    assert usable_edges({"triunfos": ["Arsenal"], "em_desespero": True}) == []


def test_python_and_typescript_catalogs_match() -> None:
    source = (Path(__file__).parents[2] / "frontend/lib/hunter-traits.ts").read_text(encoding="utf-8")
    for edge, perks in HUNTER_EDGES.items():
        assert edge in source
        for perk in perks:
            assert f'"{perk}"' in source
    assert "[[2, 1], [1, 2]]" in source and hunter_traits.HUNTER_EDGE_STARTS == [(2, 1), (1, 2)]


# --- Routes -----------------------------------------------------------------------------------

@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    seen: list[tuple[str, dict[str, Any]]] = []

    async def fake_rpc(function: str, authorization: str | None, payload: dict[str, Any]) -> Any:
        seen.append((function, payload))
        roll = {"id": ROLL, "normal_dice": [7, 8, 2], "desperation_dice": [1, 9], "difficulty": 2,
                "outcome": {"successes": 3, "success": True, "critical_pairs": 0, "critical": False,
                            "desperation_ones": 1, "desperation_consequence": "table_choice"},
                "rerolled_at": None, "resolution": None}
        if function == "resolve_hunter_desperation":
            roll = {**roll, "resolution": payload["p_choice"], "outcome": {**roll["outcome"], "final_success": payload["p_choice"] == "overreach"}}
        if function == "reroll_hunter_roll":
            roll = {**roll, "rerolled_at": "2026-10-29T00:00:00Z"}
        return {"roll": roll, "cell": {"id": "c", "name": "Vigília", "danger": 2, "desperation": 2}, "in_despair": False}

    async def no_activity(authorization: str | None, context: Any) -> None:
        return None

    monkeypatch.setattr(hunter_routes, "_rpc", fake_rpc)
    monkeypatch.setattr(hunter_routes, "record_from_context", no_activity)
    return seen


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(hunter_routes.router)
    app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(app) as test_client:
        yield test_client


def test_roll_route_sends_the_sheet_and_shows_the_table_choice(client, calls) -> None:
    response = client.post(f"/api/v1/hunter/sheets/{SHEET}/rolls", json={"base_pool": 3, "difficulty": 2, "use_desperation": True, "edge": "Arsenal"},
                           headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    body = response.json()
    assert calls[0] == ("record_hunter_roll", {"p_sheet_id": SHEET, "p_base_pool": 3, "p_difficulty": 2,
                                               "p_use_desperation": True, "p_details": {"edge": "Arsenal"}})
    assert body["desperation_dice"] == [1, 9]
    assert body["choices"] == ["overreach", "despair"]
    assert body["can_reroll"] is True
    assert body["cell"]["desperation"] == 2


def test_roll_route_does_not_accept_a_client_desperation(client, calls) -> None:
    response = client.post(f"/api/v1/hunter/sheets/{SHEET}/rolls", json={"base_pool": 3, "difficulty": 2, "desperation": 5})
    assert response.status_code == 422
    assert calls == []


def test_resolve_despair_turns_the_verdict_into_failure(client, calls) -> None:
    response = client.post(f"/api/v1/hunter/rolls/{ROLL}/resolve", json={"choice": "despair"})
    assert response.status_code == 200
    assert response.json()["verdict"] == "Falha"
    assert response.json()["choices"] == []
    overreach = client.post(f"/api/v1/hunter/rolls/{ROLL}/resolve", json={"choice": "overreach"})
    assert overreach.json()["verdict"] == "Êxito"
    assert client.post(f"/api/v1/hunter/rolls/{ROLL}/resolve", json={"choice": "fugir"}).status_code == 422


def test_reroll_limits_and_other_actions(client, calls) -> None:
    assert client.post(f"/api/v1/hunter/rolls/{ROLL}/reroll", json={"indices": [0, 1, 2, 0]}).status_code == 422
    rerolled = client.post(f"/api/v1/hunter/rolls/{ROLL}/reroll", json={"indices": [0, 2]})
    assert rerolled.json()["can_reroll"] is False
    assert client.post("/api/v1/hunter/cells/c0000000-0000-0000-0000-000000000001/adjust",
                       json={"operation_id": "7a000000-0000-0000-0000-000000000001"}).status_code == 422
    assert client.post("/api/v1/hunter/cells/c0000000-0000-0000-0000-000000000001/adjust",
                       json={"operation_id": "7a000000-0000-0000-0000-000000000001", "danger_delta": 1}).status_code == 200
    assert client.post(f"/api/v1/hunter/sheets/{SHEET}/redemption", json={"note": "cumpri"}).status_code == 200
    assert client.post(f"/api/v1/hunter/redemptions/{ROLL}/decision", json={"approve": True}).status_code == 200
    assert [name for name, _ in calls] == ["reroll_hunter_roll", "adjust_hunter_cell", "request_hunter_redemption", "decide_hunter_redemption"]


@pytest.mark.parametrize("code,status", [("55000", 409), ("23505", 409), ("42501", 403), ("23514", 422)])
def test_database_errors_become_clear_statuses(monkeypatch: pytest.MonkeyPatch, code: str, status: int) -> None:
    class FakeResponse:
        status_code = 400
        content = b"{}"

        def json(self) -> dict[str, str]:
            return {"code": code, "message": "in Despair"}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None: ...
        async def __aenter__(self) -> "FakeClient": return self
        async def __aexit__(self, *args: Any) -> None: return None
        async def post(self, *args: Any, **kwargs: Any) -> FakeResponse: return FakeResponse()

    monkeypatch.setenv("SUPABASE_URL", "http://supabase.test")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-key")
    monkeypatch.setattr(hunter_routes.httpx, "AsyncClient", FakeClient)
    app = FastAPI()
    app.include_router(hunter_routes.router)
    app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(app) as test_client:
        response = test_client.post(f"/api/v1/hunter/sheets/{SHEET}/rolls", json={"base_pool": 2, "difficulty": 1},
                                    headers={"Authorization": "Bearer t"})
    assert response.status_code == status


# --- Sheet creation runs the Hunter checks ------------------------------------------------------

def test_sheet_creation_refuses_a_hunter_without_starting_edges(monkeypatch: pytest.MonkeyPatch) -> None:
    schema = json.loads((Path(__file__).parent / "fixtures/hunter_starter.json").read_text(encoding="utf-8"))
    from tests.test_hunter_creation import values_for_mode

    user = "1a000000-0000-0000-0000-000000000002"
    campaign = "2a000000-0000-0000-0000-000000000001"
    posted: list[dict[str, Any]] = []

    async def current_user(authorization: str | None) -> str:
        return user

    async def template(campaign_id: Any, template_id: Any, authorization: str) -> dict[str, Any]:
        return {"name": schema["name"], "version": 4, "schema": schema}

    async def request(method: str, path: str, authorization: str | None, **kwargs: Any) -> Any:
        posted.append(kwargs.get("payload") or {})
        return [{"id": "sheet"}]

    monkeypatch.setattr(sheets_routes, "_current_user_id", current_user)
    monkeypatch.setattr(sheets_routes, "_get_template", template)
    monkeypatch.setattr(sheets_routes, "_request", request)
    app = FastAPI()
    app.include_router(sheets_routes.router)
    portrait = f"{campaign}/{user}/3a000000-0000-0000-0000-000000000009.webp"
    body = {"template_id": "3a000000-0000-0000-0000-000000000001", "name": "Mara", "portrait_path": portrait}
    with TestClient(app) as test_client:
        refused = test_client.post(f"/api/v1/campaigns/{campaign}/sheets",
                                   json={**body, "values": {**values_for_mode(0), "triunfos": ["Arsenal"], "distincoes": []}})
        accepted = test_client.post(f"/api/v1/campaigns/{campaign}/sheets", json={**body, "values": values_for_mode(0)})
    assert refused.status_code == 422
    assert "Na criação" in refused.json()["detail"]
    assert accepted.status_code == 201
    assert len(posted) == 1
