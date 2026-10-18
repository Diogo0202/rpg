from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from app.routes.generators import require_signed_in_user
from app.routes.modifiers import router as modifiers_router
from app.services.modifiers import ModifierRequest, preview_modifiers


app = FastAPI()
app.include_router(modifiers_router)
client = TestClient(app)


def effect(effect_id: str, **overrides: object) -> dict[str, object]:
    return {"id": effect_id, "label": effect_id, "delta": 1, **overrides}


def test_stacks_effects_and_clips_at_pool_bounds() -> None:
    low = preview_modifiers(ModifierRequest(base_pool=2, effects=[effect("a", delta=-5)]))
    high = preview_modifiers(ModifierRequest(base_pool=28, effects=[effect("b", delta=5)]))
    assert (low.adjusted_pool, low.total_delta, low.clipped) == (0, -5, True)
    assert (high.adjusted_pool, high.total_delta, high.clipped) == (30, 5, True)

    stacked = preview_modifiers(
        ModifierRequest(base_pool=10, effects=[effect("a", delta=2), effect("b", delta=-1)])
    )
    assert stacked.adjusted_pool == 11
    assert [item.id for item in stacked.applied] == ["a", "b"]


def test_effect_scope_exemptions_and_expiry() -> None:
    result = preview_modifiers(
        ModifierRequest(
            base_pool=8,
            context_tags=["combat", "night"],
            effects=[
                effect("global"),
                effect("in-scope", applies_to_tags=["combat"]),
                effect("out-of-scope", applies_to_tags=["social"]),
                effect("exempt", exempt_tags=["night"]),
                effect("expired", remaining_scenes=0),
                effect("disabled", enabled=False),
                effect("disabled-expired", enabled=False, remaining_scenes=0),
                effect("last-scene", remaining_scenes=1),
            ],
        )
    )
    assert [item.id for item in result.applied] == ["global", "in-scope", "last-scene"]
    assert [(item.id, item.reason) for item in result.skipped] == [
        ("out-of-scope", "out_of_scope"),
        ("exempt", "exempt"),
        ("expired", "expired"),
        ("disabled", "disabled"),
        ("disabled-expired", "disabled"),
    ]


@pytest.mark.parametrize(
    "payload",
    [
        {"base_pool": True},
        {"base_pool": 31},
        {"base_pool": 1, "extra": 1},
        {"base_pool": 1, "adjusted_pool": 30},
        {"base_pool": 1, "context_tags": ["x"] * 21},
        {"base_pool": 1, "effects": [effect(str(index)) for index in range(31)]},
        {"base_pool": 1, "effects": [effect("same"), effect("same")]},
        {"base_pool": 1, "effects": [effect("x", delta=True)]},
        {"base_pool": 1, "effects": [effect("x", delta=11)]},
        {"base_pool": 1, "effects": [effect("x", remaining_scenes=-1)]},
        {"base_pool": 1, "effects": [effect("x", remaining_scenes=1001)]},
        {"base_pool": 1, "effects": [effect("x", enabled=1)]},
        {"base_pool": 1, "effects": [effect("x", id="i" * 65)]},
        {"base_pool": 1, "context_tags": ["t" * 65]},
        {"base_pool": 1, "effects": [effect("x", applies_to_tags=["t" * 65])]},
        {"base_pool": 1, "effects": [effect("x", source_note="n" * 501)]},
        {"base_pool": 1, "effects": [effect("x", extra=1)]},
        {
            "base_pool": 1,
            "effects": [
                effect(
                    str(index),
                    applies_to_tags=["a" * 64] * 20,
                    exempt_tags=["b" * 64] * 20,
                )
                for index in range(30)
            ],
        },
    ],
)
def test_rejects_invalid_contract_payloads(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ModifierRequest.model_validate(payload)


def test_preview_route_requires_signed_in_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-key")
    response = client.post("/api/v1/modifiers/preview", json={"base_pool": 5})
    assert response.status_code == 401


def test_roll_computes_pool_from_payload_and_rejects_zero_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    app.dependency_overrides[require_signed_in_user] = lambda: None
    try:
        calls: list[int] = []

        def fake_randbelow(sides: int) -> int:
            calls.append(sides)
            return 2

        monkeypatch.setattr("app.routes.modifiers.secrets.randbelow", fake_randbelow)
        payload = {
            "base_pool": 2,
            "effects": [effect("buff", delta=1)],
            "die_sides": 6,
        }
        response = client.post("/api/v1/modifiers/roll", json=payload)
        assert response.status_code == 200
        assert response.json() == {
            "preview": {
                "base_pool": 2,
                "total_delta": 1,
                "adjusted_pool": 3,
                "applied": [{"id": "buff", "label": "buff", "delta": 1, "source_note": None}],
                "skipped": [],
                "clipped": False,
            },
            "rolls": [3, 3, 3],
            "total": 9,
        }
        assert calls == [6, 6, 6]

        zero = client.post(
            "/api/v1/modifiers/roll",
            json={"base_pool": 1, "effects": [effect("penalty", delta=-1)], "die_sides": 6},
        )
        assert zero.status_code == 422
        assert len(calls) == 3

        forged = client.post(
            "/api/v1/modifiers/roll",
            json={**payload, "adjusted_pool": 30},
        )
        assert forged.status_code == 422
        assert len(calls) == 3
    finally:
        app.dependency_overrides.pop(require_signed_in_user, None)
