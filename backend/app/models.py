from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not FIELD_ID.fullmatch(value):
            raise ValueError("id deve usar letras minúsculas, números e sublinhado")
        return value

    @model_validator(mode="after")
    def kind_requirements(self) -> "TemplateField":
        if self.kind == FieldKind.select and not self.options:
            raise ValueError("campo select precisa de opções")
        if self.kind in {FieldKind.formula, FieldKind.roll} and not self.expression:
            raise ValueError("campo de fórmula ou rolagem precisa de expressão")
        return self


class TemplateDraft(BaseModel):
    name: Annotated[str, Field(min_length=3, max_length=120)]
    version: Annotated[int, Field(ge=1)] = 1
    fields: list[TemplateField] = Field(min_length=1, max_length=200)
    system_key: str | None = Field(default=None, max_length=80)
    rules_profile_version: Annotated[int, Field(ge=1)] | None = None

    @model_validator(mode="after")
    def unique_field_ids(self) -> "TemplateDraft":
        ids = [field.id for field in self.fields]
        if len(ids) != len(set(ids)):
            raise ValueError("cada campo precisa de um id único")
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
