from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.routes.generators import require_signed_in_user
from app.routes.system_rolls import router
from app.services import system_rolls
from app.services.system_rolls import HunterRollRequest, OneRingRollRequest, roll_hunter, roll_one_ring


@pytest.fixture
def client():
    test_app = FastAPI()
    test_app.include_router(router)
    test_app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.pop(require_signed_in_user, None)


def force_rolls(monkeypatch: pytest.MonkeyPatch, values: list[int]) -> None:
    rolls = iter(values)
    monkeypatch.setattr(system_rolls.secrets, "randbelow", lambda bound: next(rolls))


def test_hunter_uses_optional_additional_desperation_dice(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [9, 9, 0, 5, 9, 9])
    result = roll_hunter(HunterRollRequest(base_pool=4, difficulty=5, desperation=2, use_desperation=True))
    assert result.normal_dice == [10, 10, 1, 6]
    assert result.desperation_dice == [10, 10]
    assert result.total_pool == 6
    assert result.desperation_ones == 0
    assert result.critical_pairs == 2
    assert result.successes == 9
    assert result.success is True
    assert result.verdict == "Crítico"


def test_hunter_reports_desperation_one_for_table_adjudication(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [5, 5, 0])
    result = roll_hunter(HunterRollRequest(base_pool=2, difficulty=2, desperation=1, use_desperation=True))
    assert result.desperation_ones == 1
    assert result.success is True
    assert result.desperation_consequence == "table_choice"


def test_hunter_desperation_is_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [5, 5])
    result = roll_hunter(HunterRollRequest(base_pool=2, difficulty=1, desperation=5))
    assert result.normal_dice == [6, 6]
    assert result.desperation_dice == []
    assert result.total_pool == 2


def test_hunter_validation_is_strict_and_bounded() -> None:
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=True, difficulty=1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=31, difficulty=1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=4, difficulty=1, desperation=-1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=4, difficulty=1, desperation=1, extra_field=1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=30, difficulty=70)


def test_one_ring_eye_is_zero_and_weary_zeros_low_success_dice(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [10, 0, 2, 5])
    result = roll_one_ring(OneRingRollRequest(target=7, skill_dice=3, endurance=10, load=10))
    assert result.feat_die == 11
    assert result.eye_of_sauron is True
    assert result.success is False
    assert result.weary is True
    assert result.success_dice == [1, 3, 6]
    assert result.counted_success_dice == [0, 0, 6]
    assert result.success is False


def test_one_ring_eye_can_succeed_from_success_dice_total(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [10, 5, 5, 5, 5, 5, 5])
    result = roll_one_ring(OneRingRollRequest(target=36, skill_dice=6, endurance=20, load=0))
    assert result.eye_of_sauron is True
    assert result.total == 36
    assert result.success is True


def test_one_ring_gandalf_rune_is_automatic_success(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [11, 0])
    result = roll_one_ring(OneRingRollRequest(target=99, skill_dice=1, endurance=11, load=10))
    assert result.feat_die == 12
    assert result.automatic_success is True
    assert result.success is True
    assert result.weary is False


@pytest.mark.parametrize(
    ("favored", "ill_favored", "rolls", "picked"),
    [(True, False, [10, 11], 12), (False, True, [1, 10], 11)],
)
def test_one_ring_favor_selects_best_or_worst_feat_die(
    monkeypatch: pytest.MonkeyPatch, favored: bool, ill_favored: bool, rolls: list[int], picked: int
) -> None:
    force_rolls(monkeypatch, rolls)
    result = roll_one_ring(OneRingRollRequest(
        target=1, skill_dice=0, endurance=1, load=0, favored=favored, ill_favored=ill_favored,
    ))
    assert result.feat_dice == [roll + 1 for roll in rolls]
    assert result.feat_die == picked


def test_one_ring_rejects_conflicting_favor_and_invalid_bounds() -> None:
    with pytest.raises(ValidationError):
        OneRingRollRequest(target=1, skill_dice=1, endurance=1, load=0, favored=True, ill_favored=True)
    with pytest.raises(ValidationError):
        OneRingRollRequest(target=1, skill_dice=True, endurance=1, load=0)
    with pytest.raises(ValidationError):
        OneRingRollRequest(target=1, skill_dice=7, endurance=1, load=0)


def test_roll_routes_require_signed_in_user() -> None:
    test_app = FastAPI()
    test_app.include_router(router)
    with TestClient(test_app) as client:
        response = client.post("/api/v1/system-rolls/hunter", json={"base_pool": 2, "difficulty": 1})
    assert response.status_code in (401, 503)


def test_hunter_route_returns_separate_additional_dice(client, monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [5, 0, 9])
    response = client.post("/api/v1/system-rolls/hunter", json={
        "base_pool": 2, "difficulty": 2, "desperation": 1, "use_desperation": True,
    })
    assert response.status_code == 200
    assert response.json()["normal_dice"] == [6, 1]
    assert response.json()["desperation_dice"] == [10]
    assert response.json()["total_pool"] == 3
    assert response.json()["success"] is True
