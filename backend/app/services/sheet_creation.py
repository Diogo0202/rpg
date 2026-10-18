from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.models import FieldKind, TemplateDraft
from app.services.sheet_calculations import calculate_sheet
from app.services.sheet_values import validate_sheet_values


def approved_template_draft(template: dict[str, Any]) -> TemplateDraft:
    """Parse an approved stored template, supporting older rows without root metadata."""
    schema = template.get("schema")
    if not isinstance(schema, dict):
        raise ValueError("template não possui um schema válido")

    draft_data = dict(schema)
    draft_data.setdefault("name", template.get("name") or "Template")
    draft_data.setdefault("version", template.get("version") or 1)
    try:
        return TemplateDraft.model_validate(draft_data)
    except ValidationError as error:
        raise ValueError("schema do template aprovado é inválido") from error


def prepare_sheet_creation(
    template: dict[str, Any],
    name: str,
    values: dict[str, Any],
) -> tuple[TemplateDraft, str, dict[str, Any]]:
    """Normalize the sheet name, validate inputs, and calculate derived fields."""
    draft = approved_template_draft(template)

    if draft.rules_profile_version is not None:
        raise ValueError(
            f"perfil de regras {draft.system_key or 'sem sistema'} v{draft.rules_profile_version} "
            "não tem uma fonte oficial suportada; remova o perfil para usar validação genérica"
        )

    normalized_name = name.strip()
    if not normalized_name:
        raise ValueError("nome da ficha não pode ficar vazio")

    name_field = next((field for field in draft.fields if field.character_name), None)
    if name_field is None:
        name_field = next(
            (field for field in draft.fields if field.id == "nome" and field.kind == FieldKind.text),
            None,
        )

    normalized_values = dict(values)
    if name_field is not None:
        normalized_values[name_field.id] = normalized_name

    fields = {field.id: field.model_dump(mode="json") for field in draft.fields}
    validate_sheet_values(normalized_values, fields)
    calculation_inputs = {
        field_id: value
        for field_id, value in normalized_values.items()
        if not (
            fields[field_id]["kind"] in {FieldKind.formula.value, FieldKind.roll.value}
            and value is None
        )
    }
    calculate_sheet(draft, calculation_inputs)

    persisted_values = {
        field_id: value
        for field_id, value in normalized_values.items()
        if fields[field_id]["kind"] not in {FieldKind.formula.value, FieldKind.roll.value}
    }
    return draft, normalized_name, persisted_values
