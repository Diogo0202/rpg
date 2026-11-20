from __future__ import annotations

import json
import math
from typing import Any


MAX_SHEET_VALUES_FIELDS = 200
MAX_SHEET_VALUES_BYTES = 32 * 1024
MAX_TEXT_LENGTH = 10_000
MAX_NUMBER_ABS = 1_000_000
MAX_COLLECTION_ITEMS = 200
MAX_COLLECTION_TEXT_LENGTH = 500


def _active_options(
    field_id: str,
    fields: dict[str, dict[str, Any]],
    values: dict[str, Any],
    visiting: set[str] | None = None,
) -> tuple[bool, list[str]]:
    field = fields[field_id]
    dependency = field.get("depends_on")
    static_options = field.get("options")
    if not isinstance(dependency, dict):
        return True, static_options if isinstance(static_options, list) else []

    chain = visiting if visiting is not None else set()
    if field_id in chain:
        raise ValueError("dependências circulares entre campos")
    chain.add(field_id)
    controller_id = dependency.get("field_id")
    controller = fields.get(controller_id) if isinstance(controller_id, str) else None
    if controller is None or controller.get("kind") != "select":
        raise ValueError(f"campo controlador inválido para {field_id}")
    controller_active, _ = _active_options(controller_id, fields, values, chain)
    chain.remove(field_id)
    if not controller_active:
        return False, []

    selected = values.get(controller_id)
    if not isinstance(selected, str):
        return False, []
    cases = dependency.get("cases")
    if not isinstance(cases, list):
        raise ValueError(f"casos de dependência inválidos para {field_id}")
    for case in cases:
        if isinstance(case, dict) and case.get("equals") == selected:
            options = case.get("options")
            if not isinstance(options, list):
                raise ValueError(f"opções dependentes inválidas para {field_id}")
            return True, options
    return False, []


def _filled(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _check_text_constraints(field_id: str, field: dict[str, Any], value: Any, values: dict[str, Any]) -> None:
    """Structured text limits declared by the template (see TemplateField and the 20261026190000 trigger)."""
    label = field.get("label") or field_id
    max_length = field.get("max_length")
    if isinstance(value, str):
        if isinstance(max_length, int) and len(value) > max_length:
            raise ValueError(f"{label} aceita até {max_length} caracteres")
        partner = field.get("paired_with")
        if isinstance(partner, str) and _filled(value) and not _filled(values.get(partner)):
            raise ValueError(f"{label} precisa ser preenchido junto com {partner}")
    elif isinstance(value, list):
        if isinstance(max_length, int) and any(len(item) > max_length for item in value):
            raise ValueError(f"cada item de {label} aceita até {max_length} caracteres")
        minimum, maximum = field.get("min_items"), field.get("max_items")
        # An empty list means "not filled"; `required` is what forces at least one item.
        if value and isinstance(minimum, int) and len(value) < minimum:
            raise ValueError(f"{label} pede ao menos {minimum} itens")
        if isinstance(maximum, int) and len(value) > maximum:
            raise ValueError(f"{label} aceita até {maximum} itens")
        options = field.get("item_options")
        if isinstance(options, list):
            if any(item not in options for item in value):
                raise ValueError(f"{label} só aceita itens da lista do modelo")
            if len(value) != len(set(value)):
                raise ValueError(f"{label} tem itens repetidos")


def validate_sheet_values(values: dict[str, Any], fields: dict[str, dict[str, Any]]) -> None:
    """Check persisted sheet inputs against the approved template and storage limits."""
    if type(values) is not dict:
        raise ValueError("valores da ficha precisam ser um objeto")
    if any(not isinstance(field_id, str) for field_id in values):
        raise ValueError("ids dos campos precisam ser texto")
    if len(values) > MAX_SHEET_VALUES_FIELDS:
        raise ValueError("valores da ficha excedem 200 campos")
    try:
        encoded = json.dumps(values, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("valores da ficha precisam ser JSON válido") from error
    if len(encoded) > MAX_SHEET_VALUES_BYTES:
        raise ValueError("valores da ficha excedem 32 KB")

    unknown = set(values) - set(fields)
    if unknown:
        raise ValueError(f"campo desconhecido: {sorted(unknown)[0]}")

    for field_id, field in fields.items():
        kind = field.get("kind")
        active, options = _active_options(field_id, fields, values)
        present = field_id in values
        value = values.get(field_id)
        if not active:
            if present:
                raise ValueError(f"campo inativo não pode ter valor: {field_id}")
            continue

        required = field.get("required") is True and kind not in {"formula", "roll"}
        if required and (
            not present
            or value is None
            or (isinstance(value, str) and not value.strip())
            or (isinstance(value, list) and not value)
            or (kind == "checkbox" and value is not True)
        ):
            raise ValueError(f"campo obrigatório ausente: {field_id}")
        if not present:
            continue

        valid = False
        if kind == "text":
            valid = isinstance(value, str) and len(value) <= MAX_TEXT_LENGTH
        elif kind == "number":
            if type(value) is int:
                valid = abs(value) <= MAX_NUMBER_ABS
            elif type(value) is float:
                valid = math.isfinite(value) and abs(value) <= MAX_NUMBER_ABS
        elif kind == "select":
            valid = isinstance(value, str) and value in options
        elif kind == "checkbox":
            valid = isinstance(value, bool)
        elif kind == "collection":
            valid = (
                isinstance(value, list)
                and len(value) <= MAX_COLLECTION_ITEMS
                and all(isinstance(part, str) and len(part) <= MAX_COLLECTION_TEXT_LENGTH for part in value)
            )
        elif kind in {"formula", "roll"}:
            valid = value is None
        if not valid:
            raise ValueError(f"valor incompatível com o campo {field_id}")
        _check_text_constraints(field_id, field, value, values)
        if kind == "number":
            minimum, maximum = field.get("min"), field.get("max")
            if (isinstance(minimum, int) and value < minimum) or (isinstance(maximum, int) and value > maximum):
                label = field.get("label") or field_id
                raise ValueError(f"{label} precisa ficar entre {minimum if minimum is not None else '-∞'} e {maximum if maximum is not None else '∞'}")
