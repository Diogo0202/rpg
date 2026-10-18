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
        required = field.get("required") is True and kind not in {"formula", "roll"}
        present = field_id in values
        value = values.get(field_id)
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
            options = field.get("options")
            valid = isinstance(value, str) and isinstance(options, list) and value in options
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
