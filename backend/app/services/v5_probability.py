"""Probabilidades exatas para uma parada de dados de Vampire: The Masquerade V5.

Regras assumidas neste módulo:
- Cada dado de dez faces tem sucesso em 6-9 e resultado 10; cada 10 conta como
  um sucesso, e cada par de 10 acrescenta dois sucessos.
- Um crítico sujo ocorre quando a rolagem alcança a dificuldade com ao menos
  dois resultados 10 e um desses 10 veio de um Dado de Fome.
- Uma falha bestial ocorre quando a rolagem fica abaixo da dificuldade e pelo
  menos um Dado de Fome mostra 1. Os eventos críticos sujos e falhas bestiais
  são avaliados sobre o resultado final da rolagem.
- A condição com Vontade presume que o jogador escolhe rerrolar o máximo
  permitido de dados comuns que falharam, até três; Dados de Fome não podem ser
  rerrolados. Essa política maximiza a chance de atingir a dificuldade.

O cálculo usa programação dinâmica sobre contagens de resultados e mantém
inteiros até a divisão final, sem enumerar sequências individuais de dados.
"""

from __future__ import annotations

from dataclasses import dataclass


MAX_POOL = 30
MAX_DIFFICULTY = 100
MAX_WILLPOWER_REROLLS = 3


@dataclass(frozen=True, slots=True)
class RollProbabilities:
    """Probabilidades dos três eventos consultados para uma condição."""

    success: float
    messy_critical: float
    bestial_failure: float


@dataclass(frozen=True, slots=True)
class V5ProbabilityComparison:
    """Estimativas sem rerrolagem e com a política de Vontade assumida."""

    without_reroll: RollProbabilities
    with_reroll: RollProbabilities
    reroll_limit: int


def estimate_probabilities(
    pool: int,
    hunger: int,
    difficulty: int,
    willpower_dice: int = MAX_WILLPOWER_REROLLS,
) -> V5ProbabilityComparison:
    """Retorna chances exatas, com e sem rerrolagem de dados comuns.

    `pool` inclui os Dados de Fome. `willpower_dice` define o teto de dados
    comuns rerrolados, limitado a três. Parâmetros precisam ser inteiros exatos
    (booleanos não são aceitos como inteiros).
    """
    _validate_inputs(pool, hunger, difficulty, willpower_dice)

    states = _roll_distribution(pool, hunger)
    ordinary_dice = pool - hunger
    base_counts = [0, 0, 0]
    reroll_counts = [0, 0, 0]
    reroll_cap = min(willpower_dice, MAX_WILLPOWER_REROLLS)
    reroll_distributions = {
        count: _reroll_distribution(count) for count in range(reroll_cap + 1)
    }

    for (ordinary_successes, ordinary_tens, hunger_successes, hunger_tens, hunger_ones), ways in states.items():
        base = _count_events(
            ordinary_successes,
            ordinary_tens,
            hunger_successes,
            hunger_tens,
            hunger_ones,
            difficulty,
        )
        for index, event in enumerate(base):
            base_counts[index] += ways * event

        ordinary_failures = ordinary_dice - ordinary_successes - ordinary_tens
        rerolled = min(reroll_cap, ordinary_failures)
        for (extra_successes, extra_tens), reroll_ways in reroll_distributions[rerolled].items():
            events = _count_events(
                ordinary_successes + extra_successes,
                ordinary_tens + extra_tens,
                hunger_successes,
                hunger_tens,
                hunger_ones,
                difficulty,
            )
            # Every path uses denominator 10 ** (pool + reroll_cap).
            weight = ways * reroll_ways * (10 ** (reroll_cap - rerolled))
            for index, event in enumerate(events):
                reroll_counts[index] += weight * event

    return V5ProbabilityComparison(
        without_reroll=_as_probabilities(base_counts, 10**pool),
        with_reroll=_as_probabilities(reroll_counts, 10 ** (pool + reroll_cap)),
        reroll_limit=reroll_cap,
    )


