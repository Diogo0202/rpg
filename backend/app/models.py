from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.creation_rules import CreationRule, PowerPicks, PriorityPoints, SelectGrants
from app.services.modifiers import Effect, ModifierPreview, Tag


FIELD_ID = re.compile(r"^[a-z][a-z0-9_]{1,63}$")


class FieldKind(str, Enum):
    text = "text"
    number = "number"
    select = "select"
    checkbox = "checkbox"
    collection = "collection"
    formula = "formula"
    roll = "roll"


class DependentOptionCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    equals: Annotated[str, Field(min_length=1, max_length=160)]
    options: list[Annotated[str, Field(min_length=1, max_length=160)]] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_options(self) -> "DependentOptionCase":
        if len(self.options) != len(set(self.options)):
            raise ValueError("opções dependentes precisam ser únicas")
        return self


class FieldDependency(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: Annotated[str, Field(min_length=2, max_length=64)]
    cases: list[DependentOptionCase] = Field(min_length=1, max_length=100)

    @field_validator("field_id")
    @classmethod
    def valid_field_id(cls, value: str) -> str:
        if not FIELD_ID.fullmatch(value):
            raise ValueError("field_id deve apontar para um campo válido")
        return value

    @model_validator(mode="after")
    def unique_cases(self) -> "FieldDependency":
        matches = [case.equals for case in self.cases]
        if len(matches) != len(set(matches)):
            raise ValueError("cada valor controlador pode ter apenas um caso")
        return self


class TemplateField(BaseModel):
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=120)]
    kind: FieldKind
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=100)
    expression: str | None = Field(default=None, max_length=120)
    creation_step: Literal["identity", "attributes", "skills", "traits", "resources", "story", "other"] | None = None
    identity_kind: Literal["race", "subrace", "clan", "predator", "creed", "lineage", "origin", "archetype"] | None = None
    character_name: bool = False
    depends_on: FieldDependency | None = None
    # Owner and master only: stripped from party_status_public, overlays and other players.
    private: bool = False
    # Hard limits for number fields, enforced on every write (creation and later edits).
    min: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    max: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not FIELD_ID.fullmatch(value):
            raise ValueError("id deve usar letras minúsculas, números e sublinhado")
        return value

    @model_validator(mode="after")
    def kind_requirements(self) -> "TemplateField":
        if (self.min is not None or self.max is not None) and self.kind != FieldKind.number:
            raise ValueError("mínimo e máximo só valem para campos numéricos")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError(f"o mínimo de {self.id} passa do máximo")
        if self.kind == FieldKind.select and self.depends_on is None and not self.options:
            raise ValueError("campo select precisa de opções")
        if self.depends_on is not None and self.kind != FieldKind.select:
            raise ValueError("depends_on só pode ser declarado em campo select")
        if self.depends_on is not None and self.options:
            raise ValueError("campo select dependente não pode declarar opções estáticas")
        if self.kind in {FieldKind.formula, FieldKind.roll} and not self.expression:
            raise ValueError("campo de fórmula ou rolagem precisa de expressão")
        return self


class MetaCurrency(BaseModel):
    """Recurso genérico (Força de Vontade, Inspiração, Esperança).

    pool: gastar reduz ``field``; track: gastar aumenta uma trilha de dano.
    """

    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    field: Annotated[str, Field(min_length=2, max_length=64)]
    mode: Literal["pool", "track"]
    max: Annotated[int, Field(ge=0, le=1000)] | None = None
    max_field: Annotated[str, Field(min_length=2, max_length=64)] | None = None

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not FIELD_ID.fullmatch(value):
            raise ValueError("id do recurso deve usar letras minúsculas, números e sublinhado")
        return value


