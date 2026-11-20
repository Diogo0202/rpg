"""Blocos de combate genericos por sistema, escalados por dificuldade (GER-05).

Os numeros sao originais e servem de ponto de partida para a mesa. Nenhum texto
ou tabela de livro e reproduzido: cada bloco traz ``needs_book_check`` e uma nota
pedindo para conferir os valores no livro do sistema antes de usar.

O resultado e deterministico: a mesma seed, sistema e dificuldade sempre geram o
mesmo bloco. A variacao aleatoria depende apenas de (sistema, seed), entao para
uma seed fixa cada dificuldade mais alta nunca fica abaixo da anterior.
"""

from __future__ import annotations

import hashlib
from random import Random
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator


CombatSystem = Literal["v5", "v3", "hunter", "one_ring", "sotdl"]
CombatTier = Literal["fraco", "padrao", "perigoso", "chefe"]

COMBAT_SYSTEMS: tuple[CombatSystem, ...] = ("v5", "v3", "hunter", "one_ring", "sotdl")
COMBAT_TIERS: tuple[CombatTier, ...] = ("fraco", "padrao", "perigoso", "chefe")
SYSTEM_LABELS: dict[str, str] = {
    "v5": "Vampiro: A Máscara 5ª edição",
    "v3": "Vampiro: A Máscara 3ª edição",
    "hunter": "Caçador: A Revanche",
    "one_ring": "O Um Anel",
    "sotdl": "Shadow of the Demon Lord",
}
TIER_LABELS: dict[str, str] = {"fraco": "Fraco", "padrao": "Padrão", "perigoso": "Perigoso", "chefe": "Chefe"}
BOOK_CHECK_NOTE = "Estatísticas genéricas e originais para a mesa: conferir no livro do sistema antes de usar."
MAX_INITIATIVE = 1000
MAX_HEALTH = 1000

StatValue = StrictInt | StrictStr | StrictBool


class CombatBlock(BaseModel):
    """Bloco validado; ``initiative`` e ``health`` alimentam o participante da cena."""

    model_config = ConfigDict(extra="forbid")

    system: CombatSystem
    system_label: StrictStr
    tier: CombatTier
    tier_label: StrictStr
    seed: StrictInt = Field(ge=0, lt=2**64)
    initiative: StrictInt = Field(ge=0, le=MAX_INITIATIVE)
    initiative_rule: StrictStr = Field(min_length=1, max_length=200)
    health: StrictInt = Field(ge=1, le=MAX_HEALTH)
    health_label: StrictStr = Field(min_length=1, max_length=60)
    defense: StrictInt = Field(ge=0, le=100)
    defense_label: StrictStr = Field(min_length=1, max_length=60)
    attack: StrictStr = Field(min_length=1, max_length=120)
    damage: StrictStr = Field(min_length=1, max_length=120)
    stats: dict[StrictStr, StatValue] = Field(max_length=20)
    abilities: list[StrictStr] = Field(max_length=6)
    needs_book_check: StrictBool = True
    review_note: StrictStr = BOOK_CHECK_NOTE

    @model_validator(mode="after")
    def keep_review_flag(self) -> "CombatBlock":
        if not self.needs_book_check or "conferir no livro" not in self.review_note:
            raise ValueError("bloco de combate precisa manter o aviso de conferir no livro")
        return self


_ABILITIES = {
    "fraco": ("Recua quando perde metade da saúde.", "Chama ajuda em vez de lutar até o fim."),
    "padrao": ("Coordena um ataque com um aliado por cena.", "Usa cobertura sempre que possível."),
    "perigoso": ("Ignora a primeira penalidade por ferimento da cena.", "Pressiona o alvo mais ferido."),
    "chefe": ("Age duas vezes na primeira rodada.", "Tem uma rota de fuga preparada.", "Comanda subordinados próximos."),
}


def _rng(system: str, seed: int) -> Random:
    return Random(f"combat-block:{system}:{seed}")