def _validate_inputs(pool: int, hunger: int, difficulty: int, willpower_dice: int) -> None:
    values = (pool, hunger, difficulty, willpower_dice)
    if any(type(value) is not int for value in values):
        raise ValueError("pool, fome, dificuldade e rerrolagens precisam ser inteiros")
    if not 0 <= pool <= MAX_POOL:
        raise ValueError(f"pool deve estar entre 0 e {MAX_POOL}")
    if not 0 <= hunger <= min(pool, 5):
        raise ValueError("fome deve estar entre 0 e o menor valor entre pool e 5")
    if not 1 <= difficulty <= MAX_DIFFICULTY:
        raise ValueError(f"dificuldade deve estar entre 1 e {MAX_DIFFICULTY}")
    if not 0 <= willpower_dice <= MAX_WILLPOWER_REROLLS:
        raise ValueError(f"rerrolagens devem estar entre 0 e {MAX_WILLPOWER_REROLLS}")


def _roll_distribution(
    pool: int, hunger: int
) -> dict[tuple[int, int, int, int, int], int]:
    """Mapeia sucesso comum, 10 comum, sucesso de fome, 10 de fome e 1 de fome."""
    states: dict[tuple[int, int, int, int, int], int] = {(0, 0, 0, 0, 0): 1}
    for is_hunger in (False,) * (pool - hunger) + (True,) * hunger:
        next_states: dict[tuple[int, int, int, int, int], int] = {}
        for state, ways in states.items():
            failure_faces = 4 if is_hunger else 5
            _add_state(next_states, _advance(state, is_hunger, "failure"), ways * failure_faces)
            _add_state(next_states, _advance(state, is_hunger, "success"), ways * 4)
            _add_state(next_states, _advance(state, is_hunger, "ten"), ways)
            if is_hunger:
                _add_state(next_states, _advance(state, is_hunger, "one"), ways)
        states = next_states
    return states


def _advance(
    state: tuple[int, int, int, int, int], is_hunger: bool, result: str
) -> tuple[int, int, int, int, int]:
    ordinary_successes, ordinary_tens, hunger_successes, hunger_tens, hunger_ones = state
    if is_hunger:
        if result == "success":
            hunger_successes += 1
        elif result == "ten":
            hunger_tens += 1
        elif result == "one":
            hunger_ones += 1
    elif result == "success":
        ordinary_successes += 1
    elif result == "ten":
        ordinary_tens += 1
    return ordinary_successes, ordinary_tens, hunger_successes, hunger_tens, hunger_ones


def _add_state(
    states: dict[tuple[int, int, int, int, int], int],
    state: tuple[int, int, int, int, int],
    ways: int,
) -> None:
    states[state] = states.get(state, 0) + ways


def _reroll_distribution(count: int) -> dict[tuple[int, int], int]:
    """Distribui resultados de rerrolagens: falha, sucesso 6-9 e 10."""
    states: dict[tuple[int, int], int] = {(0, 0): 1}
    for _ in range(count):
        next_states: dict[tuple[int, int], int] = {}
        for (successes, tens), ways in states.items():
            next_states[(successes, tens)] = next_states.get((successes, tens), 0) + ways * 5
            next_states[(successes + 1, tens)] = next_states.get((successes + 1, tens), 0) + ways * 4
            next_states[(successes, tens + 1)] = next_states.get((successes, tens + 1), 0) + ways
        states = next_states
    return states


def _count_events(
    ordinary_successes: int,
    ordinary_tens: int,
    hunger_successes: int,
    hunger_tens: int,
    hunger_ones: int,
    difficulty: int,
) -> tuple[int, int, int]:
    tens = ordinary_tens + hunger_tens
    successes = ordinary_successes + hunger_successes + tens + 2 * (tens // 2)
    success = successes >= difficulty
    messy = success and tens >= 2 and hunger_tens > 0
    bestial = not success and hunger_ones > 0
    return int(success), int(messy), int(bestial)


def _as_probabilities(counts: list[int], denominator: int) -> RollProbabilities:
    return RollProbabilities(*(count / denominator for count in counts))