class TemplateDraft(BaseModel):
    name: Annotated[str, Field(min_length=3, max_length=120)]
    version: Annotated[int, Field(ge=1)] = 1
    fields: list[TemplateField] = Field(min_length=1, max_length=200)
    system_key: str | None = Field(default=None, max_length=80)
    rules_profile_version: Annotated[int, Field(ge=1)] | None = None
    experience_field: str | None = Field(default=None, max_length=64)
    inventory_schema: list[TemplateField] = Field(default_factory=list, max_length=200)
    meta_currencies: list[MetaCurrency] = Field(default_factory=list, max_length=10)
    creation_rules: list[CreationRule] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def rule_references(self) -> "TemplateDraft":
        numbers = {field.id for field in self.fields if field.kind == FieldKind.number}
        ids = [rule.id for rule in self.creation_rules]
        if len(ids) != len(set(ids)):
            raise ValueError("cada regra de criação precisa de um id único")
        kinds = {field.id: field.kind for field in self.fields}

        def expect(field_id: str, kind: FieldKind, rule_label: str) -> None:
            if kinds.get(field_id) != kind:
                raise ValueError(f"regra {rule_label} cita {field_id}, que precisa ser um campo {kind.value}")

        for rule in self.creation_rules:
            missing = [field_id for field_id in rule.fields if field_id not in numbers]
            if missing:
                raise ValueError(f"regra {rule.label} cita campos que não são numéricos: {', '.join(missing)}")
            if isinstance(rule, SelectGrants):
                expect(rule.field, FieldKind.select, rule.label)
                for case in rule.cases:
                    grants = [case, *(option for choice in case.choices for option in choice.options)]
                    for choice in case.choices:
                        expect(choice.field, FieldKind.select, rule.label)
                    for grant in grants:
                        for field_id in grant.add:
                            expect(field_id, FieldKind.number, rule.label)
                        for field_id in grant.items:
                            expect(field_id, FieldKind.collection, rule.label)
                        requirement = getattr(grant, "requires", None)
                        if requirement:
                            expect(requirement["field"], FieldKind.select, rule.label)
            elif isinstance(rule, PriorityPoints):
                for pool in rule.pools:
                    if pool.allowed:
                        expect(pool.allowed.field, FieldKind.select, rule.label)
            elif isinstance(rule, PowerPicks):
                expect(rule.collection, FieldKind.collection, rule.label)
                for source in rule.sources:
                    for power in source.powers:
                        if power.requires:
                            expect(power.requires["field"], FieldKind.number, rule.label)
        return self

    @model_validator(mode="after")
    def resource_references(self) -> "TemplateDraft":
        kinds = {field.id: field.kind for field in self.fields}
        if self.experience_field is not None and kinds.get(self.experience_field) != FieldKind.number:
            raise ValueError(f"campo de experiência precisa ser numérico: {self.experience_field}")
        ids = [currency.id for currency in self.meta_currencies]
        if len(ids) != len(set(ids)):
            raise ValueError("cada recurso precisa de um id único")
        for currency in self.meta_currencies:
            if kinds.get(currency.field) != FieldKind.number:
                raise ValueError(f"recurso {currency.label} precisa apontar para um campo numérico: {currency.field}")
            if currency.max_field is not None and kinds.get(currency.max_field) not in {FieldKind.number, FieldKind.formula}:
                raise ValueError(f"máximo de {currency.label} precisa ser campo numérico ou fórmula: {currency.max_field}")
        return self

    @model_validator(mode="after")
    def unique_field_ids(self) -> "TemplateDraft":
        ids = [field.id for field in self.fields]
        if len(ids) != len(set(ids)):
            raise ValueError("cada campo precisa de um id único")
        fields = {field.id: field for field in self.fields}
        for field in self.fields:
            dependency = field.depends_on
            if dependency is None:
                continue
            controller = fields.get(dependency.field_id)
            if controller is None:
                raise ValueError(f"campo controlador inexistente: {dependency.field_id}")
            if controller.kind != FieldKind.select:
                raise ValueError(f"campo controlador precisa ser select: {dependency.field_id}")
            if controller.id == field.id:
                raise ValueError(f"campo não pode depender de si mesmo: {field.id}")

        visited: set[str] = set()
        visiting: set[str] = set()

        def visit(field_id: str) -> None:
            if field_id in visiting:
                raise ValueError("dependências circulares entre campos")
            if field_id in visited:
                return
            visiting.add(field_id)
            dependency = fields[field_id].depends_on
            if dependency is not None:
                visit(dependency.field_id)
            visiting.remove(field_id)
            visited.add(field_id)

        for field_id in fields:
            visit(field_id)

        option_cache: dict[str, set[str]] = {}

        def possible_options(field_id: str) -> set[str]:
            if field_id in option_cache:
                return option_cache[field_id]
            field = fields[field_id]
            dependency = field.depends_on
            if dependency is None:
                options = set(field.options)
            else:
                parent_options = possible_options(dependency.field_id)
                invalid_cases = [case.equals for case in dependency.cases if case.equals not in parent_options]
                if invalid_cases:
                    raise ValueError(
                        f"casos dependentes de {field_id} não existem nas opções do controlador: "
                        + ", ".join(invalid_cases)
                    )
                options = {option for case in dependency.cases for option in case.options}
            option_cache[field_id] = options
            return options

        for field_id in fields:
            possible_options(field_id)
        marked_names = [field for field in self.fields if field.character_name]
        if len(marked_names) > 1:
            raise ValueError("template pode marcar apenas um campo como nome do personagem")
        if any(field.kind != FieldKind.text for field in marked_names):
            raise ValueError("campo de nome do personagem precisa ser do tipo texto")
        return self


class SheetCalculationRequest(BaseModel):
    template: TemplateDraft
    values: dict[str, object] = Field(default_factory=dict, max_length=200)


class SheetCalculationResponse(BaseModel):
    values: dict[str, object]


class DiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expression: Annotated[str, Field(min_length=3, max_length=32)]
    effects: list[Effect] = Field(default_factory=list, max_length=30)
    context_tags: list[Tag] = Field(default_factory=list, max_length=20)


class DiceResponse(BaseModel):
    expression: str
    rolls: list[int]
    modifier: int
    total: int
    modifier_preview: ModifierPreview | None = None


class ExtractionRequest(BaseModel):
    source_id: str
    rights_confirmed: Literal[True]
    page_references: list[Annotated[int, Field(ge=1)]] = Field(min_length=1, max_length=30)
    suggested_system_name: Annotated[str, Field(min_length=3, max_length=120)]
