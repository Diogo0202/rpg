"""Deterministic, evidence-backed diagnostics for a tabletop chronicle.

This module only compares information supplied by the caller. It does not
infer story events from free text or produce game-book rules and lore.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


MAX_CHARACTERS = 20
MAX_ENTRIES_PER_CHARACTER = 50
MAX_ACTIVITY_RECORDS = 500
MAX_TEXT_LENGTH = 500
DEFAULT_SUPPORTER_RECENCY_DAYS = 90
DEFAULT_MIN_ACTIVITY_RECORDS = 5
DEFAULT_UNDERUSED_SHARE = 0.05


class GoalPolarity(str, Enum):
    pursues = "pursues"
    prevents = "prevents"


class TraitCategory(str, Enum):
    attribute = "attribute"
    skill = "skill"


class Touchstone(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)


class Goal(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    statement: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    target_id: str = Field(min_length=1, max_length=80)
    target_label: str = Field(min_length=1, max_length=120)
    polarity: GoalPolarity


class SheetNote(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)


class Supporter(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)


class SheetTrait(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    category: TraitCategory


class ChronicleCharacter(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    ambitions: list[Goal] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    desires: list[Goal] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    touchstones: list[Touchstone] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    supporters: list[Supporter] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    traits: list[SheetTrait] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    defects: list[SheetNote] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)

    @model_validator(mode="after")
    def unique_sheet_ids(self) -> "ChronicleCharacter":
        groups = (
            [goal.id for goal in self.ambitions],
            [goal.id for goal in self.desires],
            [t.id for t in self.touchstones],
            [supporter.id for supporter in self.supporters],
            [trait.id for trait in self.traits],
            [defect.id for defect in self.defects],
        )
        if any(len(ids) != len(set(ids)) for ids in groups):
            raise ValueError("ids devem ser únicos dentro de cada grupo da ficha")
        return self


class ActivityRecord(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    occurred_on: date
    character_id: str = Field(min_length=1, max_length=80)
    used_trait_ids: list[str] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    used_ambition_ids: list[str] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    used_desire_ids: list[str] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    used_touchstone_ids: list[str] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    used_defect_ids: list[str] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)
    threatened_supporter_ids: list[str] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CHARACTER)

    @model_validator(mode="after")
    def unique_references(self) -> "ActivityRecord":
        if len(self.used_trait_ids) != len(set(self.used_trait_ids)):
            raise ValueError("used_trait_ids não pode conter ids duplicados")
        if len(self.used_ambition_ids) != len(set(self.used_ambition_ids)):
            raise ValueError("used_ambition_ids não pode conter ids duplicados")
        if len(self.used_desire_ids) != len(set(self.used_desire_ids)):
            raise ValueError("used_desire_ids não pode conter ids duplicados")
        if len(self.used_touchstone_ids) != len(set(self.used_touchstone_ids)):
            raise ValueError("used_touchstone_ids não pode conter ids duplicados")
        if len(self.used_defect_ids) != len(set(self.used_defect_ids)):
            raise ValueError("used_defect_ids não pode conter ids duplicados")
        if len(self.threatened_supporter_ids) != len(set(self.threatened_supporter_ids)):
            raise ValueError("threatened_supporter_ids não pode conter ids duplicados")
        return self


class ChronicleGapRequest(BaseModel):
    characters: list[ChronicleCharacter] = Field(min_length=1, max_length=MAX_CHARACTERS)
    activity: list[ActivityRecord] = Field(default_factory=list, max_length=MAX_ACTIVITY_RECORDS)
    as_of: date
    supporter_recency_days: int = Field(default=DEFAULT_SUPPORTER_RECENCY_DAYS, ge=1, le=3650)
    min_activity_records: int = Field(default=DEFAULT_MIN_ACTIVITY_RECORDS, ge=1, le=MAX_ACTIVITY_RECORDS)
    underused_trait_share: float = Field(default=DEFAULT_UNDERUSED_SHARE, gt=0, le=1)

    @model_validator(mode="after")
    def valid_references(self) -> "ChronicleGapRequest":
        characters = {character.id: character for character in self.characters}
        if len(characters) != len(self.characters):
            raise ValueError("cada personagem precisa de um id único")

        records = [record.id for record in self.activity]
        if len(records) != len(set(records)):
            raise ValueError("cada registro de atividade precisa de um id único")

        target_labels: dict[str, str] = {}
        for character in self.characters:
            for goal in (*character.ambitions, *character.desires):
                previous_label = target_labels.setdefault(goal.target_id, goal.target_label)
                if previous_label != goal.target_label:
                    raise ValueError(f"rótulo inconsistente para o alvo {goal.target_id}")

        for record in self.activity:
            if record.occurred_on > self.as_of:
                raise ValueError("atividade não pode ocorrer depois de as_of")
            character = characters.get(record.character_id)
            if character is None:
                raise ValueError(f"personagem inexistente no registro {record.id}")
            trait_ids = {trait.id for trait in character.traits}
            supporter_ids = {supporter.id for supporter in character.supporters}
            ambition_ids = {goal.id for goal in character.ambitions}
            desire_ids = {goal.id for goal in character.desires}
            touchstone_ids = {item.id for item in character.touchstones}
            defect_ids = {item.id for item in character.defects}
            if unknown := set(record.used_trait_ids) - trait_ids:
                raise ValueError(f"atributos ou habilidades inexistentes no registro {record.id}: {', '.join(sorted(unknown))}")
            if unknown := set(record.used_ambition_ids) - ambition_ids:
                raise ValueError(f"ambições inexistentes no registro {record.id}: {', '.join(sorted(unknown))}")
            if unknown := set(record.used_desire_ids) - desire_ids:
                raise ValueError(f"desejos inexistentes no registro {record.id}: {', '.join(sorted(unknown))}")
            if unknown := set(record.used_touchstone_ids) - touchstone_ids:
                raise ValueError(f"âncoras inexistentes no registro {record.id}: {', '.join(sorted(unknown))}")
            if unknown := set(record.used_defect_ids) - defect_ids:
                raise ValueError(f"complicações inexistentes no registro {record.id}: {', '.join(sorted(unknown))}")
            if unknown := set(record.threatened_supporter_ids) - supporter_ids:
                raise ValueError(f"apoiadores inexistentes no registro {record.id}: {', '.join(sorted(unknown))}")
        return self


class EvidenceReference(BaseModel):
    record_id: str
    occurred_on: date


class SupporterGap(BaseModel):
    character_id: str
    supporter_id: str
    supporter_name: str
    status: Literal["never_threatened", "threatened_outside_window"]
    last_threat: EvidenceReference | None


class GoalConflict(BaseModel):
    target_id: str
    target_label: str
    first_character_id: str
    first_goal_id: str
    first_goal_statement: str
    first_goal_type: str
    second_character_id: str
    second_goal_id: str
    second_goal_statement: str
    second_goal_type: str


class UnderusedTrait(BaseModel):
    category: TraitCategory
    trait_name: str
    character_ids: list[str]
    observed_uses: int
    total_trait_mentions: int
    usage_share: float
    evidence: list[EvidenceReference]


class CharacterDramaContext(BaseModel):
    character_id: str
    ambition_ids: list[str]
    desire_ids: list[str]
    defect_ids: list[str]


class ChronicleGapReport(BaseModel):
    as_of: date
    supporters_without_recent_threat: list[SupporterGap]
    conflicting_goals: list[GoalConflict]
    underused_traits: list[UnderusedTrait]
    character_context: list[CharacterDramaContext]
    activity_record_count: int
    reviewed_activity: list[EvidenceReference]
    notes: list[str]


def analyze_chronicle_gaps(request: ChronicleGapRequest) -> ChronicleGapReport:
    """Return deterministic findings with references to caller-provided data.

    Goal conflicts require a shared target id and opposite explicit polarity.
    A trait can be called underused only when the configured minimum number
    of activity records exists; the usage share is measured against all trait
    mentions in those records.
    """
    supporters = _find_supporter_gaps(request)
    conflicts = _find_goal_conflicts(request.characters)
    underused = _find_underused_traits(request)
    notes: list[str] = []
    if len(request.activity) < request.min_activity_records:
        notes.append(
            "Histórico curto para avaliar uso de atributos e habilidades; "
            "nenhum item foi classificado como pouco usado."
        )
    return ChronicleGapReport(
        as_of=request.as_of,
        supporters_without_recent_threat=supporters,
        conflicting_goals=conflicts,
        underused_traits=underused,
        character_context=[
            CharacterDramaContext(
                character_id=character.id,
                ambition_ids=[goal.id for goal in character.ambitions],
                desire_ids=[goal.id for goal in character.desires],
                defect_ids=[defect.id for defect in character.defects],
            )
            for character in request.characters
        ],
        activity_record_count=len(request.activity),
        reviewed_activity=[
            EvidenceReference(record_id=record.id, occurred_on=record.occurred_on)
            for record in request.activity
        ],
        notes=notes,
    )


def _find_supporter_gaps(request: ChronicleGapRequest) -> list[SupporterGap]:
    cutoff_ordinal = max(1, request.as_of.toordinal() - request.supporter_recency_days)
    cutoff = date.fromordinal(cutoff_ordinal)
    last_threat: dict[tuple[str, str], ActivityRecord] = {}
    for record in request.activity:
        for supporter_id in record.threatened_supporter_ids:
            key = (record.character_id, supporter_id)
            previous = last_threat.get(key)
            if previous is None or record.occurred_on > previous.occurred_on:
                last_threat[key] = record

    gaps: list[SupporterGap] = []
    for character in request.characters:
        for supporter in character.supporters:
            record = last_threat.get((character.id, supporter.id))
            if record is not None and record.occurred_on >= cutoff:
                continue
            gaps.append(
                SupporterGap(
                    character_id=character.id,
                    supporter_id=supporter.id,
                    supporter_name=supporter.name,
                    status="never_threatened" if record is None else "threatened_outside_window",
                    last_threat=None if record is None else EvidenceReference(
                        record_id=record.id,
                        occurred_on=record.occurred_on,
                    ),
                )
            )
    return gaps


def _find_goal_conflicts(characters: list[ChronicleCharacter]) -> list[GoalConflict]:
    indexed: dict[tuple[str, GoalPolarity], list[tuple[ChronicleCharacter, Goal, str]]] = defaultdict(list)
    # Ordenar personagens para garantir determinismo na construcao do indice
    sorted_characters = sorted(characters, key=lambda c: c.id)
    for character in sorted_characters:
        for goal_type, goals in (("ambition", character.ambitions), ("desire", character.desires)):
            # Ordenar objetivos para garantir determinismo
            sorted_goals = sorted(goals, key=lambda g: g.id)
            for goal in sorted_goals:
                indexed[(goal.target_id, goal.polarity)].append((character, goal, goal_type))

    conflicts: list[GoalConflict] = []
    target_labels = {
        goal.target_id: goal.target_label
        for character in characters
        for goal in (*character.ambitions, *character.desires)
    }
    # Ordenar itens do indice para iteracao deterministica
    for (target_id, polarity), pursuers in sorted(indexed.items(), key=lambda item: (item[0][0], item[0][1].value)):
        opponents = indexed.get((target_id, _opposite(polarity)), [])
        # Ordenar pursuers e opponents
        sorted_pursuers = sorted(pursuers, key=lambda p: (p[0].id, p[1].id))
        sorted_opponents = sorted(opponents, key=lambda o: (o[0].id, o[1].id))

        for first_character, first_goal, first_type in sorted_pursuers:
            for second_character, second_goal, second_type in sorted_opponents:
                if first_character.id >= second_character.id:
                    continue
                conflicts.append(
                    GoalConflict(
                        target_id=target_id,
                        target_label=target_labels[target_id],
                        first_character_id=first_character.id,
                        first_goal_id=first_goal.id,
                        first_goal_statement=first_goal.statement,
                        first_goal_type=first_type,
                        second_character_id=second_character.id,
                        second_goal_id=second_goal.id,
                        second_goal_statement=second_goal.statement,
                        second_goal_type=second_type,
                    )
                )
    return conflicts



def _find_underused_traits(request: ChronicleGapRequest) -> list[UnderusedTrait]:
    if len(request.activity) < request.min_activity_records:
        return []

    definitions: dict[tuple[TraitCategory, str], set[str]] = defaultdict(set)
    trait_lookup: dict[tuple[str, str], SheetTrait] = {}
    for character in request.characters:
        for trait in character.traits:
            key = (trait.category, trait.name.casefold())
            definitions[key].add(character.id)
            trait_lookup[(character.id, trait.id)] = trait

    uses: Counter[tuple[TraitCategory, str]] = Counter()
    evidence: dict[tuple[TraitCategory, str], list[EvidenceReference]] = defaultdict(list)
    total_mentions = 0
    for record in request.activity:
        for trait_id in record.used_trait_ids:
            trait = trait_lookup[(record.character_id, trait_id)]
            key = (trait.category, trait.name.casefold())
            uses[key] += 1
            total_mentions += 1
            evidence[key].append(EvidenceReference(record_id=record.id, occurred_on=record.occurred_on))

    if total_mentions == 0:
        return [
            UnderusedTrait(
                category=category,
                trait_name=_display_trait_name(request.characters, category, normalized_name),
                character_ids=sorted(character_ids),
                observed_uses=0,
                total_trait_mentions=0,
                usage_share=0.0,
                evidence=[],
            )
            for (category, normalized_name), character_ids in sorted(
                definitions.items(), key=lambda item: (item[0][0].value, item[0][1])
            )
        ]

    findings: list[UnderusedTrait] = []
    for (category, normalized_name), character_ids in definitions.items():
        count = uses[(category, normalized_name)]
        share = count / total_mentions
        if share <= request.underused_trait_share:
            findings.append(
                UnderusedTrait(
                    category=category,
                    trait_name=_display_trait_name(request.characters, category, normalized_name),
                    character_ids=sorted(character_ids),
                    observed_uses=count,
                    total_trait_mentions=total_mentions,
                    usage_share=share,
                    evidence=evidence[(category, normalized_name)],
                )
            )
    return sorted(findings, key=lambda item: (item.category.value, item.trait_name.casefold()))


def _display_trait_name(
    characters: list[ChronicleCharacter], category: TraitCategory, normalized_name: str
) -> str:
    for character in characters:
        for trait in character.traits:
            if trait.category == category and trait.name.casefold() == normalized_name:
                return trait.name
    return normalized_name


def _opposite(polarity: GoalPolarity) -> GoalPolarity:
    return GoalPolarity.prevents if polarity == GoalPolarity.pursues else GoalPolarity.pursues
