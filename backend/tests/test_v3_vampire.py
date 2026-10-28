"""Vampiro V3 (Revisado): the dice rules by enumeration and by sampling, health and blood tables,
the old-sheet migration and the roller routes (Willpower spent through the atomic RPC)."""

from __future__ import annotations

import itertools
from fractions import Fraction
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routes import generators
from app.routes import system_rolls as routes
from app.services import supabase_rpc, v3_vampire
from app.services.system_rolls import V3RollRequest, roll_v3, v3_outcome

SHEET_ID = "00000000-0000-0000-0000-000000000031"
OPERATION_ID = "00000000-0000-0000-0000-000000000041"


def enumerate_pool(pool: int, difficulty: int, **flags: bool) -> dict[str, Fraction]:
    """Exact chances over every one of the 10**pool outcomes."""
    totals = {"botch": Fraction(0), "success": Fraction(0), "successes": Fraction(0)}
    weight = Fraction(1, 10 ** pool)
    for dice in itertools.product(range(1, 11), repeat=pool):
        outcome = v3_outcome(list(dice), difficulty, **flags)
        totals["botch"] += weight * outcome.botch
        totals["success"] += weight * outcome.success
        totals["successes"] += weight * outcome.successes
    return totals


def test_ones_cancel_successes_and_a_botch_needs_no_success_at_all() -> None:
    assert v3_outcome([1, 6, 7], 6).successes == 1
    assert (v3_outcome([1, 1, 6], 6).successes, v3_outcome([1, 1, 6], 6).botch) == (0, False)
    failure = v3_outcome([1, 6], 6)
    assert (failure.successes, failure.botch, failure.verdict) == (0, False, "Falha")
    botch = v3_outcome([1, 2, 5], 6)
    assert (botch.botch, botch.verdict) == (True, "Falha crítica")
    assert v3_outcome([10, 9], 10).successes == 1


def test_specialty_tens_count_twice_and_willpower_cannot_be_cancelled() -> None:
    assert v3_outcome([10, 3], 6, specialty=True).successes == 2
    assert v3_outcome([10, 1], 6, specialty=True).successes == 1
    spent = v3_outcome([1, 1, 2], 6, willpower=True)
    assert (spent.successes, spent.botch, spent.success) == (1, False, True)
    assert v3_outcome([6, 1, 1], 6, willpower=True).successes == 1


@pytest.mark.parametrize("pool, difficulty", [(1, 6), (2, 6), (3, 8), (2, 2), (3, 10)])
def test_enumerated_botch_chance_matches_the_closed_form(pool: int, difficulty: int) -> None:
    # Botch: every die below the difficulty and at least one 1.
    below = Fraction(difficulty - 1, 10)
    expected = below ** pool - (below - Fraction(1, 10)) ** pool
    assert enumerate_pool(pool, difficulty)["botch"] == expected
    # Willpower removes every botch and guarantees a success.
    with_willpower = enumerate_pool(pool, difficulty, willpower=True)
    assert (with_willpower["botch"], with_willpower["success"]) == (0, 1)


def test_enumerated_specialty_adds_the_chance_of_tens() -> None:
    plain = enumerate_pool(2, 6)["successes"]
    special = enumerate_pool(2, 6, specialty=True)["successes"]
    assert special - plain == Fraction(2, 10)  # each die adds one more success on a 10


def test_sampled_rolls_follow_the_enumeration(monkeypatch: pytest.MonkeyPatch) -> None:
    exact = enumerate_pool(3, 7)
    samples = 20_000
    botches = successes = 0
    for _ in range(samples):
        result = roll_v3(V3RollRequest(pool=3, difficulty=7))
        botches += result.botch
        successes += result.success
    # Five standard deviations keep the test stable.
    for observed, chance in ((botches, exact["botch"]), (successes, exact["success"])):
        p = float(chance)
        assert abs(observed / samples - p) <= 5 * (p * (1 - p) / samples) ** 0.5
    rolled = [roll_v3(V3RollRequest(pool=1, difficulty=6)).dice[0] for _ in range(5_000)]
    assert set(rolled) == set(range(1, 11))


def test_health_levels_take_dice_and_incapacitated_cannot_roll() -> None:
    assert [v3_vampire.health_penalty(level) for level in range(8)] == [0, 0, -1, -1, -2, -2, -5, None]
    result = roll_v3(V3RollRequest(pool=5, difficulty=6, damage_levels=4))
    assert (result.penalty, result.rolled, len(result.dice)) == (-2, 3, 3)
    assert roll_v3(V3RollRequest(pool=4, difficulty=6, damage_levels=6)).rolled == 0
    with pytest.raises(ValueError):
        roll_v3(V3RollRequest(pool=5, difficulty=6, damage_levels=7))


