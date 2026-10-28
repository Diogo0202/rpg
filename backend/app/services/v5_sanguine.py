"""Vampiro V5, ficha complementar e SAN (frente F2).

Espelha frontend/lib/v5-sanguine.ts e a migration 20261029110000_v5_feeding_bonds.sql.
Só nomes e mecânica resumida; o que vem do livro está marcado para conferência
(lista em SANGUINE_REVIEW_RULES): Disciplinas por Ressonância, bônus por intensidade,
Severidade da Perdição, Fome mínima sem matar e o decaimento do Vínculo.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Iterable

from app.services.v5_blood import blood_potency

SANGUINE_REVIEW_RULES = (
    "Até três pares de Convicção e Pedra de Toque; até cinco Princípios da Crônica.",
    "Nome e efeito resumido da Perdição de cada clã (Caitiff e Sangue-Ralo sem Perdição).",
    "Disciplinas de cada Ressonância (Vazia → Oblívio) e +1 dado para Intensa e Aguda; Fugaz sem bônus.",
    "Discrasia só com Ressonância Aguda.",
    "Fome mínima 1 sem matar a presa (ou o limite da Potência alta, tabela de F1).",
    "Vínculo: um grau por noite distinta, máximo 3; perde um grau a cada 30 dias sem beber (configurável).",
    "Teste de resistência para agir contra o Regente: parada e dificuldade escolhidas pela mesa.",
)

PAIRS = 3
LIMITS = {"conviccao": 160, "pedra_toque": 120, "principio": 160, "discrasia": 160}
TENETS_MAX = 5

RESONANCES = ("Nenhuma", "Colérica", "Melancólica", "Fleumática", "Sanguínea", "Animal", "Vazia")
INTENSITIES = ("Nenhuma", "Fugaz", "Intensa", "Aguda")
RESONANCE_DISCIPLINES: dict[str, tuple[str, ...]] = {
    "Nenhuma": (),
    "Colérica": ("disc_potencia", "disc_rapidez"),
    "Melancólica": ("disc_fortitude", "disc_ofuscacao"),
    "Fleumática": ("disc_auspicios", "disc_dominacao"),
    "Sanguínea": ("disc_feiticaria", "disc_presenca"),
    "Animal": ("disc_animalismo", "disc_metamorfose"),
    "Vazia": ("disc_oblivio",),
}
RESONANCE_BONUS = {"Nenhuma": 0, "Fugaz": 0, "Intensa": 1, "Aguda": 1}

CLAN_BANES: dict[str, str] = {
    "Banu Haqim": "Sede de Sangue Cainita", "Brujah": "Fúria Latente", "Gangrel": "Feições Bestiais",
    "Hecata": "Beijo Doloroso", "Lasombra": "Distorção", "Malkaviano": "Fratura", "Ministério": "Abominação à Luz",
    "Nosferatu": "Repulsivos", "Ravnos": "Condenação do Sol", "Salubri": "Sangue Cobiçado", "Toreador": "Estética",
    "Tremere": "Vínculo Enfraquecido", "Tzimisce": "Apego à Terra", "Ventrue": "Paladar Refinado",
}


def bane_severity(potency: Any) -> int:
    """Severidade da Perdição pela tabela de Potência de F1 (app.services.v5_blood)."""
    if type(potency) is not int or potency <= 0:
        return 0
    return blood_potency(potency).bane_severity


def hunt_floor(potency: Any, killed: bool) -> int:
    """Menor Fome que a caçada alcança: 0 matando; sem matar, 1 ou o limite da Potência alta (F1)."""
    if killed:
        return 0
    kill_below = blood_potency(potency).kill_to_reduce_below if type(potency) is int else None
    return max(1, kill_below or 1)


def hunger_after_hunt(hunger: int, slake: int, killed: bool, potency: int = 0) -> int:
    """A caçada nunca sobe a Fome; abaixo do piso só matando a presa."""
    return min(hunger, max(hunger - slake, hunt_floor(potency, killed)))


def resonance_effect(resonance: str, intensity: str, prey: str) -> dict[str, Any] | None:
    """O efeito (sem id) que record_v5_hunt grava; None quando não há bônus."""
    if resonance not in RESONANCES or intensity not in INTENSITIES:
        raise ValueError("Ressonância ou intensidade desconhecida")
    delta = RESONANCE_BONUS[intensity]
    tags = list(RESONANCE_DISCIPLINES[resonance])
    if not delta or not tags:
        return None
    return {
        "label": f"Ressonância {resonance} ({intensity})", "delta": delta, "enabled": True,
        "applies_to_tags": tags, "exempt_tags": [], "remaining_scenes": None,
        "source_note": f"Caçada V5 ({prey.strip()[:80]}); bônus de Ressonância a conferir no livro",
    }


def _as_datetime(value: datetime | str) -> datetime:
    moment = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def bond_degree(drinks: Iterable[datetime | str], decay_days: int, at: datetime | None = None) -> int:
    """Grau do Vínculo (0 a 3); mesma regra de private.v5_bond_degree_from.

    Cada noite UTC distinta com ingestão sobe um nível até 3; a cada `decay_days` dias sem beber,
    o grau perde um nível (também entre uma ingestão e a seguinte).
    """
    if type(decay_days) is not int or decay_days < 1:
        raise ValueError("o decaimento precisa ser de ao menos um dia")
    now = _as_datetime(at or datetime.now(timezone.utc))
    period = decay_days * 86400
    level = 0
    last: datetime | None = None
    for moment in sorted(item for item in map(_as_datetime, drinks) if item <= now):
        if last is not None:
            level = max(0, level - math.floor((moment - last).total_seconds() / period))
        if last is None or moment.astimezone(timezone.utc).date() != last.astimezone(timezone.utc).date():
            level = min(3, level + 1)
        last = moment
    if last is not None:
        level = max(0, level - math.floor((now - last).total_seconds() / period))
    return level


def _filled(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def v5_trait_problems(values: dict[str, Any]) -> list[str]:
    """O que impede os campos novos de passarem; vazio quando coerentes. Mesma saída do frontend."""
    problems: list[str] = []
    for n in range(1, PAIRS + 1):
        if _filled(values.get(f"conviccao_{n}")) != _filled(values.get(f"pedra_toque_{n}")):
            problems.append(f"Par {n}: preencha Convicção e Pedra de Toque juntas")
    bane = values.get("perdicao")
    if isinstance(bane, str) and bane and CLAN_BANES.get(values.get("cla")) != bane:
        problems.append("A Perdição não é a do clã escolhido")
    resonance, intensity = values.get("ressonancia_atual"), values.get("intensidade_ressonancia")
    if isinstance(resonance, str) and isinstance(intensity, str) and (resonance == "Nenhuma") != (intensity == "Nenhuma"):
        problems.append("Ressonância e intensidade andam juntas")
    if _filled(values.get("discrasia")) and intensity != "Aguda":
        problems.append("Discrasia só com Ressonância aguda")
    tenets = values.get("principios_cronica")
    if isinstance(tenets, list) and len(tenets) > TENETS_MAX:
        problems.append(f"Até {TENETS_MAX} Princípios da Crônica")
    return problems
