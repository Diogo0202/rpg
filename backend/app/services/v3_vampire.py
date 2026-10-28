"""Vampiro: A Máscara Revisado (V3): dice, health levels, blood by generation and sheet migration.

Pure rules only (numbers and short mechanical names, no book text). Every number here is marked for
checking in the book and mirrored in frontend/lib/v3-rules.ts and in the v3_* functions of
supabase/migrations/20261029120000_vampire_v3_complete.sql:

- Pool of d10 against a difficulty from 2 to 10; each die at or above it is a success.
- Each 1 cancels one success. A botch is a roll with no success at all and at least one 1.
- Specialization: a 10 counts as two successes (conferir: o Revisado rerrola o 10).
- Willpower adds one automatic success that 1s do not cancel, so the roll cannot botch.
- Health levels: the n-th marked level gives its penalty to the pool (Escoriado 0 ... Aleijado -5);
  Incapacitado cannot act.
- Blood pool and blood per turn follow the generation (13th 10/1 ... 8th 15/3, 7th 20/4 ...).
- Vampires halve bashing damage, rounding down (conferir).
"""

from __future__ import annotations

import secrets
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt

from app.services.session_roll_activity import RollChronicleContext

HEALTH_LEVELS: list[tuple[str, int | None]] = [
    ("Escoriado", 0), ("Machucado", -1), ("Ferido", -1), ("Ferido Gravemente", -2),
    ("Espancado", -2), ("Aleijado", -5), ("Incapacitado", None),
]

BLOOD_BY_GENERATION: dict[int, tuple[int, int]] = {
    13: (10, 1), 12: (11, 1), 11: (12, 1), 10: (13, 1), 9: (14, 2), 8: (15, 3),
    7: (20, 4), 6: (30, 6), 5: (40, 8), 4: (50, 10),
}

# Paths and the two virtues each uses besides Coragem (same list as frontend/lib/v3-creation-data.ts).
PATH_VIRTUES: dict[str, tuple[str, str]] = {
    "Humanidade": ("consciencia", "autocontrole"),
    "Trilha de Caim": ("conviccao", "instintos"),
    "Trilha da Catarse": ("conviccao", "instintos"),
    "Trilha da Besta": ("conviccao", "instintos"),
    "Trilha da Noite": ("conviccao", "instintos"),
    "Trilha da Morte e da Alma": ("conviccao", "autocontrole"),
    "Trilha da Harmonia": ("consciencia", "instintos"),
    "Trilha do Poder e da Voz Interior": ("conviccao", "instintos"),
    "Trilha das Revelações Malignas": ("conviccao", "instintos"),
    "Trilha da Metamorfose": ("conviccao", "instintos"),
    "Trilha dos Ossos": ("conviccao", "autocontrole"),
    "Trilha de Lilith": ("conviccao", "instintos"),
    "Trilha de Tifão": ("conviccao", "autocontrole"),
    "Trilha do Paradoxo": ("conviccao", "autocontrole"),
    "Trilha do Sangue": ("conviccao", "autocontrole"),
    "Trilha do Acordo Honrado": ("consciencia", "autocontrole"),
    "Trilha do Céu": ("consciencia", "autocontrole"),
    "Trilha dos Reis": ("conviccao", "autocontrole"),
}


def health_penalty(marked: int) -> int | None:
    """Penalty for `marked` damage levels (0 to 7); None when Incapacitado."""
    if marked <= 0:
        return 0
    return HEALTH_LEVELS[min(marked, 7) - 1][1]


def blood_for_generation(generation: int) -> tuple[int, int]:
    """(blood pool, blood per turn); generations past the table keep the 13th's numbers."""
    if generation in BLOOD_BY_GENERATION:
        return BLOOD_BY_GENERATION[generation]
    return BLOOD_BY_GENERATION[13] if generation > 13 else BLOOD_BY_GENERATION[4]


def path_virtues(values: dict[str, Any]) -> tuple[str, str]:
    path = values.get("trilha")
    return PATH_VIRTUES.get(path, PATH_VIRTUES["Humanidade"]) if isinstance(path, str) else PATH_VIRTUES["Humanidade"]


class V3Outcome(BaseModel):
    dice: list[int]
    difficulty: int
    raw_successes: int
    ones: int
    willpower: bool
    specialty: bool
    successes: int
    botch: bool
    success: bool
    verdict: str


