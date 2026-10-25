from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.routes.generators import require_signed_in_user
from app.routes.system_rolls import router
from app.services import system_rolls
from app.services.system_rolls import (
    HunterRollRequest,
    OneRingRollRequest,
    SotdlRollRequest,
    roll_hunter,
    roll_one_ring,
    roll_sotdl,
    roll_sotdl_fate,
)


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


def test_sotdl_boons_and_banes_cancel_and_the_highest_d6_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    # d20 = 8; 3 boons - 1 bane leave 2 boon dice, 2 and 5.
    force_rolls(monkeypatch, [7, 1, 4])
    result = roll_sotdl(SotdlRollRequest(attribute=12, boons=3, banes=1))
    assert (result.d20, result.modifier, result.net_boons) == (8, 2, 2)
    assert result.boon_dice == [2, 5]
    assert result.boon_value == 5
    assert result.total == 15
    assert result.success is True
    assert result.critical is False


def test_sotdl_banes_subtract_and_can_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [9, 3, 0])
    result = roll_sotdl(SotdlRollRequest(attribute=10, banes=2, target=10))
    assert result.boon_dice == [4, 1]
    assert result.boon_value == -4
    assert result.total == 6
    assert result.verdict == "Falha"


def test_sotdl_equal_boons_and_banes_roll_no_d6(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [9])
    result = roll_sotdl(SotdlRollRequest(attribute=10, boons=2, banes=2, target=10))
    assert result.boon_dice == []
    assert result.total == 10
    assert result.success is True


def test_sotdl_critical_needs_twenty_and_five_over_target(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [17])
    assert roll_sotdl(SotdlRollRequest(attribute=12, target=15)).critical is True
    force_rolls(monkeypatch, [17])
    assert roll_sotdl(SotdlRollRequest(attribute=12, target=16)).critical is False


@pytest.mark.parametrize(("roll", "outcome"), [(0, "dying"), (1, "stable"), (4, "stable"), (5, "recovers")])
def test_sotdl_fate_roll(monkeypatch: pytest.MonkeyPatch, roll: int, outcome: str) -> None:
    force_rolls(monkeypatch, [roll])
    result = roll_sotdl_fate()
    assert (result.die, result.outcome) == (roll + 1, outcome)


def test_sotdl_validation_is_strict_and_bounded() -> None:
    for payload in ({"attribute": 0}, {"attribute": 21}, {"attribute": True}, {"attribute": 10, "boons": 11},
                    {"attribute": 10, "target": 0}, {"attribute": 10, "extra": 1}):
        with pytest.raises(ValidationError):
            SotdlRollRequest(**payload)


def test_sotdl_routes_return_rolls(client, monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [19, 2, 0])
    response = client.post("/api/v1/system-rolls/shadow-demon-lord", json={"attribute": 9, "boons": 1, "target": 12})
    assert response.status_code == 200
    assert response.json()["total"] == 22
    assert response.json()["critical"] is True
    fate = client.post("/api/v1/system-rolls/shadow-demon-lord/fate")
    assert fate.status_code == 200
    assert fate.json()["outcome"] == "dying"


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
