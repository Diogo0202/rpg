"""Caçador: A Revanche, structured traits of the v3 starter (frontend/lib/hunter-traits.ts).

Credo and Ímpeto are closed lists; Pedras de Toque and Convicções are up to three
pairs of short texts; Redenção is a short free text and Desespero (state) a checkbox.
Only names and limits live here, never rules text. The pair count (1 to 3) is marked
for review against the book (docs/CACADOR_CRIACAO_GUIADA.md).

`migrate_hunter_traits` converts sheets made with the v1/v2 starters, where Pilares
was a free list and Ímpeto/Credo could be free text, into the v3 field ids.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

HUNTER_CREEDS = ["Empreendedor", "Devoto", "Inquisitivo", "Marcial", "Clandestino"]
HUNTER_DRIVES = ["Curiosidade", "Expiação", "Ganância", "Inveja", "Juramento", "Orgulho", "Vingança"]
HUNTER_PAIRS = 3
LIMITS = {"conviccao": 160, "pedra_toque": 120, "redencao": 240, "celula": 120, "notas": 10_000}
TRAIT_FIELDS = [f"{prefix}_{index}" for index in range(1, HUNTER_PAIRS + 1) for prefix in ("conviccao", "pedra_toque")]
# "Pedra de Toque: Convicção", "Pedra de Toque — Convicção", "Pedra -> Convicção" and so on.
_SEPARATOR = re.compile(r"\s*(?::|—|–|->|=>|\|)\s*")
_PARENTHESIS = re.compile(r"^(?P<conviction>.+?)\s*\((?P<touchstone>[^()]+)\)\s*$")


def _key(value: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFD", value.casefold()) if unicodedata.category(char) != "Mn").strip()


def _closed(value: Any, options: list[str]) -> str | None:
    if not isinstance(value, str):
        return None
    return next((option for option in options if _key(option) == _key(value)), None)


def _clip(text: str, limit: int, label: str, warnings: list[str]) -> str:
    text = text.strip()
    if len(text) > limit:
        warnings.append(f"{label} foi cortado em {limit} caracteres; o texto completo foi para Notas")
        return text[:limit].rstrip()
    return text


def split_pillar(item: str) -> tuple[str, str]:
    """(pedra de toque, convicção) of a legacy Pilares item; a lone text is a conviction without touchstone."""
    match = _PARENTHESIS.match(item)
    if match:
        return match["touchstone"].strip(), match["conviction"].strip()
    parts = _SEPARATOR.split(item.strip(), maxsplit=1)
    return (parts[0], parts[1]) if len(parts) == 2 and parts[0] and parts[1] else ("", item.strip())


def migrate_hunter_traits(values: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Returns v3 values and the warnings a person should read before creating the new sheet."""
    result = {key: value for key, value in values.items() if key != "pilares"}
    warnings: list[str] = []
    notes: list[str] = []
    for field_id, options, label in (("credo", HUNTER_CREEDS, "Credo"), ("impulso", HUNTER_DRIVES, "Ímpeto")):
        raw = values.get(field_id)
        matched = _closed(raw, options)
        if matched:
            result[field_id] = matched
        elif isinstance(raw, str) and raw.strip():
            result.pop(field_id, None)
            notes.append(f"{label} anterior: {raw.strip()}")
            warnings.append(f"{label} “{raw.strip()}” não está na lista; escolha uma opção")
    pillars = [item for item in values.get("pilares", []) if isinstance(item, str) and item.strip()] \
        if isinstance(values.get("pilares"), list) else []
    for index, item in enumerate(pillars[:HUNTER_PAIRS], start=1):
        touchstone, conviction = split_pillar(item)
        result[f"conviccao_{index}"] = _clip(conviction, LIMITS["conviccao"], f"Convicção {index}", warnings)
        result[f"pedra_toque_{index}"] = _clip(touchstone, LIMITS["pedra_toque"], f"Pedra de Toque {index}", warnings)
        if len(conviction) > LIMITS["conviccao"] or len(touchstone) > LIMITS["pedra_toque"]:
            notes.append(f"Pilar {index}: {item}")
        if not touchstone:
            warnings.append(f"Convicção {index} ficou sem Pedra de Toque")
    for item in pillars[HUNTER_PAIRS:]:
        notes.append(f"Pilar excedente: {item}")
    if len(pillars) > HUNTER_PAIRS:
        warnings.append(f"{len(pillars) - HUNTER_PAIRS} pilar(es) além de {HUNTER_PAIRS} foram para Notas")
    if not pillars:
        warnings.append("Informe ao menos uma Convicção com sua Pedra de Toque")
    for field_id, label in (("redencao", "Redenção"), ("celula", "Célula")):
        raw = values.get(field_id)
        if isinstance(raw, str):
            if len(raw.strip()) > LIMITS[field_id]:
                notes.append(f"{label} completa: {raw.strip()}")
            result[field_id] = _clip(raw, LIMITS[field_id], label, warnings)
    if notes:
        previous = values.get("notas") if isinstance(values.get("notas"), str) else ""
        result["notas"] = "\n".join(part for part in [previous.strip(), *notes] if part)[:LIMITS["notas"]]
    return result, list(dict.fromkeys(warnings))