def build_combat_block(system: CombatSystem, tier: CombatTier, seed: int) -> CombatBlock:
    """Gera o bloco de combate do sistema e da dificuldade pedidos."""
    if system not in COMBAT_SYSTEMS:
        raise ValueError("sistema de combate desconhecido")
    if tier not in COMBAT_TIERS:
        raise ValueError("dificuldade deve ser fraco, padrao, perigoso ou chefe")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**64:
        raise ValueError("seed deve ser um inteiro entre 0 e 2^64 - 1")
    t = COMBAT_TIERS.index(tier)
    rng = _rng(system, seed)
    j = [rng.randint(0, 1) for _ in range(6)]
    data: dict[str, Any]
    if system == "v5":
        attack = (3, 5, 7, 9)[t] + j[0]
        data = {
            "initiative": (3, 5, 6, 8)[t] + j[1],
            "initiative_rule": "Ordem por Destreza + Prontidão; conferir no livro.",
            "health": (4, 6, 8, 11)[t] + j[2], "health_label": "Vitalidade",
            "defense": max(1, attack - 1 - j[3]), "defense_label": "Parada de esquiva",
            "attack": f"Parada {attack} (d10, dificuldade da cena)",
            "damage": f"+{(1, 2, 3, 4)[t]} superficial; agravado conforme a arma",
            "stats": {"parada_ataque": attack, "força_de_vontade": (2, 4, 5, 7)[t] + j[4], "parada_social": (2, 3, 5, 6)[t] + j[5]},
        }
    elif system == "v3":
        attack = (4, 6, 8, 10)[t] + j[0]
        base = (4, 6, 7, 9)[t] + j[1]
        data = {
            "initiative": base + rng.randint(1, 10),
            "initiative_rule": f"Destreza + Raciocínio ({base}) + 1d10 já rolado pela seed.",
            "health": (7, 7, 8, 10)[t], "health_label": "Níveis de vitalidade",
            "defense": (2, 3, 4, 6)[t] + j[2], "defense_label": "Absorção",
            "attack": f"Parada {attack} (dificuldade 6)",
            "damage": f"{(3, 4, 6, 8)[t] + j[3]} dados de dano (dificuldade 6)",
            "stats": {"parada_ataque": attack, "força_de_vontade": (3, 5, 6, 8)[t] + j[4], "esquiva": (1, 2, 3, 4)[t] + j[5]},
        }
    elif system == "hunter":
        attack = (3, 4, 6, 8)[t] + j[0]
        data = {
            "initiative": (3, 4, 6, 7)[t] + j[1],
            "initiative_rule": "Ordem por Destreza + Prontidão; conferir no livro.",
            "health": (4, 5, 7, 10)[t] + j[2], "health_label": "Vitalidade",
            "defense": (2, 3, 5, 6)[t] + j[3], "defense_label": "Parada de defesa",
            "attack": f"Parada {attack} (d10)",
            "damage": f"+{(1, 2, 3, 4)[t]} de dano da arma",
            "stats": {"parada_ataque": attack, "força_de_vontade": (2, 3, 5, 6)[t] + j[4], "ameaça": (1, 2, 3, 4)[t]},
        }
    elif system == "one_ring":
        level = (2, 4, 5, 7)[t] + j[0]
        data = {
            "initiative": level,
            "initiative_rule": "O Um Anel usa posturas; o nível de atributo só ordena a cena.",
            "health": (8, 16, 28, 48)[t] + 2 * j[1], "health_label": "Resistência",
            "defense": (0, 1, 2, 4)[t] + j[2], "defense_label": "Aparo",
            "attack": f"Nível de atributo {level} (d12 + dados de sucesso)",
            "damage": f"Dano {(2, 4, 5, 7)[t] + j[3]}; ferimento NA {(12, 14, 16, 18)[t]}",
            "stats": {"nível_atributo": level, "poder": (1, 1, 2, 3)[t], "ódio_ou_determinação": (1, 3, 5, 8)[t] + j[4], "armadura_dados": (1, 2, 3, 4)[t]},
        }
    else:  # sotdl
        speed = (10, 10, 12, 14)[t] + j[0]
        dice = (1, 2, 4, 6)[t] + j[1]
        data = {
            "initiative": speed,
            "initiative_rule": "Turno rápido ou lento; o valor (Deslocamento) só ordena a cena.",
            "health": (10, 25, 50, 100)[t] + 3 * j[2], "health_label": "Vida",
            "defense": (11, 13, 15, 18)[t] + j[3], "defense_label": "Defesa",
            "attack": f"Ataque +{(1, 2, 3, 4)[t]} com {(0, 1, 1, 2)[t]} dádiva(s)",
            "damage": f"{dice}d6",
            "stats": {"dificuldade": (5, 25, 50, 100)[t], "percepção": (9, 10, 12, 14)[t] + j[4], "força": (10, 11, 13, 15)[t] + j[5], "deslocamento": speed},
        }
    return CombatBlock(
        system=system, system_label=SYSTEM_LABELS[system], tier=tier, tier_label=TIER_LABELS[tier],
        seed=seed, abilities=list(_ABILITIES[tier]), **data,
    )


def second_inquisition_tier(level: int) -> CombatTier:
    """Nivel de alerta da SI convertido para a dificuldade do bloco."""
    if level <= 1:
        return "fraco"
    return ("padrao", "perigoso", "chefe")[min(level, 4) - 2]


def deterministic_seed(*parts: str) -> int:
    """Seed estavel derivada de identificadores (para respostas da SI)."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def second_inquisition_block(stats: dict[str, Any], level: int, seed: int) -> CombatBlock:
    """Bloco V5 da equipe de contencao usando os numeros que o painel da SI mostrou."""
    block = build_combat_block("v5", second_inquisition_tier(level), seed)
    pool = stats.get("combat_pool")
    health = stats.get("health")
    armor = stats.get("armor")
    if not all(type(value) is int for value in (pool, health, armor)):
        raise ValueError("resposta da SI sem estatísticas de combate válidas")
    team = stats.get("team_size") if type(stats.get("team_size")) is int else 1
    return block.model_copy(update={
        "health": max(1, min(MAX_HEALTH, health)),
        "attack": f"Parada {pool} (d10, dificuldade da cena)",
        "defense": max(0, min(100, armor)),
        "defense_label": "Proteção",
        "stats": {**block.stats, "parada_ataque": pool, "agentes": team},
    })
