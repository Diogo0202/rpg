"""Structured text limits on template fields (max_length, items, item_options, paired_with)."""

import pytest
from pydantic import ValidationError

from app.models import TemplateDraft, TemplateField
from app.services.sheet_values import validate_sheet_values

FIELDS = {
    "lema": {"id": "lema", "label": "Lema", "kind": "text", "max_length": 5, "paired_with": "fonte"},
    "fonte": {"id": "fonte", "label": "Fonte", "kind": "text", "paired_with": "lema"},
    "tags": {"id": "tags", "label": "Tags", "kind": "collection", "max_length": 3, "min_items": 2, "max_items": 3,
             "item_options": ["a", "b", "c", "dddd"]},
}


def test_valid_structured_values_pass():
    validate_sheet_values({"lema": "abc", "fonte": "x", "tags": ["a", "b"]}, FIELDS)
    validate_sheet_values({"tags": []}, FIELDS)


@pytest.mark.parametrize("values,fragment", [
    ({"lema": "abcdef", "fonte": "x"}, "até 5 caracteres"),
    ({"lema": "abc"}, "junto com fonte"),
    ({"fonte": "x", "lema": " "}, "junto com lema"),
    ({"tags": ["a"]}, "ao menos 2"),
    ({"tags": ["a", "b", "c", "a"]}, "até 3 itens"),
    ({"tags": ["a", "z"]}, "lista do modelo"),
    ({"tags": ["a", "a"]}, "repetidos"),
    ({"tags": ["a", "dddd"]}, "até 3 caracteres"),
])
def test_structured_values_are_rejected(values, fragment):
    with pytest.raises(ValueError, match=fragment):
        validate_sheet_values(values, FIELDS)


@pytest.mark.parametrize("definition", [
    {"id": "n", "label": "N", "kind": "number", "max_length": 3},
    {"id": "tx", "label": "T", "kind": "text", "max_items": 3},
    {"id": "co", "label": "C", "kind": "collection", "min_items": 3, "max_items": 2},
    {"id": "co", "label": "C", "kind": "collection", "item_options": ["a", "a"]},
    {"id": "tx", "label": "T", "kind": "text", "paired_with": "tx"},
])
def test_template_rejects_misplaced_constraints(definition):
    with pytest.raises(ValidationError):
        TemplateField.model_validate(definition)


def test_paired_with_must_reference_a_text_field():
    with pytest.raises(ValidationError):
        TemplateDraft.model_validate({"name": "Teste", "fields": [
            {"id": "lema", "label": "Lema", "kind": "text", "paired_with": "nivel"},
            {"id": "nivel", "label": "Nível", "kind": "number"}]})
