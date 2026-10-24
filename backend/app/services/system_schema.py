from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import FieldKind, TemplateDraft, TemplateField
from app.services.creation_rules import CreationRule
from app.models import MetaCurrency


class PartitionedSystemSchema(BaseModel):
    """Document format that compiles to the API's canonical TemplateDraft."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=3, max_length=120)]
    version: Annotated[int, Field(ge=1)] = 1
    primitives: list[TemplateField] = Field(default_factory=list, max_length=200)
    computed_stats: list[TemplateField] = Field(default_factory=list, max_length=200)
    inventory_schema: list[TemplateField] = Field(default_factory=list, max_length=200)
    system_key: str | None = Field(default=None, max_length=80)
    rules_profile_version: Annotated[int, Field(ge=1)] | None = None
    experience_field: str | None = Field(default=None, max_length=64)
    meta_currencies: list[MetaCurrency] = Field(default_factory=list, max_length=10)
    creation_rules: list[CreationRule] = Field(default_factory=list, max_length=50)


PARTITION_KEYS = {"primitives", "computed_stats"}


def _unknown_property(value: Any, schema: dict[str, Any], definitions: dict[str, Any], path: str = "template") -> str | None:
    reference = schema.get("$ref")
    if reference:
        schema = definitions[reference.rsplit("/", 1)[-1]]
    if "anyOf" in schema or "oneOf" in schema:
        options = schema.get("anyOf", schema.get("oneOf", []))
        if value is None:
            return None
        expected_type = "object" if isinstance(value, dict) else "array" if isinstance(value, list) else None
        relevant = [
            option for option in options
            if option.get("$ref") or option.get("type") == expected_type or (expected_type == "object" and "properties" in option)
        ]
        errors = [_unknown_property(value, option, definitions, path) for option in relevant]
        return None if None in errors else next((error for error in errors if error), None)
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties")
        dynamic = additional is True or isinstance(additional, dict)
        unexpected = set(value) - set(properties)
        if unexpected and not dynamic:
            return f"{path}.{sorted(unexpected)[0]}"
        for key, item in value.items():
            child_schema = properties.get(key, additional if isinstance(additional, dict) else {})
            error = _unknown_property(item, child_schema, definitions, f"{path}.{key}")
            if error:
                return error
    elif isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            error = _unknown_property(item, schema["items"], definitions, f"{path}[{index}]")
            if error:
                return error
    return None


def _strictly_check(value: Any, model: type[BaseModel]) -> None:
    schema = model.model_json_schema()
    unexpected = _unknown_property(value, schema, schema.get("$defs", {}))
    if unexpected:
        raise ValueError(f"campo não permitido no schema: {unexpected}")


def normalize_template_document(value: Any) -> Any:
    """Accept canonical fields or compile the three named document partitions."""
    if not isinstance(value, dict):
        return value
    partitioned = bool(PARTITION_KEYS.intersection(value))
    input_model = PartitionedSystemSchema if partitioned else TemplateDraft
    _strictly_check(value, input_model)
    if not partitioned:
        return value
    parsed = PartitionedSystemSchema.model_validate(value)
    for field in parsed.primitives:
        if field.kind in {FieldKind.formula, FieldKind.roll}:
            raise ValueError(f"primitive {field.id} precisa ser um valor base")
    for field in parsed.computed_stats:
        if field.kind != FieldKind.formula:
            raise ValueError(f"computed_stat {field.id} precisa ser do tipo formula")
    all_fields = [*parsed.primitives, *parsed.computed_stats]
    ids = [field.id for field in all_fields]
    if len(ids) != len(set(ids)):
        raise ValueError("ids de campos da ficha precisam ser únicos entre as partições")
    if len(parsed.primitives) + len(parsed.computed_stats) > 200:
        raise ValueError("o schema pode declarar até 200 primitivas e estatísticas derivadas")
    if not parsed.primitives and not parsed.computed_stats:
        raise ValueError("o schema precisa declarar primitivas ou estatísticas derivadas")
    compiled = {
        "name": parsed.name,
        "version": parsed.version,
        "fields": [field.model_dump(mode="json") for field in [*parsed.primitives, *parsed.computed_stats]],
        "inventory_schema": [field.model_dump(mode="json") for field in parsed.inventory_schema],
        "system_key": parsed.system_key,
        "rules_profile_version": parsed.rules_profile_version,
        "experience_field": parsed.experience_field,
        "meta_currencies": [item.model_dump(mode="json") for item in parsed.meta_currencies],
        "creation_rules": [item.model_dump(mode="json") for item in parsed.creation_rules],
    }
    return compiled

