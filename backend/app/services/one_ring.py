"""O Um Anel 2ª edição: derived values, states and checks of the v2 starter (frontend/lib/one-ring-rules.ts).

Numbers only, no book text. Every number below is marked for review against the
Core Rules (docs/UM_ANEL_FICHA.md lists them): the culture bases, TN = 20 - attribute,
the attribute total of 14 and the three favoured skills.

States, described mechanically:
- Cansado (Weary): current Endurance <= Load + Fatigue. Success dice showing 1-3 count 0.
- Miserável (Miserable): Shadow points + Shadow scars >= current Hope. An Eye of Sauron
  on the Feat die is an automatic failure, whatever the total.
- Ferido (Wounded): kept as a flag with its duration in days; no dice change. A hero who
  is Wounded again is dying, which the table resolves.
- Surto de loucura: Shadow points + scars reach maximum Hope.
"""

from __future__ import annotations

from typing import Any

ATTRIBUTES = ("corpo", "coracao", "astucia")
ATTRIBUTE_TOTAL = 14
TN_BASE = 20
SKILLS: dict[str, list[tuple[str, str]]] = {
    "corpo": [("awe", "Presença"), ("athletics", "Atletismo"), ("awareness", "Percepção"),
              ("hunting", "Caçada"), ("song", "Canção"), ("craft", "Ofício")],
    "coracao": [("enhearten", "Encorajar"), ("travel", "Viagem"), ("insight", "Intuição"),
                ("healing", "Cura"), ("courtesy", "Cortesia"), ("battle", "Batalha")],
    "astucia": [("persuade", "Persuasão"), ("stealth", "Furtividade"), ("scan", "Busca"),
                ("explore", "Exploração"), ("riddle", "Enigmas"), ("lore", "Conhecimento")],
}
SKILL_LABELS = [label for group in SKILLS.values() for _, label in group]
FAVOURED_SKILLS = 3
# Culture -> (Endurance base, Hope base, Parry base). Marked for review.
CULTURES: dict[str, tuple[int, int, int]] = {
    "Anões do Povo de Durin": (22, 8, 10),
    "Bardeses": (20, 8, 12),
    "Elfos de Lindon": (20, 8, 12),
    "Hobbits do Condado": (18, 10, 12),
    "Homens de Bri": (20, 10, 10),
    "Patrulheiros do Norte": (20, 6, 14),
}
# v1 starter ids -> v2 ids.
LEGACY_IDS = {"forca": "corpo", "espirito": "astucia"}


def _int(values: dict[str, Any], field_id: str, default: int = 0) -> int:
    value = values.get(field_id, default)
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def derived(values: dict[str, Any]) -> dict[str, int]:
    """The formula fields of the v2 starter, computed the same way the template does."""
    return {
        **{f"tn_{attribute}": TN_BASE - _int(values, attribute) for attribute in ATTRIBUTES},
        "vigor_max": _int(values, "corpo") + _int(values, "base_vigor"),
        "esperanca_max": _int(values, "coracao") + _int(values, "base_esperanca"),
        "aparar": _int(values, "astucia") + _int(values, "base_aparar") + _int(values, "bonus_escudo"),
        "carga_total": _int(values, "carga") + _int(values, "cansaco"),
        "sombra_total": _int(values, "sombra") + _int(values, "cicatrizes"),
    }


def states(values: dict[str, Any]) -> dict[str, bool]:
    numbers = derived(values)
    endurance = _int(values, "vigor_marcha")
    hope = _int(values, "esperanca")
    return {
        "cansado": endurance <= numbers["carga_total"],
        "miseravel": numbers["sombra_total"] >= hope,
        "ferido": values.get("ferido") is True,
        "surto": numbers["esperanca_max"] > 0 and numbers["sombra_total"] >= numbers["esperanca_max"],
        "inconsciente": "vigor_marcha" in values and endurance == 0,
    }


def problems(values: dict[str, Any]) -> list[str]:
    numbers = derived(values)
    found: list[str] = []
    total = sum(_int(values, attribute) for attribute in ATTRIBUTES)
    if total != ATTRIBUTE_TOTAL:
        found.append(f"Corpo, Coração e Astúcia somam {total}; a criação pede {ATTRIBUTE_TOTAL}")
    culture = values.get("linhagem")
    if isinstance(culture, str) and culture in CULTURES:
        bases = dict(zip(("base_vigor", "base_esperanca", "base_aparar"), CULTURES[culture]))
        for field_id, expected in bases.items():
            if _int(values, field_id) != expected:
                found.append(f"{field_id} deve ser {expected} para {culture}")
    if _int(values, "vigor_marcha") > numbers["vigor_max"]:
        found.append(f"Vigor atual passa do máximo {numbers['vigor_max']}")
    if _int(values, "esperanca") > numbers["esperanca_max"]:
        found.append(f"Esperança atual passa do máximo {numbers['esperanca_max']}")
    favoured = values.get("pericias_favorecidas", [])
    if isinstance(favoured, list):
        if len(favoured) > FAVOURED_SKILLS:
            found.append(f"Até {FAVOURED_SKILLS} perícias favorecidas")
        unknown = [item for item in favoured if item not in SKILL_LABELS]
        if unknown:
            found.append(f"Perícia favorecida desconhecida: {unknown[0]}")
    if values.get("ferido") is not True and _int(values, "ferimento_dias") > 0:
        found.append("Dias de ferimento sem a marca Ferido")
    return found


def migrate_one_ring(values: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """v1 values (Força/Espírito, six skills) to the v2 ids; Corpo/Astúcia keep the old numbers."""
    result = {LEGACY_IDS.get(key, key): value for key, value in values.items()}
    warnings = [f"{old} passou a {new}" for old, new in LEGACY_IDS.items() if old in values]
    culture = result.get("linhagem")
    if isinstance(culture, str) and culture in CULTURES:
        result.update(zip(("base_vigor", "base_esperanca", "base_aparar"), CULTURES[culture]))
    else:
        warnings.append("Escolha a cultura para calcular Vigor, Esperança e Aparar")
    return result, warnings
