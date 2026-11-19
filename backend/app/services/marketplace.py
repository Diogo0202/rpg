"""Regras de publicação do marketplace: formato do modelo, anexos proibidos e resumo do conteúdo.

O acesso ao Supabase fica nos adaptadores de ``app/adapters/outbound/supabase``.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, ValidationError, field_validator, model_validator

from app.domain.errors import InvalidInput
from app.models import TemplateDraft
from app.services.system_schema import normalize_template_document
from app.services.templates import validate_template

MAX_NESTING_DEPTH = 64
MAX_TAG_LENGTH = 40
MAX_DEPENDENCY_LENGTH = 120


def template_digest(schema: dict[str, Any]) -> str:
    encoded = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


# O marketplace não hospeda arquivos (PDF, imagens, anexos): só JSON de modelo e links.
_EMBEDDED_FILE = re.compile(r"data:[^\s,;]*;base64,|%PDF-|JVBERi0", re.IGNORECASE)
_ATTACHMENT_KEYS = frozenset({"attachment", "attachments", "file", "files", "pdf", "upload", "uploads", "anexo", "anexos", "arquivo", "arquivos"})


def reject_embedded_files(value: Any, *, depth: int = 0) -> None:
    """Recusa anexos: chaves de arquivo ou conteúdo embutido (data: URI, PDF bruto ou em base64)."""
    if depth > MAX_NESTING_DEPTH:
        raise ValueError("estrutura profunda demais")
    if isinstance(value, str):
        if _EMBEDDED_FILE.search(value):
            raise ValueError("o marketplace não aceita arquivos ou anexos embutidos")
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str) and key.casefold() in _ATTACHMENT_KEYS:
                raise ValueError("o marketplace não aceita arquivos ou anexos")
            reject_embedded_files(item, depth=depth + 1)
    elif isinstance(value, (list, tuple)):
        for item in value:
            reject_embedded_files(item, depth=depth + 1)


def _unique_trimmed(values: list[str], *, max_length: int, length_message: str, repeated_message: str) -> list[str]:
    normalized = [value.strip() for value in values]
    if any(not value or len(value) > max_length for value in normalized):
        raise ValueError(length_message)
    if len({value.casefold() for value in normalized}) != len(normalized):
        raise ValueError(repeated_message)
    return normalized


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def no_attachments(cls, value: Any) -> Any:
        reject_embedded_files(value)
        return value

    template: TemplateDraft
    description: StrictStr = Field(min_length=1, max_length=2000)
    tags: list[StrictStr] = Field(min_length=1, max_length=20)
    author_name: StrictStr = Field(min_length=1, max_length=80)
    dependencies: list[StrictStr] = Field(default_factory=list, max_length=30)
    rights_confirmed: StrictBool

    @field_validator("template", mode="before")
    @classmethod
    def reject_unknown_schema_properties(cls, value: Any) -> Any:
        return normalize_template_document(value)

    @field_validator("tags")
    @classmethod
    def normalized_unique_tags(cls, tags: list[str]) -> list[str]:
        return _unique_trimmed(
            tags, max_length=MAX_TAG_LENGTH,
            length_message="cada tag deve ter entre 1 e 40 caracteres", repeated_message="tags repetidas não são aceitas",
        )

    @field_validator("dependencies")
    @classmethod
    def normalized_dependencies(cls, values: list[str]) -> list[str]:
        return _unique_trimmed(
            values, max_length=MAX_DEPENDENCY_LENGTH,
            length_message="cada dependência deve ter entre 1 e 120 caracteres",
            repeated_message="dependências repetidas não são aceitas",
        )

    @field_validator("description", "author_name")
    @classmethod
    def trimmed_text(cls, value: str) -> str:
        result = value.strip()
        if not result:
            raise ValueError("o campo não pode ficar vazio")
        return result


def validate_publication(payload: PublishRequest) -> dict[str, Any]:
    """Confere o formato do modelo e o validador comum de templates antes de publicar."""
    raw_template = payload.template.model_dump(mode="json")
    try:
        draft = validate_template(TemplateDraft.model_validate(raw_template))
    except (ValueError, ValidationError) as error:
        raise InvalidInput("modelo inválido para publicação") from error
    if payload.rights_confirmed is not True:
        raise InvalidInput("confirme os direitos para publicar")
    automation_level = "formulas" if any(field.kind.value in {"formula", "roll"} for field in draft.fields) else "static"
    return {
        "name": draft.name,
        "description": payload.description,
        "tags": payload.tags,
        "author_name": payload.author_name,
        "dependencies": payload.dependencies,
        "automation_level": automation_level,
        "template": draft.model_dump(mode="json"),
    }


def validate_import_schema(value: Any) -> dict[str, Any]:
    """Confere de novo um modelo importado antes de o narrador aprová-lo para criar fichas."""
    try:
        schema = normalize_template_document(value)
        draft = validate_template(TemplateDraft.model_validate(schema))
    except (ValueError, ValidationError) as error:
        raise InvalidInput("modelo importado precisa de correção antes da aprovação") from error
    return draft.model_dump(mode="json")
