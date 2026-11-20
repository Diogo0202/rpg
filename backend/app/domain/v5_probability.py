"""Probabilidades exatas para uma parada de dados de Vampire: The Masquerade V5.

Regras assumidas neste módulo:
- Cada dado de dez faces tem sucesso em 6-9 e resultado 10; cada 10 conta como
  um sucesso, e cada par de 10 acrescenta dois sucessos.
- Um crítico sujo ocorre quando a rolagem alcança a dificuldade com ao menos
  dois resultados 10 e um desses 10 veio de um Dado de Fome.
- Uma falha bestial ocorre quando a rolagem fica abaixo da dificuldade e pelo
  menos um Dado de Fome mostra 1. Os eventos críticos sujos e falhas bestiais
  são avaliados sobre o resultado final da rolagem.

Rerrolagem com Força de Vontade (V5-03)
---------------------------------------
Depois de ver a rolagem, o jogador pode rerrolar até três dados comuns; Dados de
Fome nunca são rerrolados. Para cada rolagem inicial possível, o motor avalia
todas as escolhas de quais dados comuns rerrolar: qualquer quantidade de falhas
(1-5), de sucessos simples (6-9) e de 10, desde que o total não passe do limite,
incluindo a opção de não rerrolar nada. Dados com a mesma classe de face são
intercambiáveis, então cada escolha é um trio (falhas, sucessos, 10).

Critério da estratégia ótima, em ordem lexicográfica:
1. maior probabilidade de atingir a dificuldade depois da rerrolagem;
2. em empate, menor probabilidade de crítico sujo (o jogador evita o risco);
3. em novo empate, menos dados rerrolados.
A falha bestial só depende de falhar e dos Dados de Fome, que não mudam, então
não entra no desempate. Assim, rerrolar um 6-9 para buscar um par de 10 é
escolhido quando aumenta a chance de sucesso, e dados que já ajudam ficam
parados quando mexer neles não compensa.

O cálculo usa programação dinâmica sobre contagens de resultados e mantém
inteiros até a divisão final, sem enumerar sequências individuais de dados.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache


MAX_POOL = 30
MAX_DIFFICULTY = 100
MAX_WILLPOWER_REROLLS = 3
MAX_CURVE_POOLS = 6
MAX_CURVE_DIFFICULTIES = 8


@dataclass(frozen=True, slots=True)
class RollProbabilities:
    """Probabilidades dos três eventos consultados para uma condição."""

    success: float
    messy_critical: float
    bestial_failure: float


@dataclass(frozen=True, slots=True)
class V5ProbabilityComparison:
    """Estimativas sem rerrolagem e com a estratégia ótima de Vontade."""

    without_reroll: RollProbabilities
    with_reroll: RollProbabilities
    reroll_limit: int


@dataclass(frozen=True, slots=True)
class CurvePoint:
    difficulty: int
    without_reroll: RollProbabilities
    with_reroll: RollProbabilities


@dataclass(frozen=True, slots=True)
class CurveSeries:
    pool: int
    hunger_dice: int
    points: list[CurvePoint]


def estimate_probabilities(
    pool: int,
    hunger: int,
    difficulty: int,
    willpower_dice: int = MAX_WILLPOWER_REROLLS,
) -> V5ProbabilityComparison:
    """Retorna chances exatas, sem rerrolagem e com a rerrolagem ótima.

    `pool` inclui os Dados de Fome. `willpower_dice` define o teto de dados
    comuns rerrolados, limitado a três. Parâmetros precisam ser inteiros exatos
    (booleanos não são aceitos como inteiros).
    """
    _validate_inputs(pool, hunger, difficulty, willpower_dice)
    return _cached_estimate(pool, hunger, difficulty, willpower_dice)


@lru_cache(maxsize=512)
def _cached_estimate(pool: int, hunger: int, difficulty: int, willpower_dice: int) -> V5ProbabilityComparison:
    return _evaluate(_roll_distribution(pool, hunger), pool, hunger, difficulty, willpower_dice)


def estimate_curve(
    pools: list[int],
    hunger: int,
    difficulties: list[int],
    willpower_dice: int = MAX_WILLPOWER_REROLLS,
) -> list[CurveSeries]:
    """Curva comparativa: cada parada contra cada dificuldade, com Fome fixa.

    A Fome é limitada ao tamanho de cada parada (uma parada de 2 com Fome 4 tem
    dois Dados de Fome), como acontece na mesa.
    """
    if type(pools) is not list or not 1 <= len(pools) <= MAX_CURVE_POOLS:
        raise ValueError(f"informe de 1 a {MAX_CURVE_POOLS} paradas")
    if type(difficulties) is not list or not 1 <= len(difficulties) <= MAX_CURVE_DIFFICULTIES:
        raise ValueError(f"informe de 1 a {MAX_CURVE_DIFFICULTIES} dificuldades")
    if len(set(pools)) != len(pools) or len(set(difficulties)) != len(difficulties):
        raise ValueError("paradas e dificuldades não podem se repetir")
    if type(hunger) is not int or not 0 <= hunger <= 5:
        raise ValueError("fome deve estar entre 0 e 5")
    series: list[CurveSeries] = []
    for pool in pools:
        if type(pool) is not int or not 0 <= pool <= MAX_POOL:
            raise ValueError(f"pool deve estar entre 0 e {MAX_POOL}")
        hunger_dice = min(hunger, pool)
        points = []
        for difficulty in sorted(difficulties):
            _validate_inputs(pool, hunger_dice, difficulty, willpower_dice)
            result = _cached_estimate(pool, hunger_dice, difficulty, willpower_dice)
            points.append(CurvePoint(difficulty, result.without_reroll, result.with_reroll))
        series.append(CurveSeries(pool=pool, hunger_dice=hunger_dice, points=points))
    return series


def recommend_reroll(
    normal_dice: list[int], hunger_dice: list[int], difficulty: int, willpower_dice: int = MAX_WILLPOWER_REROLLS
) -> list[int]:
    """Índices de `normal_dice` que a estratégia ótima rerrolaria nesta rolagem.

    Lista vazia quando nenhuma rerrolagem melhora a chance (ou o desempate).
    Entre dados da mesma classe, escolhe os de menor face primeiro.
    """
    if any(type(face) is not int or not 1 <= face <= 10 for face in (*normal_dice, *hunger_dice)):
        raise ValueError("faces devem estar entre 1 e 10")
    if len(hunger_dice) > 5 or len(normal_dice) + len(hunger_dice) > MAX_POOL:
        raise ValueError("parada inválida")
    _validate_inputs(len(normal_dice) + len(hunger_dice), len(hunger_dice), difficulty, willpower_dice)
    failures = [i for i, face in enumerate(normal_dice) if face < 6]
    singles = [i for i, face in enumerate(normal_dice) if 6 <= face <= 9]
    tens = [i for i, face in enumerate(normal_dice) if face == 10]
    hunger_successes = sum(6 <= face <= 9 for face in hunger_dice)
    hunger_tens = hunger_dice.count(10)
    choice = _best_choice(
        len(failures), len(singles), len(tens), hunger_successes, hunger_tens, difficulty, willpower_dice,
    )[0]
    by_face = lambda indices: sorted(indices, key=lambda i: normal_dice[i])  # noqa: E731
    a, b, c = choice
    return sorted(by_face(failures)[:a] + by_face(singles)[:b] + tens[:c])


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


def _evaluate(
    states: dict[tuple[int, int, int, int, int], int],
    pool: int,
    hunger: int,
    difficulty: int,
    willpower_dice: int,
) -> V5ProbabilityComparison:
    ordinary_dice = pool - hunger
    cap = min(willpower_dice, MAX_WILLPOWER_REROLLS)
    base_counts = [0, 0, 0]
    reroll_counts = [0, 0, 0]
    scale = 10**cap

    for (ordinary_successes, ordinary_tens, hunger_successes, hunger_tens, hunger_ones), ways in states.items():
        base = _count_events(ordinary_successes, ordinary_tens, hunger_successes, hunger_tens, hunger_ones, difficulty)
        for index, event in enumerate(base):
            base_counts[index] += ways * event

        failures = ordinary_dice - ordinary_successes - ordinary_tens
        _, success_ways, messy_ways = _best_choice(
            failures, ordinary_successes, ordinary_tens, hunger_successes, hunger_tens, difficulty, cap,
        )
        # Choice numerators share denominator 10 ** cap; bestial = failing with a hunger one.
        reroll_counts[0] += ways * success_ways
        reroll_counts[1] += ways * messy_ways
        if hunger_ones:
            reroll_counts[2] += ways * (scale - success_ways)

    return V5ProbabilityComparison(
        without_reroll=_as_probabilities(base_counts, 10**pool),
        with_reroll=_as_probabilities(reroll_counts, 10 ** (pool + cap)),
        reroll_limit=cap,
    )


@lru_cache(maxsize=65536)
def _best_choice(
    failures: int,
    singles: int,
    tens: int,
    hunger_successes: int,
    hunger_tens: int,
    difficulty: int,
    cap: int,
) -> tuple[tuple[int, int, int], int, int]:
    """Melhor trio (falhas, 6-9, 10) a rerrolar e numeradores sobre 10 ** cap."""
    best: tuple[tuple[int, int, int], int, int] | None = None
    best_key: tuple[int, int, int] | None = None
    for total in range(cap + 1):
        distribution = _reroll_entries(total)
        for a in range(min(failures, total) + 1):
            for b in range(min(singles, total - a) + 1):
                c = total - a - b
                if c > tens:
                    continue
                success_ways = 0
                messy_ways = 0
                kept_singles = singles - b + hunger_successes
                kept_tens = tens - c + hunger_tens
                for extra_successes, extra_tens, ways in distribution:
                    all_tens = kept_tens + extra_tens
                    if kept_singles + extra_successes + all_tens + 2 * (all_tens // 2) >= difficulty:
                        success_ways += ways
                        if all_tens >= 2 and hunger_tens:
                            messy_ways += ways
                factor = 10 ** (cap - total)
                success_ways *= factor
                messy_ways *= factor
                key = (success_ways, -messy_ways, -total)
                if best_key is None or key > best_key:
                    best_key = key
                    best = ((a, b, c), success_ways, messy_ways)
    assert best is not None
    return best


@lru_cache(maxsize=64)
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


@lru_cache(maxsize=8)
def _reroll_entries(count: int) -> tuple[tuple[int, int, int], ...]:
    return tuple((successes, tens, ways) for (successes, tens), ways in _reroll_distribution(count).items())


@lru_cache(maxsize=8)
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
