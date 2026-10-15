from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.routes.generators import require_signed_in_user
from app.routes.v5_actions import router
from fastapi import FastAPI


action_test_app = FastAPI()
action_test_app.include_router(router)


@pytest.fixture
def client():
    action_test_app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(action_test_app) as test_client:
        yield test_client
    action_test_app.dependency_overrides.pop(require_signed_in_user, None)


def rng_values(monkeypatch: pytest.MonkeyPatch, values: list[int]) -> None:
    sequence: Iterator[int] = iter(value - 1 for value in values)
    monkeypatch.setattr("app.services.v5_actions.secrets.randbelow", lambda sides: next(sequence))


def request(client: TestClient, **overrides: object):
    payload: dict[str, object] = {"pool": 2, "hunger": 0, "difficulty": 2}
    payload.update(overrides)
    return client.post("/api/v1/v5/roll", json=payload)


def test_classifies_success_clean_messy_and_bestial(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    rng_values(monkeypatch, [10, 10])
    clean = request(client, pool=2, difficulty=4)
    assert clean.status_code == 200
    assert clean.json()["success"] is True
    assert clean.json()["successes"] == 4
    assert clean.json()["clean_critical"] is True
    assert clean.json()["messy_critical"] is False

    rng_values(monkeypatch, [10, 10])
    messy = request(client, pool=2, hunger=1, difficulty=4)
    assert messy.status_code == 200
    assert messy.json()["clean_critical"] is False
    assert messy.json()["messy_critical"] is True

    rng_values(monkeypatch, [10, 10])
    failed_pair = request(client, pool=2, hunger=1, difficulty=5)
    assert failed_pair.status_code == 200
    assert failed_pair.json()["success"] is False
    assert failed_pair.json()["messy_critical"] is False

    rng_values(monkeypatch, [1])
    bestial = request(client, pool=1, hunger=1, difficulty=1)
    assert bestial.status_code == 200
    assert bestial.json()["success"] is False
    assert bestial.json()["bestial_failure"] is True


def test_success_without_critical_and_normal_hunger_classification(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    rng_values(monkeypatch, [6, 7, 10])
    response = request(client, pool=3, hunger=1, difficulty=3)
    assert response.status_code == 200
    assert response.json()["normal_dice"] == [6, 7]
    assert response.json()["hunger_dice"] == [10]
    assert response.json()["successes"] == 3
    assert response.json()["success"] is True
    assert response.json()["clean_critical"] is False
    assert response.json()["messy_critical"] is False


def test_full_health_applies_one_server_derived_penalty_only_to_physical_actions(
    monkeypatch: pytest.MonkeyPatch, client: TestClient,
) -> None:
    rng_values(monkeypatch, [6, 6, 6])
    damage = {
        "health_max": 3,
        "health_superficial": 2,
        "health_aggravated": 1,
        "willpower_max": 4,
        "willpower_superficial": 0,
        "willpower_aggravated": 0,
    }
    physical = request(client, pool=5, context_tags=["fisico", "fisico"], damage=damage)
    assert physical.status_code == 200
    assert physical.json()["modifier_preview"]["adjusted_pool"] == 3
    assert physical.json()["damage_penalties"] == ["health"]
    assert len(physical.json()["normal_dice"]) == 3

    rng_values(monkeypatch, [6] * 5)
    mental = request(client, pool=5, context_tags=["mental"], damage=damage)
    assert mental.status_code == 200
    assert mental.json()["modifier_preview"]["adjusted_pool"] == 5
    assert mental.json()["damage_penalties"] == []


def test_full_willpower_applies_server_penalty_to_mental_actions(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    rng_values(monkeypatch, [6, 6])
    response = request(
        client,
        pool=4,
        context_tags=["mental"],
        damage={
            "health_max": 0,
            "health_superficial": 0,
            "health_aggravated": 0,
            "willpower_max": 2,
            "willpower_superficial": 1,
            "willpower_aggravated": 1,
        },
    )
    assert response.status_code == 200
    assert response.json()["modifier_preview"]["adjusted_pool"] == 2
    assert response.json()["damage_penalties"] == ["willpower"]


def test_zero_pool_rejects_before_random_roll_with_table_guidance(
    monkeypatch: pytest.MonkeyPatch, client: TestClient,
) -> None:
    def unexpected_rng(_: int) -> int:
        raise AssertionError("RNG must not run for a zero pool")

    monkeypatch.setattr("app.services.v5_actions.secrets.randbelow", unexpected_rng)
    response = request(client, pool=2, effects=[{"id": "penalty", "label": "Penalidade", "delta": -2}])
    assert response.status_code == 422
    assert "mesa" in response.json()["detail"]


def test_rejects_duplicate_modifiers_and_overfilled_tracks(client: TestClient) -> None:
    effect = {"id": "same", "label": "Condição", "delta": -1}
    duplicate = request(client, effects=[effect, effect])
    assert duplicate.status_code == 422

    overfilled = request(client, damage={
        "health_max": 2,
        "health_superficial": 2,
        "health_aggravated": 1,
        "willpower_max": 0,
        "willpower_superficial": 0,
        "willpower_aggravated": 0,
    })
    assert overfilled.status_code == 422


def test_zero_track_does_not_create_damage_penalty(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    rng_values(monkeypatch, [6, 6])
    response = request(client, pool=2, context_tags=["fisico"], damage={
        "health_max": 0,
        "health_superficial": 0,
        "health_aggravated": 0,
        "willpower_max": 0,
        "willpower_superficial": 0,
        "willpower_aggravated": 0,
    })
    assert response.status_code == 200
    assert response.json()["damage_penalties"] == []
    assert response.json()["modifier_preview"]["adjusted_pool"] == 2


def test_roll_requires_signed_in_user(monkeypatch: pytest.MonkeyPatch) -> None:
    action_test_app.dependency_overrides.pop(require_signed_in_user, None)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = TestClient(action_test_app).post("/api/v1/v5/roll", json={"pool": 2, "hunger": 0, "difficulty": 1})
    assert response.status_code == 503
