import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routes.generators import require_signed_in_user


@pytest.fixture
def client():
    app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(require_signed_in_user, None)


def test_probability_uses_adjusted_pool_and_caps_hunger_dice(client):
    response = client.post("/api/v1/v5/probabilities", json={
        "pool": 3, "hunger": 4, "difficulty": 1,
        "effects": [{"id": "penalty", "label": "Condição da mesa", "delta": -2}],
    })
    assert response.status_code == 200
    result = response.json()
    assert result["modifier_preview"]["adjusted_pool"] == 1
    assert result["hunger_dice"] == 1
    assert result["without_reroll"]["success"] == pytest.approx(0.5)


def test_exempt_action_skips_penalty_in_probability(client):
    response = client.post("/api/v1/v5/probabilities", json={
        "pool": 4, "hunger": 0, "difficulty": 2,
        "context_tags": ["escapar-ameaca"],
        "effects": [{"id": "penalty", "label": "Condição", "delta": -2, "exempt_tags": ["escapar-ameaca"]}],
    })
    assert response.status_code == 200
    preview = response.json()["modifier_preview"]
    assert preview["adjusted_pool"] == 4
    assert preview["skipped"] == [{"id": "penalty", "reason": "exempt"}]


def test_probability_rejects_forged_adjusted_pool(client):
    response = client.post("/api/v1/v5/probabilities", json={
        "pool": 6, "hunger": 2, "difficulty": 3, "adjusted_pool": 30,
    })
    assert response.status_code == 422


def test_probability_rejects_duplicate_effects(client):
    effect = {"id": "one", "label": "Uma condição", "delta": -2}
    response = client.post("/api/v1/v5/probabilities", json={
        "pool": 6, "hunger": 2, "difficulty": 3, "effects": [effect, effect],
    })
    assert response.status_code == 422


def test_full_tracks_are_shared_between_action_and_probability_with_thirty_user_effects(monkeypatch, client):
    monkeypatch.setattr("app.services.v5_actions.secrets.randbelow", lambda sides: 5)
    payload = {
        "pool": 6,
        "hunger": 2,
        "difficulty": 2,
        "willpower_dice": 3,
        "context_tags": ["fisico", "mental"],
        "effects": [
            {"id": f"user-{index}", "label": f"Condição {index}", "delta": 0}
            for index in range(30)
        ],
        "damage": {
            "health_max": 3,
            "health_superficial": 2,
            "health_aggravated": 1,
            "willpower_max": 4,
            "willpower_superficial": 1,
            "willpower_aggravated": 3,
        },
    }

    action_payload = {key: value for key, value in payload.items() if key != "willpower_dice"}
    action = client.post("/api/v1/v5/roll", json=action_payload)
    probability = client.post("/api/v1/v5/probabilities", json=payload)

    assert action.status_code == 200
    assert probability.status_code == 200
    action_preview = action.json()["modifier_preview"]
    probability_preview = probability.json()["modifier_preview"]
    assert action_preview == probability_preview
    assert action_preview["total_delta"] == -4
    assert action_preview["adjusted_pool"] == 2
    assert action.json()["damage_penalties"] == ["health", "willpower"]


def test_server_reserved_damage_effect_ids_remain_rejected_for_both_requests(client):
    payload = {
        "pool": 4,
        "hunger": 0,
        "difficulty": 1,
        "context_tags": ["fisico"],
        "effects": [{"id": "__damage_health_full", "label": "Falsificado", "delta": 2}],
    }
    assert client.post("/api/v1/v5/roll", json=payload).status_code == 422
    assert client.post("/api/v1/v5/probabilities", json=payload).status_code == 422
