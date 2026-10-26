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


SHEET_ID = "74000000-0000-4000-8000-000000000001"
CAMPAIGN_ID = "72000000-0000-4000-8000-000000000001"
ATTACK = {"sheet_id": SHEET_ID, "campaign_id": CAMPAIGN_ID}


def fake_weapon(monkeypatch: pytest.MonkeyPatch, weapon: dict[str, object] | None, calls: list[str] | None = None) -> None:
    from app.services.v5_actions import EquippedWeapon

    async def loader(attack, authorization):  # type: ignore[no-untyped-def]
        if calls is not None:
            calls.append(authorization)
        return EquippedWeapon.model_validate(weapon) if weapon else None

    monkeypatch.setattr("app.routes.v5_actions.load_equipped_weapon", loader)


def test_attack_adds_server_read_weapon_bonus_and_damage_type(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    calls: list[str] = []
    fake_weapon(monkeypatch, {"id": "75000000-0000-4000-8000-000000000002", "name": "Estaca flamejante", "damage_bonus": 2, "damage_type": "aggravated"}, calls)
    rng_values(monkeypatch, [6, 7, 8, 9])
    response = client.post("/api/v1/v5/roll", json={"pool": 4, "hunger": 0, "difficulty": 2, "attack": ATTACK},
                           headers={"Authorization": "Bearer user-token"})
    assert response.status_code == 200
    attack = response.json()["attack"]
    assert attack["margin"] == 2
    assert attack["weapon_bonus"] == 2
    assert attack["damage"] == 4
    assert attack["damage_type"] == "aggravated"
    assert [source["label"] for source in attack["sources"]] == ["Margem de sucesso", "Arma equipada: Estaca flamejante"]
    assert calls == ["Bearer user-token"]


def test_failed_attack_deals_no_damage_and_unarmed_is_superficial(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    fake_weapon(monkeypatch, None)
    rng_values(monkeypatch, [2, 3])
    failed = client.post("/api/v1/v5/roll", json={"pool": 2, "hunger": 0, "difficulty": 2, "attack": ATTACK})
    assert failed.status_code == 200
    assert failed.json()["attack"] == {
        "weapon": None, "margin": 0, "weapon_bonus": 0, "damage": 0, "damage_type": "superficial",
        "sources": [{"label": "Margem de sucesso", "value": 0}],
    }


def test_attack_rejects_client_supplied_weapon_values(client: TestClient) -> None:
    response = client.post("/api/v1/v5/roll", json={
        "pool": 2, "hunger": 0, "difficulty": 1,
        "attack": {**ATTACK, "damage_bonus": 10},
    })
    assert response.status_code == 422


def test_roll_without_attack_does_not_read_inventory(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    calls: list[str] = []
    fake_weapon(monkeypatch, None, calls)
    rng_values(monkeypatch, [6, 6])
    response = request(client)
    assert response.status_code == 200
    assert response.json()["attack"] is None
    assert calls == []


class FakeResponse:
    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        return self._body


def fake_supabase(monkeypatch: pytest.MonkeyPatch, response: FakeResponse, seen: dict[str, object]) -> None:
    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def get(self, url: str, headers: dict[str, str], params: dict[str, str]) -> FakeResponse:
            seen.update(url=url, headers=headers, params=params)
            return response

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.test")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable")
    monkeypatch.setattr("app.routes.v5_actions.httpx.AsyncClient", FakeClient)


def test_weapon_loader_filters_equipped_acquired_weapon_with_user_token(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from app.routes.v5_actions import load_equipped_weapon
    from app.services.v5_actions import AttackContext

    seen: dict[str, object] = {}
    fake_supabase(monkeypatch, FakeResponse(200, [{"id": "75000000-0000-4000-8000-000000000001", "name": "Faca", "damage_bonus": 1, "damage_type": "superficial"}]), seen)
    weapon = asyncio.run(load_equipped_weapon(AttackContext.model_validate(ATTACK), "Bearer user-token"))
    assert weapon is not None and weapon.damage_bonus == 1
    assert seen["url"] == "https://example.supabase.test/rest/v1/character_inventory"
    assert seen["headers"]["Authorization"] == "Bearer user-token"  # type: ignore[index]
    params = seen["params"]
    assert params["equipped"] == "is.true" and params["acquired"] == "is.true" and params["category"] == "eq.weapon"  # type: ignore[index]
    assert params["sheet_id"] == f"eq.{SHEET_ID}"  # type: ignore[index]


def test_weapon_loader_rejects_invalid_rows_and_denied_access(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from fastapi import HTTPException

    from app.routes.v5_actions import load_equipped_weapon
    from app.services.v5_actions import AttackContext

    context = AttackContext.model_validate(ATTACK)
    for response, status in (
        (FakeResponse(403, {}), 403),
        (FakeResponse(200, [{"id": "75000000-0000-4000-8000-000000000001", "name": "Canhão", "damage_bonus": 99}]), 503),
        (FakeResponse(200, [{}, {}]), 503),
    ):
        fake_supabase(monkeypatch, response, {})
        with pytest.raises(HTTPException) as caught:
            asyncio.run(load_equipped_weapon(context, "Bearer user-token"))
        assert caught.value.status_code == status
    with pytest.raises(HTTPException) as missing:
        asyncio.run(load_equipped_weapon(context, None))
    assert missing.value.status_code == 401


ROLL_ID = "76000000-0000-4000-8000-000000000001"


def stored_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": ROLL_ID, "sheet_id": SHEET_ID, "campaign_id": CAMPAIGN_ID, "difficulty": 2,
        "outcome": {"successes": 5, "success": True}, "rerolled_at": None,
    }
    row.update(overrides)
    return row


def fake_roll_read(monkeypatch: pytest.MonkeyPatch, rows: object, seen: dict[str, object] | None = None) -> None:
    async def read(method, path, authorization, *, params=None, payload=None):  # type: ignore[no-untyped-def]
        if seen is not None:
            seen.update(method=method, path=path, authorization=authorization, params=params)
        return rows

    monkeypatch.setattr("app.routes.v5_actions._supabase_request", read)


def test_stored_attack_uses_stored_outcome_and_server_weapon(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    seen: dict[str, object] = {}
    calls: list[str] = []
    fake_roll_read(monkeypatch, [stored_row()], seen)
    fake_weapon(monkeypatch, {"id": "75000000-0000-4000-8000-000000000002", "name": "Espada", "damage_bonus": 2, "damage_type": "superficial"}, calls)
    response = client.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack", headers={"Authorization": "Bearer user-token"})
    assert response.status_code == 200
    body = response.json()
    assert body["roll_id"] == ROLL_ID and body["sheet_id"] == SHEET_ID and body["rerolled"] is False
    assert body["attack"]["margin"] == 3 and body["attack"]["damage"] == 5
    assert seen["path"] == "v5_roll_records" and seen["authorization"] == "Bearer user-token"
    assert seen["params"]["id"] == f"eq.{ROLL_ID}"  # type: ignore[index]
    assert calls == ["Bearer user-token"]


def test_stored_attack_after_failed_or_rerolled_roll(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    fake_weapon(monkeypatch, None)
    fake_roll_read(monkeypatch, [stored_row(outcome={"successes": 1, "success": False})])
    failed = client.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack", json={"use_equipped_weapon": True})
    assert failed.status_code == 200 and failed.json()["attack"]["damage"] == 0

    fake_roll_read(monkeypatch, [stored_row(outcome={"successes": 4, "success": True}, rerolled_at="2026-10-26T12:01:00+00:00")])
    rerolled = client.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack")
    assert rerolled.status_code == 200
    assert rerolled.json()["rerolled"] is True and rerolled.json()["attack"]["damage"] == 2


def test_stored_attack_without_weapon_skips_inventory(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    calls: list[str] = []
    fake_weapon(monkeypatch, None, calls)
    fake_roll_read(monkeypatch, [stored_row()])
    response = client.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack", json={"use_equipped_weapon": False})
    assert response.status_code == 200 and response.json()["attack"]["weapon"] is None
    assert calls == []


def test_stored_attack_rejects_missing_or_invalid_rolls(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    fake_weapon(monkeypatch, None)
    fake_roll_read(monkeypatch, [])
    assert client.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack").status_code == 404
    fake_roll_read(monkeypatch, [stored_row(outcome={"successes": "9", "success": True})])
    assert client.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack").status_code == 502
    assert client.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack", json={"damage": 10}).status_code == 422
    assert client.post("/api/v1/v5/rolls/not-a-uuid/attack").status_code == 422


def test_stored_attack_requires_session() -> None:
    with TestClient(action_test_app) as unauthenticated:
        assert unauthenticated.post(f"/api/v1/v5/rolls/{ROLL_ID}/attack").status_code in {401, 503}
