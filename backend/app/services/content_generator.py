"""Gera conteudo original de jogo com resultados reproduziveis por seed."""

from __future__ import annotations

import secrets
from random import Random
from typing import Any, Literal

from pydantic import BaseModel, Field


ContentKind = Literal["npc", "enemy", "item"]


class SystemData(BaseModel):
    name: str
    fields: dict[str, Any] = Field(default_factory=dict)


class GeneratedContent(BaseModel):
    kind: ContentKind
    name: str
    summary: str
    details: dict[str, Any]
    seed: int
    system: SystemData | None = None


_NPC_NAMES = (
    "Lia Vilar", "Tomás Neri", "Iara Campos", "Bento Salgueiro",
    "Nina Falcão", "Raul Sampaio", "Cora Valença", "Davi Moura",
)
_NPC_ROLES = (
    "arquivista de bairro", "mecânica de autômatos", "guia de vielas",
    "médica de plantão", "dona de uma casa de chá", "mensageiro fluvial",
)
_NPC_GOALS = (
    "recuperar uma carta que nunca chegou ao destino",
    "manter aberto o abrigo que administra",
    "descobrir quem compra os mapas antigos da região",
    "pagar uma dívida sem envolver a família",
    "provar que um acidente foi provocado",
)
_NPC_SECRETS = (
    "guarda uma chave que recebeu de uma pessoa desaparecida",
    "altera discretamente os registros do próprio trabalho",
    "reconheceu um dos personagens, mas finge que não",
    "negocia informações para proteger alguém próximo",
    "recebe cartas com instruções assinadas por um nome falso",
)
_NPC_MANNERISMS = (
    "anota nomes em pedaços de papel", "fala baixo quando está nervoso",
    "sempre verifica a saída mais próxima", "coleciona botões de uniformes",
    "faz pausas longas antes de responder", "assobia melodias incompletas",
)

_ENEMY_NAMES = (
    "Vigia do Cais", "Cão de Cinza", "Cobrador de Máscaras",
    "Sentinela de Vidro", "Rastejante do Poço", "Batedor da Estrada",
)
_ENEMY_ROLES = ("perseguidor", "guardião", "emboscador", "controlador")
_ENEMY_TACTICS = (
    "separa o alvo do grupo antes de atacar",
    "protege a rota de fuga e recua quando fica isolado",
    "usa o terreno para limitar o movimento dos adversários",
    "pressiona quem demonstra hesitação e evita confrontos longos",
    "faz barulho para atrair reforços antes de se aproximar",
)
_ENEMY_WEAKNESSES = (
    "luz intensa revela sua posição", "não abandona o território que recebeu ordem de guardar",
    "fica vulnerável após uma investida", "tem dificuldade para distinguir vozes conhecidas",
    "evita atravessar água corrente", "se distrai com sinais de autoridade formal",
)

_ITEM_NAMES = (
    "Lanterna de Maré", "Chave de Osso Branco", "Rádio de Bolso Rachado",
    "Manto de Fibras Azuis", "Moeda do Último Trem", "Caderno de Folhas Metálicas",
)
_ITEM_TYPES = ("ferramenta", "relíquia", "consumível", "proteção", "instrumento")
_ITEM_QUALITIES = ("comum", "incomum", "raro", "singular")
_ITEM_EFFECTS = (
    "aponta para a fonte de um som próximo quando fica em silêncio",
    "mantém seco um pequeno objeto guardado em seu interior",
    "emite um pulso breve quando alguém cruza uma passagem marcada",
    "reproduz uma frase gravada ao ser aquecido pela mão",
    "mostra marcas recentes que seriam invisíveis a olho nu",
    "pode ser desmontado para revelar um compartimento escondido",
)
_ITEM_COSTS = (
    "seu uso deixa um rastro fácil de reconhecer",
    "funciona uma vez antes de precisar de reparo",
    "atrai a atenção de quem conhece sua origem",
    "exige uma preparação curta e barulhenta",
    "o efeito também alcança quem estiver muito perto",
    "seu portador precisa cuidar de uma obrigação ligada ao objeto",
)


def generate_content(
    kind: ContentKind,
    *,
    seed: int | None = None,
    system: str | None = None,
    system_fields: dict[str, Any] | None = None,
) -> GeneratedContent:
    """Gera um NPC, inimigo ou item original e retorna a seed usada."""
    actual_seed = secrets.randbits(64) if seed is None else seed
    if isinstance(actual_seed, bool) or not isinstance(actual_seed, int) or not 0 <= actual_seed < 2**64:
        raise ValueError("seed deve ser um inteiro entre 0 e 2^64 - 1")
    rng = Random(actual_seed)
    extension = None
    if system is not None or system_fields is not None:
        extension = SystemData(
            name=(system or "Personalizado").strip() or "Personalizado",
            fields=dict(system_fields or {}),
        )

    if kind == "npc":
        name = rng.choice(_NPC_NAMES)
        role = rng.choice(_NPC_ROLES)
        goal = rng.choice(_NPC_GOALS)
        secret = rng.choice(_NPC_SECRETS)
        mannerism = rng.choice(_NPC_MANNERISMS)
        details = {
            "role": role,
            "goal": goal,
            "secret": secret,
            "mannerism": mannerism,
            "first_impression": f"{name} {mannerism} enquanto conversa sobre seu trabalho como {role}.",
            "story_hook": f"A busca para {goal} pode revelar que {secret}.",
        }
        summary = f"{name} trabalha como {role} e precisa {goal}."
    elif kind == "enemy":
        name = rng.choice(_ENEMY_NAMES)
        role = rng.choice(_ENEMY_ROLES)
        tactic = rng.choice(_ENEMY_TACTICS)
        weakness = rng.choice(_ENEMY_WEAKNESSES)
        threat = rng.randint(1, 5)
        details = {
            "role": role,
            "threat_level": threat,
            "tactic": tactic,
            "weakness": weakness,
            "combat_profile": {
                "durability": 1 + threat,
                "pressure": threat,
                "mobility": rng.randint(1, 5),
            },
            "encounter_hook": f"O grupo pode evitar o confronto se descobrir que {weakness}.",
        }
        summary = f"{name} atua como {role} e representa ameaça {threat} de 5."
    elif kind == "item":
        name = rng.choice(_ITEM_NAMES)
        item_type = rng.choice(_ITEM_TYPES)
        quality = rng.choice(_ITEM_QUALITIES)
        effect = rng.choice(_ITEM_EFFECTS)
        cost = rng.choice(_ITEM_COSTS)
        details = {
            "item_type": item_type,
            "quality": quality,
            "effect": effect,
            "cost_or_limit": cost,
            "appearance": f"Um objeto do tipo {item_type}, marcado pelo uso e de qualidade {quality}.",
            "story_hook": f"O efeito de {name.lower()} pode expor um segredo ligado ao seu custo: {cost}.",
        }
        summary = f"{name} é um item {quality} cujo efeito é que {effect}."
    else:
        raise ValueError("tipo deve ser npc, enemy ou item")

    return GeneratedContent(
        kind=kind,
        name=name,
        summary=summary,
        details=details,
        seed=actual_seed,
        system=extension,
    )
