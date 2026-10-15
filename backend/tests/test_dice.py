from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import DiceRequest
from app.services.dice import roll
from app.services.modifiers import Effect


class HighRoller:
    def randint(self, low: int, high: int) -> int:
        return high


def test_rolls_safe_expression_and_preserves_constant_modifier(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.dice.secrets.SystemRandom", HighRoller)
    result = roll("2d6 + 3")
    assert result.expression == "2d6+3"
    assert result.rolls == [6, 6]
    assert result.total == 15
    assert result.modifier == 3
    assert result.modifier_preview is None


def test_preserves_legacy_dice_and_face_limits_without_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.dice.secrets.SystemRandom", HighRoller)
    many_dice = roll("40d6")
    assert len(many_dice.rolls) == 40
    assert many_dice.total == 240

    large_die = roll("1d1000")
    assert large_die.rolls == [1000]
    assert large_die.total == 1000


def test_effects_change_dice_count_and_keep_expression_modifier(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.dice.secrets.SystemRandom", HighRoller)
    penalty = Effect(id="penalty", label="penalty", delta=-2)
    result = roll("40d6+3", effects=[penalty])
    assert len(result.rolls) == 38
    assert result.modifier == 3
    assert result.total == 38 * 6 + 3
    assert result.modifier_preview is not None
    assert result.modifier_preview.adjusted_pool == 38


def test_scoped_effect_can_be_skipped_without_changing_die_size_or_modifier(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.dice.secrets.SystemRandom", HighRoller)
    scoped = Effect(id="scoped", label="scoped", delta=4, applies_to_tags=["combat"])
    result = roll("1d1000+7", effects=[scoped], context_tags=["social"])
    assert result.rolls == [1000]
    assert result.modifier == 7
    assert result.total == 1007
    assert result.modifier_preview is not None
    assert result.modifier_preview.skipped[0].reason == "out_of_scope"
    assert result.modifier_preview.adjusted_pool == 1


def test_rejects_zero_adjusted_pool_before_rng(monkeypatch: pytest.MonkeyPatch) -> None:
    def unexpected_rng():
        raise AssertionError("RNG must not run for a zero pool")

    monkeypatch.setattr("app.services.dice.secrets.SystemRandom", unexpected_rng)
    with pytest.raises(ValueError, match="ao menos um dado"):
        roll("1d6", effects=[Effect(id="penalty", label="penalty", delta=-1)])


@pytest.mark.parametrize("expression", ["0d6", "100d6", "1d1001", "1d0", "__import__('os')", "1d6;drop"])
def test_rejects_unsafe_or_excessive_rolls(expression: str) -> None:
    with pytest.raises(ValueError):
        roll(expression)


def test_rejects_duplicate_effect_ids_and_unknown_request_fields() -> None:
    duplicate_effects = [
        {"id": "same", "label": "one", "delta": 1},
        {"id": "same", "label": "two", "delta": 1},
    ]
    with pytest.raises(ValueError):
        roll("2d6", effects=duplicate_effects)
    with pytest.raises(ValidationError):
        DiceRequest.model_validate({"expression": "2d6", "unexpected": True})