def test_blood_follows_generation() -> None:
    assert [v3_vampire.blood_for_generation(generation) for generation in (13, 12, 11, 10, 9, 8, 7)] == [
        (10, 1), (11, 1), (12, 1), (13, 1), (14, 2), (15, 3), (20, 4)]
    # Same numbers as the starter's formulas over the Generation background.
    for background in range(6):
        assert (10 + background, 1 + (background // 4) * (background - 3)) == v3_vampire.blood_for_generation(13 - background)


def test_old_sheets_lose_the_predator_type_into_notes() -> None:
    values, warnings = v3_vampire.migrate_v3_values({"predador": "Sanguessuga", "notas": "Mara", "consciencia": 3})
    assert "predador" not in values and values["notas"].endswith("Tipo de predador (ficha antiga, regra da casa): Sanguessuga")
    assert (values["trilha"], values["conviccao"], values["instintos"]) == ("Humanidade", 1, 1)
    assert warnings
    derived = v3_vampire.v3_derived({"ant_geracao": 5, "dano_letal": 3, "trilha": "Trilha de Caim"})
    assert (derived["sangue_max"], derived["sangue_por_turno"], derived["nivel_vitalidade"], derived["penalidade"]) == (15, 3, "Ferido", -1)
    assert (derived["virtude_consciencia"], derived["virtude_autocontrole"]) == ("conviccao", "instintos")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    calls: list[tuple[str, dict[str, Any]]] = []

    async def call_rpc(function: str, authorization: str, payload: dict[str, Any], **_: Any) -> Any:
        calls.append((function, payload))
        if payload.get("p_sheet_id") == "00000000-0000-0000-0000-000000000099":
            raise HTTPException(status_code=422, detail="limite da ficha atingido")
        return {"sheet": {"values": {}}, "replayed": False}

    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[generators.require_signed_in_user] = lambda: None
    monkeypatch.setattr(supabase_rpc, "call_rpc", call_rpc)
    return TestClient(app), calls


def test_route_spends_willpower_before_rolling(client) -> None:
    http, calls = client
    response = http.post("/api/v1/system-rolls/vampire-v3", headers={"Authorization": "Bearer t"}, json={
        "pool": 3, "difficulty": 6, "use_willpower": True, "sheet_id": SHEET_ID, "operation_id": OPERATION_ID})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["willpower_spent"] is True and body["successes"] >= 1 and body["botch"] is False
    assert calls == [("v3_spend_willpower", {"p_sheet_id": SHEET_ID, "p_operation_id": OPERATION_ID})]


def test_route_refuses_the_roll_when_willpower_is_gone(client) -> None:
    http, _ = client
    response = http.post("/api/v1/system-rolls/vampire-v3", headers={"Authorization": "Bearer t"}, json={
        "pool": 3, "difficulty": 6, "use_willpower": True, "sheet_id": "00000000-0000-0000-0000-000000000099", "operation_id": OPERATION_ID})
    assert response.status_code == 422
    assert http.post("/api/v1/system-rolls/vampire-v3", json={"pool": 3, "difficulty": 11}).status_code == 422
    assert http.post("/api/v1/system-rolls/vampire-v3", json={"pool": 3, "difficulty": 6, "damage_levels": 7}).status_code == 422


@pytest.mark.parametrize("body, function, sent", [
    ({"action": "sangue", "amount": 2, "turn": "c1:r1"}, "v3_spend_blood", {"p_amount": 2, "p_turn": "c1:r1"}),
    ({"action": "cura", "amount": 1}, "v3_heal", {"p_levels": 1, "p_turn": None}),
    ({"action": "dano", "amount": 3, "kind": "contundente"}, "v3_apply_damage", {"p_kind": "contundente", "p_amount": 3}),
    ({"action": "sangue_inicial"}, "v3_set_initial_blood", {"p_value": None}),
    ({"action": "frenesi", "difficulty": 8}, "v3_frenzy_test", {"p_kind": "frenesi", "p_difficulty": 8}),
    ({"action": "rotschreck", "difficulty": 7}, "v3_frenzy_test", {"p_kind": "rotschreck", "p_difficulty": 7}),
    ({"action": "degeneracao", "difficulty": 6}, "v3_degeneration_test", {"p_difficulty": 6}),
])
def test_sheet_actions_reach_their_rpc(client, body: dict[str, Any], function: str, sent: dict[str, Any]) -> None:
    http, calls = client
    response = http.post(f"/api/v1/system-rolls/vampire-v3/sheets/{SHEET_ID}/actions", headers={"Authorization": "Bearer t"},
                         json={"operation_id": OPERATION_ID, **body})
    assert response.status_code == 200, response.text
    assert calls == [(function, {"p_sheet_id": SHEET_ID, "p_operation_id": OPERATION_ID, **sent})]


def test_sheet_actions_need_their_numbers(client) -> None:
    http, calls = client
    url = f"/api/v1/system-rolls/vampire-v3/sheets/{SHEET_ID}/actions"
    assert http.post(url, json={"operation_id": OPERATION_ID, "action": "frenesi"}).status_code == 422
    assert http.post(url, json={"operation_id": OPERATION_ID, "action": "dano", "amount": 2}).status_code == 422
    assert http.post(url, json={"operation_id": OPERATION_ID, "action": "sangue", "amount": 1, "turn": "bad turn"}).status_code == 422
    assert calls == []


def test_sheet_route_migrates_and_derives(client) -> None:
    http, _ = client
    response = http.post("/api/v1/system-rolls/vampire-v3/sheet", json={"values": {"predador": "Gato de Beco", "ant_geracao": 4}, "migrate": True})
    assert response.status_code == 200
    body = response.json()
    assert "predador" not in body["values"] and body["derived"]["sangue_max"] == 14 and body["warnings"]