def hunter_trait_problems(values: dict[str, Any]) -> list[str]:
    """What still keeps a v3 sheet from passing; empty when the traits are complete."""
    problems: list[str] = []
    if values.get("credo") not in HUNTER_CREEDS:
        problems.append("Escolha um Credo da lista")
    if values.get("impulso") not in HUNTER_DRIVES:
        problems.append("Escolha um Ímpeto da lista")
    pairs = 0
    for index in range(1, HUNTER_PAIRS + 1):
        conviction = values.get(f"conviccao_{index}")
        touchstone = values.get(f"pedra_toque_{index}")
        filled = [isinstance(item, str) and bool(item.strip()) for item in (conviction, touchstone)]
        if any(filled) and not all(filled):
            problems.append(f"Par {index}: preencha Convicção e Pedra de Toque juntas")
        pairs += all(filled)
        for item, limit, label in ((conviction, LIMITS["conviccao"], "Convicção"), (touchstone, LIMITS["pedra_toque"], "Pedra de Toque")):
            if isinstance(item, str) and len(item) > limit:
                problems.append(f"{label} {index} passa de {limit} caracteres")
    if pairs == 0:
        problems.append("Informe ao menos uma Convicção com sua Pedra de Toque")
    redemption = values.get("redencao")
    if isinstance(redemption, str) and len(redemption) > LIMITS["redencao"]:
        problems.append(f"Redenção passa de {LIMITS['redencao']} caracteres")
    # v1-v3 sheets kept the cell's Desperation in `desespero`; F4 moves it to hunter_cells.
    desperation = values.get("desespero", 0)
    if isinstance(desperation, bool) or not isinstance(desperation, int) or not 0 <= desperation <= 5:
        problems.append("Desesperação (campo antigo da ficha) vai de 0 a 5")
    if not isinstance(values.get("em_desespero", False), bool):
        problems.append("Em Desespero precisa ser marcado ou desmarcado")
    problems.extend(hunter_edge_problems(values))
    return problems


# --- F4: Triunfos (Edges) e Distinções (Perks) ---------------------------------------------
# Mechanical names only, no rules text. The Portuguese names and the Perks of each Edge are
# provisional and marked for review against the book (docs/CACADOR_CRIACAO_GUIADA.md, F4).
# Same lists in frontend/lib/hunter-traits.ts.
HUNTER_EDGES: dict[str, list[str]] = {
    "Arsenal": ["Requisição de Equipe", "Especializado", "Excepcional", "Irrastreável"],
    "Frota": ["Blindagem", "Desempenho", "Vigilância", "Irrastreável"],
    "Artilharia": ["Cargas Múltiplas", "Entrega Não Convencional", "Entrega Disfarçada", "Preparo de Carga"],
    "Biblioteca": ["Onde se Escondem", "Onde São Fracos", "Quem São", "Pesquisa Rápida"],
    "Equipamento Improvisado": ["Frugal", "Fabricação Rápida", "Produção em Massa", "Especializado"],
    "Acesso Global": ["Porta dos Fundos", "Lista de Vigilância", "Catraca", "Acesso Total"],
    "Piloto de Drone": ["Drone Armado", "Drone Autônomo", "Vigilância", "Carga Útil"],
    "Encantador de Feras": ["Mensageiro", "Matilha", "Incorruptível", "Elo Telepático"],
    "Vira-Casaca": ["Agente Duplo", "Lábia", "Conhecimento Interno", "Disfarce Persistente"],
    "Sentir o Sobrenatural": ["Precisão", "Alcance", "Reconhecer", "Sentido Ampliado"],
    "Repelir o Sobrenatural": ["Barreira", "Dano", "Reação Rápida", "Recuo"],
    "Frustrar o Sobrenatural": ["Rastreio", "Resistência", "Proteção de Grupo", "Contrafeitiço"],
    "Artefato": ["Fortalecer", "Detecção", "Dano", "Escudo"],
    "Purificar o Sobrenatural": ["Purificação em Grupo", "Ritual", "Expulsão", "Santuário"],
}
HUNTER_PERKS = [f"{edge}: {perk}" for edge, perks in HUNTER_EDGES.items() for perk in perks]
# At creation: two Edges and one Perk, or one Edge and two Perks (marked for review).
HUNTER_EDGE_STARTS: list[tuple[int, int]] = [(2, 1), (1, 2)]
EDGE_FIELD, PERK_FIELD = "triunfos", "distincoes"


