"""Ciclo do Sangue de Vampiro: A Máscara 5ª ed. (funções puras, sem rede).

Espelhado em frontend/lib/v5-blood.ts e nas RPCs de
supabase/migrations/20261029100000_v5_blood_cycle.sql, que rolam os dados no
banco. Só nomes e mecânica resumida; os números marcados em REVIEW_RULES devem
ser conferidos no livro.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from fractions import Fraction
from itertools import product
from typing import Literal

FrenzyKind = Literal["fury", "hunger", "terror"]
AnimalSlake = Literal["full", "half", "none"]

REVIEW_RULES: tuple[str, ...] = (
    "Tabela da Potência de Sangue 0-10 (Surto, Remendar, Bônus de Poder, rerrolagem de Despertar o Sangue, Severidade da Perdição, alimentação).",
    "Resistência ao Frenesi: Força de Vontade atual + Humanidade / 3 (arredondado para baixo); o plano sugeria metade.",
    "Brujah subtraem a Severidade da Perdição ao resistir ao frenesi de fúria.",
    "Vampiro divide o dano superficial físico pela metade (para cima) depois da armadura.",
    "Tabela de Compulsão no d10: 1-3 Fome, 4-5 Dominação, 6-7 Destruição, 8 Paranoia, 9-10 do clã.",
    "Penalidade das Compulsões: -2 dados nas ações que não a satisfazem.",
    "Duração do Torpor por Humanidade.",
)


@dataclass(frozen=True)
class BloodPotencyRow:
    potency: int
    surge: int
    mend: int
    power_bonus: int
    rouse_reroll_level: int
    bane_severity: int
    animal_slake: AnimalSlake
    human_slake_penalty: int
    kill_to_reduce_below: int | None


def _row(bp: int, surge: int, mend: int, bonus: int, reroll: int, bane: int, human: int, kill: int | None) -> BloodPotencyRow:
    animal: AnimalSlake = "full" if bp <= 1 else "half" if bp == 2 else "none"
    return BloodPotencyRow(bp, surge, mend, bonus, reroll, bane, animal, human, kill)


BLOOD_POTENCY_TABLE: tuple[BloodPotencyRow, ...] = (
    _row(0, 1, 1, 0, 0, 0, 0, None), _row(1, 2, 1, 0, 1, 2, 0, None), _row(2, 2, 2, 1, 1, 2, 0, None),
    _row(3, 3, 2, 1, 2, 3, 0, None), _row(4, 3, 3, 2, 2, 3, 1, None), _row(5, 4, 3, 2, 3, 4, 1, 2),
    _row(6, 4, 3, 3, 3, 4, 2, 2), _row(7, 5, 3, 3, 4, 5, 2, 2), _row(8, 5, 4, 4, 4, 5, 2, 3),
    _row(9, 6, 4, 4, 5, 6, 2, 3), _row(10, 6, 5, 5, 5, 6, 3, 3),
)

FRENZY_HUMANITY_DIVISOR = 3
HUNGER_MAX = 5


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def blood_potency(potency: int) -> BloodPotencyRow:
    return BLOOD_POTENCY_TABLE[clamp(potency, 0, 10)]


def blood_potency_dict(potency: int) -> dict[str, object]:
    return asdict(blood_potency(potency))


def _check_die(face: int) -> None:
    if type(face) is not int or not 1 <= face <= 10:
        raise ValueError("dados de d10 vão de 1 a 10")


# --- Rouse Check -------------------------------------------------------------

def rouse_reroll_allowed(potency: int, discipline_level: int | None) -> bool:
    """A Discipline power of level up to the reroll level rolls a second die."""
    return discipline_level is not None and 1 <= discipline_level <= blood_potency(potency).rouse_reroll_level


@dataclass(frozen=True)
class RouseOutcome:
    success: bool
    hunger_before: int
    hunger_after: int
    hunger_frenzy_test: bool
    rerolled: bool


def resolve_rouse(dice: list[int], hunger: int, *, reroll_allowed: bool = False) -> RouseOutcome:
    """6+ keeps Hunger; otherwise Hunger +1. At Hunger 5 a failure flags a hunger frenzy test."""
    if not dice or len(dice) > (2 if reroll_allowed else 1):
        raise ValueError("Rouse usa um dado, ou dois com a rerrolagem da Potência")
    for face in dice:
        _check_die(face)
    if len(dice) == 2 and dice[0] >= 6:
        raise ValueError("só se rerrola um Rouse que falhou")
    hunger = clamp(hunger, 0, HUNGER_MAX)
    success = any(face >= 6 for face in dice)
    after = hunger if success else min(HUNGER_MAX, hunger + 1)
    return RouseOutcome(success, hunger, after, not success and hunger == HUNGER_MAX, len(dice) == 2)


def rouse_success_probability(potency: int, discipline_level: int | None = None) -> Fraction:
    return Fraction(3, 4) if rouse_reroll_allowed(potency, discipline_level) else Fraction(1, 2)


# --- Remorse -------------------------------------------------------------------

def remorse_pool(humanity: int, stains: int) -> int:
    return max(1, 10 - clamp(humanity, 0, 10) - clamp(stains, 0, 10))


@dataclass(frozen=True)
class RemorseOutcome:
    success: bool
    pool: int
    humanity_before: int
    humanity_after: int
    stains_before: int
    stains_after: int


def resolve_remorse(dice: list[int], humanity: int, stains: int) -> RemorseOutcome:
    humanity = clamp(humanity, 0, 10)
    stains = clamp(stains, 0, 10)
    if stains == 0:
        raise ValueError("o Teste de Remorso precisa de Manchas")
    pool = remorse_pool(humanity, stains)
    if len(dice) != pool:
        raise ValueError("a parada do Remorso é 10 - Humanidade - Manchas (mínimo 1)")
    for face in dice:
        _check_die(face)
    success = any(face >= 6 for face in dice)
    return RemorseOutcome(success, pool, humanity, humanity if success else max(0, humanity - 1), stains, 0)


def remorse_success_probability(humanity: int, stains: int) -> Fraction:
    return 1 - Fraction(1, 2) ** remorse_pool(humanity, stains)


# --- Frenzy --------------------------------------------------------------------

def count_successes(dice: list[int]) -> int:
    """V5 successes: 6+ counts one, each pair of 10s adds two more."""
    for face in dice:
        _check_die(face)
    return sum(face >= 6 for face in dice) + 2 * (dice.count(10) // 2)


def frenzy_pool(willpower_current: int, humanity: int, *, clan: str | None = None, kind: FrenzyKind = "fury", potency: int = 0) -> int:
    bane = blood_potency(potency).bane_severity if kind == "fury" and clan == "Brujah" else 0
    return clamp(max(0, willpower_current) + clamp(humanity, 0, 10) // FRENZY_HUMANITY_DIVISOR - bane, 0, 30)


@dataclass(frozen=True)
class FrenzyOutcome:
    successes: int
    success: bool
    frenzy: bool


def resolve_frenzy(dice: list[int], difficulty: int) -> FrenzyOutcome:
    if not 1 <= difficulty <= 10:
        raise ValueError("dificuldade do frenesi entre 1 e 10")
    successes = count_successes(dice)
    return FrenzyOutcome(successes, successes >= difficulty, successes < difficulty)


def frenzy_resist_probability(pool: int, difficulty: int) -> Fraction:
    """Exact chance by enumerating the d10 faces as success/ten/fail classes."""
    if not 0 <= pool <= 30 or not 1 <= difficulty <= 10:
        raise ValueError("parada de 0 a 30 e dificuldade de 1 a 10")
    from math import comb

    total = Fraction(0)
    for tens in range(pool + 1):
        for plain in range(pool - tens + 1):
            fails = pool - tens - plain
            ways = comb(pool, tens) * comb(pool - tens, plain)
            if plain + tens + 2 * (tens // 2) >= difficulty:
                total += ways * Fraction(1, 10) ** tens * Fraction(4, 10) ** plain * Fraction(5, 10) ** fails
    return total


# --- Compulsions ---------------------------------------------------------------

@dataclass(frozen=True)
class Compulsion:
    name: str
    penalty: int
    effect: str  # resumo mecânico curto, sem texto do livro


GENERAL_COMPULSIONS: tuple[Compulsion, ...] = (
    Compulsion("Fome", 2, "-2 dados até se alimentar"),
    Compulsion("Dominação", 2, "-2 dados até impor sua vontade a alguém"),
    Compulsion("Destruição", 2, "-2 dados até destruir ou ferir algo"),
    Compulsion("Paranoia", 2, "-2 dados até fugir ou se proteger da ameaça percebida"),
)

CLAN_COMPULSIONS: dict[str, Compulsion] = {
    "Banu Haqim": Compulsion("Julgamento", 2, "-2 dados até punir um transgressor"),
    "Brujah": Compulsion("Rebeldia", 2, "-2 dados até desafiar a autoridade presente"),
    "Gangrel": Compulsion("Impulsos Ferais", 2, "-2 dados em ações sociais e mentais complexas"),
    "Hecata": Compulsion("Morbidez", 2, "-2 dados até investigar a morte ou o morrer"),
    "Lasombra": Compulsion("Implacabilidade", 2, "-2 dados após uma falha, até vencer"),
    "Malkaviano": Compulsion("Delírio", 2, "-2 dados em Destreza, Manipulação, Autocontrole e Raciocínio"),
    "Ministério": Compulsion("Transgressão", 2, "-2 dados até levar alguém a quebrar uma convicção"),
    "Nosferatu": Compulsion("Criptofilia", 2, "-2 dados até descobrir um segredo"),
    "Ravnos": Compulsion("Tentar o Destino", 2, "-2 dados até correr um risco ousado"),
    "Salubri": Compulsion("Empatia Afetiva", 2, "-2 dados até aliviar a dor de alguém"),
    "Toreador": Compulsion("Obsessão", 2, "-2 dados em ações sem relação com a beleza que o prende"),
    "Tremere": Compulsion("Perfeccionismo", 2, "-2 dados até obter um sucesso crítico"),
    "Tzimisce": Compulsion("Cobiça", 2, "-2 dados até tomar posse do objeto desejado"),
    "Ventrue": Compulsion("Arrogância", 2, "-2 dados até alguém obedecer a uma ordem"),
}

CLAN_COMPULSION_LABEL = "Compulsão do clã"
COMPULSION_OPTIONS = ("Nenhuma", *(item.name for item in GENERAL_COMPULSIONS), CLAN_COMPULSION_LABEL)


def compulsion_from_die(face: int, clan: str | None) -> str | None:
    """d10 table; None means roll again (9-10 for a clan without its own compulsion)."""
    _check_die(face)
    if face <= 3:
        return "Fome"
    if face <= 5:
        return "Dominação"
    if face <= 7:
        return "Destruição"
    if face == 8:
        return "Paranoia"
    return CLAN_COMPULSION_LABEL if clan in CLAN_COMPULSIONS else None


def compulsion_probabilities(clan: str | None) -> dict[str, Fraction]:
    faces = [compulsion_from_die(face, clan) for face in range(1, 11)]
    kept = [name for name in faces if name is not None]
    return {name: Fraction(kept.count(name), len(kept)) for name in dict.fromkeys(kept)}


def describe_compulsion(value: str | None, clan: str | None) -> Compulsion | None:
    if value == CLAN_COMPULSION_LABEL:
        return CLAN_COMPULSIONS.get(clan or "")
    return next((item for item in GENERAL_COMPULSIONS if item.name == value), None)


# --- Torpor and damage ----------------------------------------------------------

TORPOR_DURATIONS: tuple[str, ...] = (
    "um milênio ou mais", "cinco séculos", "um século", "cinco décadas", "uma década", "um ano",
    "um mês", "duas semanas", "uma semana", "três dias", "um dia",
)


def torpor_duration(humanity: int) -> str:
    return TORPOR_DURATIONS[clamp(humanity, 0, 10)]


def halve_superficial(amount: int) -> int:
    """Damage a vampire keeps from physical Superficial damage: half, rounded up."""
    if amount < 0:
        raise ValueError("dano negativo")
    return (amount + 1) // 2


# --- Derived state for the Blood panel -----------------------------------------

def _int(values: dict[str, object], key: str, default: int) -> int:
    value = values.get(key, default)
    return value if type(value) is int else default


def blood_state(values: dict[str, object]) -> dict[str, object]:
    potency = clamp(_int(values, "potencia_sangue", 0), 0, 10)
    hunger = clamp(_int(values, "fome", 0), 0, HUNGER_MAX)
    humanity = clamp(_int(values, "humanidade", 7), 0, 10)
    stains = clamp(_int(values, "manchas", 0), 0, 10)
    willpower_max = clamp(_int(values, "autocontrole", 0) + _int(values, "resolucao", 0), 0, 30)
    willpower_current = max(0, willpower_max - max(0, _int(values, "vontade_superficial", 0)) - max(0, _int(values, "vontade_agravada", 0)))
    clan = values.get("cla") if isinstance(values.get("cla"), str) else None
    compulsion = values.get("compulsao_atual") if isinstance(values.get("compulsao_atual"), str) else None
    active = describe_compulsion(compulsion, clan)
    return {
        "potency": blood_potency_dict(potency),
        "hunger": hunger,
        "humanity": humanity,
        "stains": stains,
        "remorse_pool": remorse_pool(humanity, stains) if stains else 0,
        "remorse_success": float(remorse_success_probability(humanity, stains)) if stains else None,
        "willpower_current": willpower_current,
        "frenzy_pool": {kind: frenzy_pool(willpower_current, humanity, clan=clan, kind=kind, potency=potency) for kind in ("fury", "hunger", "terror")},
        "rouse_success": float(rouse_success_probability(potency)),
        "in_torpor": values.get("torpor") is True,
        "torpor_duration": torpor_duration(humanity),
        "compulsion": compulsion,
        "compulsion_detail": asdict(active) if active else None,
        "clan_compulsion": asdict(CLAN_COMPULSIONS[clan]) if clan in CLAN_COMPULSIONS else None,
    }


def enumerate_rouse(hunger: int, *, reroll_allowed: bool) -> dict[int, Fraction]:
    """Exact distribution of the Hunger after a Rouse, by enumerating every face."""
    result: dict[int, Fraction] = {}
    for first in range(1, 11):
        sequences = [[first]] if first >= 6 or not reroll_allowed else [[first, second] for second in range(1, 11)]
        weight = Fraction(1, 10) / len(sequences)
        for dice in sequences:
            after = resolve_rouse(dice, hunger, reroll_allowed=reroll_allowed).hunger_after
            result[after] = result.get(after, Fraction(0)) + weight
    return result


def enumerate_remorse(humanity: int, stains: int) -> Fraction:
    """Exact chance of keeping Humanity by enumerating every combination of faces."""
    pool = remorse_pool(humanity, stains)
    if pool > 6:
        return remorse_success_probability(humanity, stains)
    wins = sum(resolve_remorse(list(dice), humanity, stains).success for dice in product(range(1, 11), repeat=pool))
    return Fraction(wins, 10 ** pool)
