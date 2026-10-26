from fractions import Fraction
from functools import lru_cache
from itertools import combinations, product

import pytest

from app.services.v5_probability import estimate_curve, estimate_probabilities, recommend_reroll


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


def _faces_events(normal: tuple[int, ...], hunger: tuple[int, ...], difficulty: int) -> tuple[bool, bool, bool]:
    dice = (*normal, *hunger)
    tens = dice.count(10)
    successes = sum(face >= 6 for face in dice) + (tens // 2) * 2
    reached = successes >= difficulty
    return reached, reached and tens >= 2 and 10 in hunger, (not reached) and 1 in hunger


@lru_cache(maxsize=None)
def _face_tuples(size: int) -> tuple[tuple[int, ...], ...]:
    return tuple(product(range(1, 11), repeat=size))


@lru_cache(maxsize=None)
def _oracle_best(normal: tuple[int, ...], hunger: tuple[int, ...], difficulty: int, cap: int):
    """Tries every subset of ordinary dice and every individual reroll face.

    Subsets that pick the same faces (positions holding equal faces) give the
    same outcome, so each distinct multiset of chosen faces is evaluated once.
    """
    best = None
    for size in range(min(cap, len(normal)) + 1):
        seen: set[tuple[int, ...]] = set()
        for subset in combinations(range(len(normal)), size):
            chosen = tuple(normal[index] for index in subset)
            if chosen in seen:
                continue
            seen.add(chosen)
            kept = tuple(face for index, face in enumerate(normal) if index not in subset)
            success = messy = bestial = 0
            for faces in _face_tuples(size):
                s, m, b = _faces_events((*kept, *faces), hunger, difficulty)
                success += s
                messy += m
                bestial += b
            success, messy, bestial = (Fraction(value, 10 ** size) for value in (success, messy, bestial))
            key = (success, -messy, -size)
            if best is None or key > best[0]:
                best = (key, (success, messy, bestial), subset)
    return best


def enumerate_optimal_reroll(pool: int, hunger: int, difficulty: int, cap: int) -> tuple[float, float, float]:
    totals = [Fraction(0)] * 3
    weight = Fraction(1, 10 ** pool)
    for dice in product(range(1, 11), repeat=pool):
        normal = tuple(sorted(dice[: pool - hunger]))
        hunger_dice = tuple(sorted(dice[pool - hunger:]))
        events = _oracle_best(normal, hunger_dice, difficulty, cap)[1]
        totals = [total + weight * event for total, event in zip(totals, events)]
    return tuple(float(total) for total in totals)


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


@pytest.mark.parametrize("pool,hunger,difficulty,cap", [
    (1, 0, 1, 1), (2, 0, 4, 1), (2, 1, 1, 1), (2, 1, 2, 2),
    (3, 0, 4, 3), (3, 1, 3, 2), (3, 1, 4, 3), (3, 2, 2, 1),
    (4, 1, 4, 2), (4, 2, 3, 3), (4, 0, 6, 2), (4, 1, 2, 2), (4, 1, 4, 3),
])
def test_optimal_reroll_matches_full_enumeration_of_choices(pool, hunger, difficulty, cap):
    result = estimate_probabilities(pool, hunger, difficulty, willpower_dice=cap).with_reroll
    expected = enumerate_optimal_reroll(pool, hunger, difficulty, cap)
    assert (result.success, result.messy_critical, result.bestial_failure) == pytest.approx(expected, abs=1e-12)


def test_rerolling_a_success_to_chase_a_critical_beats_failures_only_policy():
    # Two ordinary dice, difficulty 4: only a pair of tens (4 successes) wins.
    # With 10 + 7 the failures-only policy has nothing to reroll; the optimum
    # rerolls the 7 and wins on a 10.
    result = estimate_probabilities(pool=2, hunger=0, difficulty=4, willpower_dice=1)
    assert result.without_reroll.success == pytest.approx(0.01)
    # Base 1%, plus: one ten and one non-ten (2 * 0.1 * 0.9) rerolling the non-ten for a 10.
    assert result.with_reroll.success == pytest.approx(0.01 + 2 * 0.1 * 0.9 * 0.1)
    assert recommend_reroll([10, 7], [], 4, 1) == [1]


def test_one_ordinary_and_one_hunger_die_with_one_reroll():
    # Ordinary failure is 1/2 initially and 1/4 after the allowed retry.
    # Hunger stays unchanged. With ordinary 10 and Hunger 10 the roll already
    # succeeds, so the optimum rerolls the ordinary 10 to dodge the messy
    # critical, which then only happens on another 10 (1/100 * 1/10).
    result = estimate_probabilities(pool=2, hunger=1, difficulty=1, willpower_dice=1)
    assert result.without_reroll.success == pytest.approx(0.75)
    assert result.without_reroll.messy_critical == pytest.approx(0.01)
    assert result.without_reroll.bestial_failure == pytest.approx(0.05)
    assert result.with_reroll.success == pytest.approx(0.875)
    assert result.with_reroll.messy_critical == pytest.approx(0.001)
    assert result.with_reroll.bestial_failure == pytest.approx(0.025)


def test_recommendation_keeps_helpful_dice_and_never_touches_hunger():
    assert recommend_reroll([7, 8, 9], [1], 3, 3) == []
    assert recommend_reroll([2, 8, 1, 4], [5], 3, 3) == [0, 2, 3]
    assert recommend_reroll([], [10, 10], 2, 3) == []
    with pytest.raises(ValueError):
        recommend_reroll([11], [], 1, 1)


def test_hunger_only_pool_cannot_benefit_from_willpower():
    result = estimate_probabilities(pool=5, hunger=5, difficulty=4, willpower_dice=3)
    assert result.with_reroll == result.without_reroll


def test_optimal_reroll_never_worse_and_largest_pool_is_fast():
    result = estimate_probabilities(pool=30, hunger=5, difficulty=12, willpower_dice=3)
    assert result.with_reroll.success >= result.without_reroll.success


def test_curve_caps_hunger_per_pool_and_sorts_difficulties():
    series = estimate_curve([2, 6], hunger=3, difficulties=[4, 1, 2], willpower_dice=3)
    assert [item.hunger_dice for item in series] == [2, 3]
    assert [point.difficulty for point in series[0].points] == [1, 2, 4]
    single = estimate_probabilities(6, 3, 2, 3)
    assert series[1].points[1].with_reroll == single.with_reroll
    successes = [point.without_reroll.success for point in series[1].points]
    assert successes == sorted(successes, reverse=True)
    with pytest.raises(ValueError):
        estimate_curve([1, 1], 0, [1])
    with pytest.raises(ValueError):
        estimate_curve(list(range(7)), 0, [1])


@pytest.mark.parametrize("pool,hunger,difficulty,rerolls", [
    (True, 0, 1, 3), (2, True, 1, 3), (2, 3, 1, 3),
    (31, 0, 1, 3), (2, 0, 0, 3), (2, 0, 1, 4),
])
def test_probability_domain_rejects_invalid_inputs(pool, hunger, difficulty, rerolls):
    with pytest.raises(ValueError):
        estimate_probabilities(pool, hunger, difficulty, rerolls)
