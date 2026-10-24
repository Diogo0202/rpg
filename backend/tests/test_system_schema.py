import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.services.marketplace import PublishRequest, validate_publication


def publication():
    return {"template": {
        "name": "Sistema original", "version": 1,
        "primitives": [{"id": "vigor", "label": "Vigor", "kind": "number", "min": 0, "max": 10}],
        "computed_stats": [{"id": "vida", "label": "Vida", "kind": "formula", "expression": "vigor * 2 + 5"}],
        "inventory_schema": [{"id": "peso", "label": "Peso", "kind": "number", "min": 0}],
    }, "description": "Regras originais da comunidade", "tags": ["fantasia"], "author_name": "Autor", "rights_confirmed": True}


def test_partitions_compile_to_existing_fields_and_preserve_item_schema():
    record = validate_publication(PublishRequest.model_validate(publication()))
    assert [field["id"] for field in record["template"]["fields"]] == ["vigor", "vida"]
    assert record["template"]["inventory_schema"][0]["id"] == "peso"
    assert record["automation_level"] == "formulas"


@pytest.mark.parametrize("change", ["duplicate", "extra", "wrong_kind", "mixed_contract", "item_formula"])
def test_partition_validation_does_not_discard_invalid_schema(change):
    body = publication()
    if change == "duplicate":
        body["template"]["computed_stats"][0]["id"] = "vigor"
    elif change == "extra":
        body["template"]["primitives"][0]["execute"] = "arbitrary code"
    elif change == "wrong_kind":
        body["template"]["computed_stats"][0] = {"id": "vida", "label": "Vida", "kind": "number"}
    elif change == "mixed_contract":
        body["template"]["fields"] = body["template"]["primitives"]
    else:
        body["template"]["inventory_schema"][0] = {"id": "peso", "label": "Peso", "kind": "formula", "expression": "1+1"}
    with pytest.raises((ValidationError, HTTPException)):
        validate_publication(PublishRequest.model_validate(body))


def test_canonical_contract_remains_accepted_with_inventory_schema():
    body = publication()
    body["template"]["fields"] = body["template"].pop("primitives") + body["template"].pop("computed_stats")
    assert validate_publication(PublishRequest.model_validate(body))["template"]["inventory_schema"][0]["id"] == "peso"
