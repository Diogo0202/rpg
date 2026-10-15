from itertools import product

import pytest

from app.services.v5_probability import estimate_probabilities


def enumerate_events(pool: int, hunger: int, difficulty: int) -> tuple[float, float, float]:
    """Small-pool oracle using actual faces instead of aggregated DP states."""
    event_counts = [0, 0, 0]
    for dice in product(range(1, 11), repeat=pool):
        hunger_dice = dice[pool - hunger:] if hunger else ()
        tens = sum(face == 10 for face in dice)
        successes = sum(face >= 6 for face in dice) + (tens // 2) * 2
        reached = successes >= difficulty
        event_counts[0] += reached
        event_counts[1] += reached and tens >= 2 and 10 in hunger_dice
        event_counts[2] += not reached and 1 in hunger_dice
    return tuple(count / (10 ** pool) for count in event_counts)


@pytest.mark.parametrize("pool,hunger,difficulty", [
    (0, 0, 1), (1, 0, 1), (1, 1, 1), (2, 1, 2),
    (2, 2, 4), (3, 1, 2), (3, 2, 3), (3, 3, 5),
])
def test_exact_distribution_matches_enumerated_faces(pool, hunger, difficulty):
    comparison = estimate_probabilities(pool, hunger, difficulty, willpower_dice=0)
    expected = enumerate_events(pool, hunger, difficulty)
    actual = comparison.without_reroll
    assert (actual.success, actual.messy_critical, actual.bestial_failure) == pytest.approx(expected)
    assert comparison.with_reroll == actual


def test_one_ordinary_and_one_hunger_die_with_one_reroll():
    # Ordinary failure is 1/2 initially and 1/4 after the allowed retry.
    # Hunger stays unchanged. A normal ten has chance 1/10 + (1/2 * 1/10).
    result = estimate_probabilities(pool=2, hunger=1, difficulty=1, willpower_dice=1)
    assert result.without_reroll.success == pytest.approx(0.75)
    assert result.without_reroll.messy_critical == pytest.approx(0.01)
    assert result.without_reroll.bestial_failure == pytest.approx(0.05)
    assert result.with_reroll.success == pytest.approx(0.875)
    assert result.with_reroll.messy_critical == pytest.approx(0.015)
    assert result.with_reroll.bestial_failure == pytest.approx(0.025)


def test_hunger_only_pool_cannot_benefit_from_willpower():
    result = estimate_probabilities(pool=5, hunger=5, difficulty=4, willpower_dice=3)
    assert result.with_reroll == result.without_reroll


@pytest.mark.parametrize("pool,hunger,difficulty,rerolls", [
    (True, 0, 1, 3), (2, True, 1, 3), (2, 3, 1, 3),
    (31, 0, 1, 3), (2, 0, 0, 3), (2, 0, 1, 4),
])
def test_probability_domain_rejects_invalid_inputs(pool, hunger, difficulty, rerolls):
    with pytest.raises(ValueError):
        estimate_probabilities(pool, hunger, difficulty, rerolls)
