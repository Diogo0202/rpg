from __future__ import annotations

import pytest

from app.services.sheet_values import validate_sheet_values


FIELDS = {
    "name": {"kind": "text", "required": True},
    "score": {"kind": "number"},
    "clan": {"kind": "select", "options": ["Brujah", "Toreador"]},
    "active": {"kind": "checkbox"},
    "items": {"kind": "collection"},
    "pool": {"kind": "formula", "required": True},
    "check": {"kind": "roll"},
}


def test_accepts_values_within_contract_and_calculated_null() -> None:
    validate_sheet_values(
        {"name": "n" * 10_000, "score": 1_000_000, "clan": "Brujah", "active": True,
         "items": ["x"] * 200, "pool": None, "check": None},
        FIELDS,
    )


@pytest.mark.parametrize(
    "values",
    [
        {"name": "Mara", "extra": 1},
        {"name": ""},
        {"name": None},
        {"name": "x" * 10_001},
        {"name": "Mara", "score": True},
        {"name": "Mara", "score": 1_000_001},
        {"name": "Mara", "score": float("inf")},
        {"name": "Mara", "clan": "Ventrue"},
        {"name": "Mara", "items": ["x"] * 201},
        {"name": "Mara", "items": ["x" * 501]},
        {"name": "Mara", "items": [1]},
        {"name": "Mara", "pool": 9},
        {},
        {"name": "Mara", **{f"f{i}": "x" for i in range(200)}},
    ],
)
def test_rejects_unknown_invalid_or_out_of_range_values(values: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        validate_sheet_values(values, FIELDS)


def test_rejects_values_payload_over_32_kib() -> None:
    fields = {f"f{i}": {"kind": "text"} for i in range(4)}
    values = {field_id: "x" * 10_000 for field_id in fields}
    with pytest.raises(ValueError, match="32 KB"):
        validate_sheet_values(values, fields)


def test_required_checkbox_must_be_true() -> None:
    with pytest.raises(ValueError, match="obrigatório"):
        validate_sheet_values({"name": "Mara", "active": False}, {**FIELDS, "active": {"kind": "checkbox", "required": True}})