def _items(value: Any) -> list[str]:
    return [item.strip() for item in value if isinstance(item, str) and item.strip()] if isinstance(value, list) else []


def hunter_edge_problems(values: dict[str, Any]) -> list[str]:
    """Every Edge is a catalog name; every Perk is "Triunfo: Distinção" of an Edge the sheet has."""
    problems: list[str] = []
    edges = _items(values.get(EDGE_FIELD))
    perks = _items(values.get(PERK_FIELD))
    if len(set(edges)) != len(edges) or len(set(perks)) != len(perks):
        problems.append("Triunfos e Distinções não se repetem")
    for edge in edges:
        if edge not in HUNTER_EDGES:
            problems.append(f"Triunfo {edge} fora do catálogo")
    for perk in perks:
        edge, _, name = perk.partition(":")
        edge, name = edge.strip(), name.strip()
        if edge not in HUNTER_EDGES or name not in HUNTER_EDGES[edge]:
            problems.append(f"Distinção {perk} fora do catálogo (formato Triunfo: Distinção)")
        elif edge not in edges:
            problems.append(f"Distinção {perk} pede o Triunfo {edge}")
    return problems


def hunter_creation_problems(values: dict[str, Any]) -> list[str]:
    """Trait problems plus the starting count of Edges and Perks."""
    problems = hunter_trait_problems(values)
    counts = (len(_items(values.get(EDGE_FIELD))), len(_items(values.get(PERK_FIELD))))
    if counts not in HUNTER_EDGE_STARTS:
        problems.append("Na criação: 2 Triunfos e 1 Distinção, ou 1 Triunfo e 2 Distinções")
    return problems


def in_despair(values: dict[str, Any]) -> bool:
    return values.get("em_desespero") is True


def usable_edges(values: dict[str, Any]) -> list[str]:
    """Edges blocked while the hunter is in Despair (conferir no livro)."""
    return [] if in_despair(values) else _items(values.get(EDGE_FIELD))


def template_creation_problems(system_key: str | None, version: int, field_ids: set[str], values: dict[str, Any]) -> list[str]:
    """Hunter checks for sheets/create: v3+ structured traits; from v4 also the starting Edges and Perks."""
    if system_key != "hunter" or "conviccao_1" not in field_ids:
        return []
    return hunter_creation_problems(values) if version >= 4 and EDGE_FIELD in field_ids else hunter_trait_problems(values)


# --- F4: Desperation results (mirror of private.hunter_roll_outcome) ------------------------
def roll_outcome(normal: list[int], desperation: list[int], difficulty: int) -> dict[str, Any]:
    faces = [*normal, *desperation]
    pairs = faces.count(10) // 2
    successes = sum(face >= 6 for face in faces) + 2 * pairs
    success = successes >= difficulty
    ones = desperation.count(1)
    return {
        "successes": successes, "success": success, "critical_pairs": pairs, "critical": success and pairs > 0,
        "desperation_ones": ones,
        "desperation_consequence": None if not ones else "table_choice" if success else "despair",
    }


def desperation_choices(outcome: dict[str, Any]) -> list[str]:
    """What the table may pick: Overreach only on a success (conferir no livro)."""
    if not outcome.get("desperation_ones"):
        return []
    return ["overreach", "despair"] if outcome.get("success") else ["despair"]