def v3_outcome(dice: list[int], difficulty: int, *, specialty: bool = False, willpower: bool = False) -> V3Outcome:
    """Reads a rolled V3 pool; pure so the dice rules can be enumerated in tests."""
    raw = sum(2 if specialty and die == 10 else 1 for die in dice if die >= difficulty)
    ones = dice.count(1)
    botch = raw == 0 and ones > 0 and not willpower
    successes = max(0, raw - ones) + (1 if willpower else 0)
    verdict = "Falha crítica" if botch else "Sucesso" if successes else "Falha"
    return V3Outcome(dice=dice, difficulty=difficulty, raw_successes=raw, ones=ones, willpower=willpower,
                     specialty=specialty, successes=successes, botch=botch, success=successes > 0, verdict=verdict)


def roll_dice(count: int) -> list[int]:
    return [secrets.randbelow(10) + 1 for _ in range(count)]


class V3RollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pool: StrictInt = Field(ge=1, le=30)
    difficulty: StrictInt = Field(ge=2, le=10)
    specialty: StrictBool = False
    use_willpower: StrictBool = False
    # Marked health levels (0..7); the level's penalty leaves the pool, Incapacitado refuses the roll.
    damage_levels: StrictInt = Field(default=0, ge=0, le=7)
    # With use_willpower the API spends 1 Willpower on this sheet through v3_spend_willpower first.
    sheet_id: str | None = Field(default=None, min_length=36, max_length=36)
    operation_id: str | None = Field(default=None, min_length=36, max_length=36)
    chronicle: RollChronicleContext | None = None


class V3RollResponse(V3Outcome):
    pool: int
    penalty: int
    rolled: int
    willpower_spent: bool = False


def roll_v3(payload: V3RollRequest) -> V3RollResponse:
    penalty = health_penalty(payload.damage_levels)
    if penalty is None:
        raise ValueError("Incapacitado não pode agir")
    rolled = max(0, payload.pool + penalty)
    outcome = v3_outcome(roll_dice(rolled), payload.difficulty, specialty=payload.specialty, willpower=payload.use_willpower)
    return V3RollResponse(**outcome.model_dump(), pool=payload.pool, penalty=penalty, rolled=rolled)


class V3SheetResponse(BaseModel):
    values: dict[str, Any]
    derived: dict[str, Any]
    warnings: list[str]


def migrate_v3_values(values: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Sheets of the first V3 starter: the house predator type moves to Notas, new fields get defaults."""
    result = dict(values)
    warnings: list[str] = []
    predator = result.pop("predador", None)
    if isinstance(predator, str) and predator.strip():
        note = f"Tipo de predador (ficha antiga, regra da casa): {predator.strip()}"
        notes = result.get("notas") if isinstance(result.get("notas"), str) else ""
        result["notas"] = f"{notes}\n{note}".strip() if notes else note
        warnings.append("Tipo de predador não existe no V3; o valor foi guardado em Notas")
    defaults: dict[str, Any] = {"trilha": "Humanidade", "conviccao": 1, "instintos": 1, "dano_contundente": 0, "dano_letal": 0,
                                "dano_agravado": 0, "especialidades": [], "meritos": [], "defeitos": [],
                                "em_frenesi": False, "em_rotschreck": False}
    for key, value in defaults.items():
        if key not in result:
            result[key] = value
    return result, warnings


def _int(values: dict[str, Any], key: str, default: int = 0) -> int:
    value = values.get(key, default)
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def v3_derived(values: dict[str, Any]) -> dict[str, Any]:
    generation = 13 - _int(values, "ant_geracao")
    blood_max, per_turn = blood_for_generation(generation)
    marked = min(7, _int(values, "dano_contundente") + _int(values, "dano_letal") + _int(values, "dano_agravado"))
    first, second = path_virtues(values)
    penalty = health_penalty(marked)
    return {
        "geracao": generation, "sangue_max": blood_max, "sangue_por_turno": per_turn,
        "vitalidade_dano": marked, "nivel_vitalidade": HEALTH_LEVELS[marked - 1][0] if marked else "Sem ferimentos",
        "penalidade": penalty, "incapacitado": penalty is None,
        "virtude_consciencia": first, "virtude_autocontrole": second,
    }


def v3_sheet(values: dict[str, Any], migrate: bool) -> V3SheetResponse:
    migrated, warnings = migrate_v3_values(values) if migrate else (dict(values), [])
    return V3SheetResponse(values=migrated, derived=v3_derived(migrated), warnings=warnings)
