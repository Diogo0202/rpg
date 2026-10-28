import random
from fractions import Fraction
from itertools import product

import pytest

from app.services.v5_blood import (
    BLOOD_POTENCY_TABLE, CLAN_COMPULSIONS, COMPULSION_OPTIONS, blood_potency, blood_state, compulsion_from_die,
    compulsion_probabilities, count_successes, enumerate_remorse, enumerate_rouse, frenzy_pool,
    frenzy_resist_probability, halve_superficial, remorse_pool, resolve_frenzy, resolve_remorse, resolve_rouse,
    rouse_reroll_allowed, rouse_success_probability, torpor_duration,
)


def test_potency_table_is_monotonic_and_clamped():
    assert [row.potency for row in BLOOD_POTENCY_TABLE] == list(range(11))
    for previous, row in zip(BLOOD_POTENCY_TABLE, BLOOD_POTENCY_TABLE[1:]):
        for field in ("surge", "mend", "power_bonus", "rouse_reroll_level", "bane_severity", "human_slake_penalty"):
            assert getattr(row, field) >= getattr(previous, field)
    assert blood_potency(-3).potency == 0 and blood_potency(42).potency == 10
    assert blood_potency(2).animal_slake == "half" and blood_potency(3).animal_slake == "none"
    assert blood_potency(5).kill_to_reduce_below == 2 and blood_potency(8).kill_to_reduce_below == 3


@pytest.mark.parametrize(("potency", "level", "allowed"), [(0, 1, False), (1, 1, True), (1, 2, False), (3, 2, True), (10, 5, True), (5, None, False)])
def test_rouse_reroll_by_potency_and_level(potency, level, allowed):
    assert rouse_reroll_allowed(potency, level) is allowed


def test_rouse_enumeration_matches_closed_form():
    for hunger in range(5):
        plain = enumerate_rouse(hunger, reroll_allowed=False)
        assert plain == {hunger: Fraction(1, 2), hunger + 1: Fraction(1, 2)}
        reroll = enumerate_rouse(hunger, reroll_allowed=True)
        assert reroll[hunger] == Fraction(3, 4) == rouse_success_probability(1, 1)
    assert enumerate_rouse(5, reroll_allowed=False) == {5: Fraction(1)}


def test_rouse_at_hunger_five_flags_frenzy_and_validates_dice():
    failed = resolve_rouse([3], 5)
    assert failed.hunger_after == 5 and failed.hunger_frenzy_test
    assert not resolve_rouse([6], 5).hunger_frenzy_test
    assert resolve_rouse([2, 7], 2, reroll_allowed=True).success
    with pytest.raises(ValueError):
        resolve_rouse([2, 7], 2)
    with pytest.raises(ValueError):
        resolve_rouse([7, 2], 2, reroll_allowed=True)
    with pytest.raises(ValueError):
        resolve_rouse([11], 1)


def test_remorse_pool_and_outcomes():
    assert remorse_pool(7, 2) == 1 and remorse_pool(5, 1) == 4 and remorse_pool(10, 3) == 1
    kept = resolve_remorse([6], 7, 2)
    assert (kept.humanity_after, kept.stains_after) == (7, 0)
    lost = resolve_remorse([1, 5, 2, 3], 5, 1)
    assert (lost.humanity_after, lost.stains_after) == (4, 0)
    with pytest.raises(ValueError):
        resolve_remorse([6], 7, 0)
    with pytest.raises(ValueError):
        resolve_remorse([6, 6], 7, 2)


@pytest.mark.parametrize(("humanity", "stains"), [(7, 2), (5, 2), (4, 1), (2, 3)])
def test_remorse_enumeration(humanity, stains):
    pool = remorse_pool(humanity, stains)
    assert enumerate_remorse(humanity, stains) == 1 - Fraction(1, 2) ** pool


def test_frenzy_pool_and_brujah_bane():
    assert frenzy_pool(4, 7) == 6
    assert frenzy_pool(4, 7, clan="Brujah", kind="fury", potency=1) == 4
    assert frenzy_pool(4, 7, clan="Brujah", kind="terror", potency=1) == 6
    assert frenzy_pool(0, 2, clan="Brujah", potency=3) == 0


def test_frenzy_probability_matches_full_enumeration():
    for pool, difficulty in [(1, 1), (3, 2), (4, 3), (4, 4)]:
        wins = sum(resolve_frenzy(list(dice), difficulty).success for dice in product(range(1, 11), repeat=pool))
        assert frenzy_resist_probability(pool, difficulty) == Fraction(wins, 10 ** pool)
    assert count_successes([10, 10, 6, 1]) == 5


def test_frenzy_statistics_converge():
    rng = random.Random(7)
    pool, difficulty, trials = 6, 3, 20000
    wins = sum(resolve_frenzy([rng.randint(1, 10) for _ in range(pool)], difficulty).success for _ in range(trials))
    assert abs(wins / trials - float(frenzy_resist_probability(pool, difficulty))) < 0.015


def test_compulsion_table():
    assert [compulsion_from_die(face, "Brujah") for face in range(1, 11)] == [
        "Fome", "Fome", "Fome", "Dominação", "Dominação", "Destruição", "Destruição", "Paranoia", "Compulsão do clã", "Compulsão do clã"]
    assert compulsion_from_die(9, "Caitiff") is None
    caitiff = compulsion_probabilities("Caitiff")
    assert caitiff["Fome"] == Fraction(3, 8) and "Compulsão do clã" not in caitiff
    assert sum(compulsion_probabilities("Ventrue").values()) == 1
    assert len(CLAN_COMPULSIONS) == 14 and set(COMPULSION_OPTIONS) >= {"Nenhuma", "Compulsão do clã"}


def test_torpor_and_halving():
    assert torpor_duration(10) == "um dia" and torpor_duration(0) == "um milênio ou mais" and torpor_duration(99) == "um dia"
    assert [halve_superficial(value) for value in range(6)] == [0, 1, 1, 2, 2, 3]


def test_blood_state_derives_from_sheet_values():
    state = blood_state({"potencia_sangue": 2, "fome": 3, "humanidade": 7, "manchas": 2, "autocontrole": 2, "resolucao": 3,
                         "vontade_superficial": 1, "cla": "Brujah", "compulsao_atual": "Compulsão do clã", "torpor": False})
    assert state["potency"]["surge"] == 2 and state["remorse_pool"] == 1 and state["willpower_current"] == 4
    assert state["frenzy_pool"] == {"fury": 4, "hunger": 6, "terror": 6}
    assert state["compulsion_detail"]["name"] == "Rebeldia" and state["in_torpor"] is False
    empty = blood_state({})
    assert empty["remorse_pool"] == 0 and empty["remorse_success"] is None
