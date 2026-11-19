"""Monta o pedido de diagnóstico da crônica a partir dos registros da campanha (regra pura)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.domain.errors import InvalidInput
from app.services.chronicle_gaps import (
    ActivityRecord,
    ChronicleCharacter,
    ChronicleGapRequest,
    Goal,
    GoalPolarity,
    SheetNote,
    SheetTrait,
    Supporter,
    TraitCategory,
)

Row = dict[str, Any]

# IDs dos starters do Nexus. Outros campos numéricos só contam como atributo ou
# habilidade quando o schema acrescentar metadados explícitos.
ATTRIBUTE_IDS = frozenset({
    "forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole",
    "inteligencia", "raciocinio", "resolucao", "coracao", "espirito", "strength", "heart", "wits",
})
SKILL_IDS = frozenset({
    "atletismo", "briga", "conducao", "furtividade", "ladroagem", "oficios",
    "sobrevivencia", "armas_brancas", "armas_de_fogo", "etiqueta", "empatia",
    "intimidacao", "lideranca", "manha", "performance", "persuasao", "subterfugio",
    "trato_com_animais", "academicos", "ciencia", "consciencia", "financas",
    "investigacao", "medicina", "ocultismo", "percepcao", "tecnologia", "awe",
    "athletics", "awareness", "hunting", "song", "travel",
})
LEGACY_TEXT_FIELD_IDS = frozenset({"ambicao", "desejo", "defeitos", "apoiadores"})
UNNAMED_SHEET = "Ficha sem nome"


@dataclass(frozen=True)
class CampaignChronicle:
    """Tudo que o diagnóstico lê de uma campanha, já restrito às fichas de modelos aprovados."""

    templates: list[Row]
    sheets: list[Row]
    goals: list[Row] = field(default_factory=list)
    supporters: list[Row] = field(default_factory=list)
    defects: list[Row] = field(default_factory=list)
    activity: list[Row] = field(default_factory=list)


@dataclass(frozen=True)
class AnalysisSettings:
    as_of: date
    supporter_recency_days: int = 90
    min_activity_records: int = 5
    underused_trait_share: float = 0.05


def _group_by_sheet(rows: list[Row]) -> dict[str, list[Row]]:
    grouped: dict[str, list[Row]] = {}
    for row in rows:
        grouped.setdefault(str(row["sheet_id"]), []).append(row)
    return grouped


def _traits(fields: list[Any], values: Row) -> tuple[list[SheetTrait], list[Row], list[str]]:
    traits: list[SheetTrait] = []
    legacy: list[Row] = []
    ignored_numeric: list[str] = []
    seen: set[str] = set()
    for field_row in fields:
        if not isinstance(field_row, dict) or not isinstance(field_row.get("id"), str):
            continue
        field_id = field_row["id"]
        if field_id in LEGACY_TEXT_FIELD_IDS:
            legacy.append({"id": field_id, "populated": field_id in values})
        if field_row.get("kind") != "number":
            continue
        if field_id in seen:
            raise InvalidInput(f"template aprovado repete o campo {field_id}")
        seen.add(field_id)
        if field_id in ATTRIBUTE_IDS:
            category = TraitCategory.attribute
        elif field_id in SKILL_IDS:
            category = TraitCategory.skill
        else:
            if field_id in values:
                ignored_numeric.append(field_id)
            continue
        traits.append(SheetTrait(id=field_id, name=str(field_row.get("label") or field_id)[:120], category=category))
    return traits, legacy, ignored_numeric


def _goals(rows: list[Row]) -> tuple[list[Goal], list[Goal]]:
    ambitions: list[Goal] = []
    desires: list[Goal] = []
    for row in rows:
        try:
            goal = Goal(
                id=str(row["id"]), statement=row["statement"], target_id=row["target_id"],
                target_label=row["target_label"], polarity=GoalPolarity(row["polarity"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise InvalidInput("uma meta estruturada está inválida") from error
        (ambitions if row["goal_type"] == "ambition" else desires).append(goal)
    return ambitions, desires


def _character(sheet: Row, template: Row, goals: list[Row], supporters: list[Row], defects: list[Row]) -> tuple[ChronicleCharacter, Row]:
    schema = template.get("schema") if isinstance(template.get("schema"), dict) else {}
    fields = schema.get("fields") if isinstance(schema.get("fields"), list) else []
    values = sheet.get("values") if isinstance(sheet.get("values"), dict) else {}
    traits, legacy, ignored_numeric = _traits(fields, values)
    ambitions, desires = _goals(goals)
    supporter_models = [Supporter(id=str(row["id"]), name=row["name"]) for row in supporters]
    defect_models = [SheetNote(id=str(row["id"]), text=row["statement"]) for row in defects]
    character = ChronicleCharacter(
        id=str(sheet["id"]), name=str(sheet.get("name") or UNNAMED_SHEET), ambitions=ambitions,
        desires=desires, supporters=supporter_models, defects=defect_models, traits=traits,
    )
    summary = {
        "id": character.id,
        "name": character.name,
        "template_id": str(sheet.get("template_id")),
        "template_name": str(template.get("name") or "Modelo aprovado"),
        "traits": [trait.model_dump(mode="json") for trait in traits],
        "ambitions": [goal.model_dump(mode="json") for goal in ambitions],
        "desires": [goal.model_dump(mode="json") for goal in desires],
        "supporters": [supporter.model_dump(mode="json") for supporter in supporter_models],
        "defects": [defect.model_dump(mode="json") for defect in defect_models],
        "legacy_text_fields": legacy,
        "unclassified_numeric_field_ids": ignored_numeric,
    }
    return character, summary


@dataclass(frozen=True)
class _KnownReferences:
    """Metas, complicações e apoiadores de todas as fichas da análise."""

    goal_types: dict[str, str]
    defect_ids: frozenset[str]
    supporter_ids: frozenset[str]

    @classmethod
    def of(cls, characters: dict[str, ChronicleCharacter]) -> _KnownReferences:
        goal_types: dict[str, str] = {}
        for character in characters.values():
            goal_types.update({goal.id: "ambition" for goal in character.ambitions})
            goal_types.update({goal.id: "desire" for goal in character.desires})
        return cls(
            goal_types,
            frozenset(item.id for character in characters.values() for item in character.defects),
            frozenset(item.id for character in characters.values() for item in character.supporters),
        )


def _activity(row: Row, characters: dict[str, ChronicleCharacter], known: _KnownReferences) -> ActivityRecord:
    character = characters[str(row["sheet_id"])]
    goal_ids = [str(value) for value in row.get("used_goal_ids", [])]
    record = ActivityRecord(
        id=str(row["id"]), occurred_on=row["occurred_on"], character_id=character.id,
        used_trait_ids=list(row.get("used_trait_ids") or []),
        used_ambition_ids=[value for value in goal_ids if known.goal_types.get(value) == "ambition"],
        used_desire_ids=[value for value in goal_ids if known.goal_types.get(value) == "desire"],
        used_defect_ids=[str(value) for value in row.get("used_defect_ids", [])],
        threatened_supporter_ids=[str(value) for value in row.get("threatened_supporter_ids", [])],
    )
    if any(value not in known.goal_types for value in goal_ids):
        raise InvalidInput("uma atividade aponta para meta ausente")
    if any(value not in known.defect_ids for value in record.used_defect_ids):
        raise InvalidInput("uma atividade aponta para complicação ausente")
    if any(value not in known.supporter_ids for value in record.threatened_supporter_ids):
        raise InvalidInput("uma atividade aponta para apoiador ausente")
    if any(value not in {trait.id for trait in character.traits} for value in record.used_trait_ids):
        raise InvalidInput("uma atividade aponta para atributo ou habilidade ausente")
    return record


def build_analysis_request(chronicle: CampaignChronicle, settings: AnalysisSettings) -> tuple[ChronicleGapRequest, list[Row]]:
    templates = {str(template["id"]): template for template in chronicle.templates}
    goals = _group_by_sheet(chronicle.goals)
    supporters = _group_by_sheet(chronicle.supporters)
    defects = _group_by_sheet(chronicle.defects)
    characters: dict[str, ChronicleCharacter] = {}
    summaries: list[Row] = []
    for sheet in chronicle.sheets:
        sheet_id = str(sheet["id"])
        character, summary = _character(
            sheet, templates.get(str(sheet.get("template_id")), {}),
            goals.get(sheet_id, []), supporters.get(sheet_id, []), defects.get(sheet_id, []),
        )
        characters[sheet_id] = character
        summaries.append(summary)
    known = _KnownReferences.of(characters)
    activity = [_activity(row, characters, known) for row in chronicle.activity]
    try:
        request = ChronicleGapRequest(
            characters=list(characters.values()), activity=activity, as_of=settings.as_of,
            supporter_recency_days=settings.supporter_recency_days,
            min_activity_records=settings.min_activity_records,
            underused_trait_share=settings.underused_trait_share,
        )
    except ValueError as error:
        raise InvalidInput(f"dados estruturados inconsistentes: {error}") from error
    return request, summaries
