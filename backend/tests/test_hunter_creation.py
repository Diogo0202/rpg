import json
from pathlib import Path

import pytest

from app.models import TemplateDraft
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_creation import prepare_sheet_creation
from app.services.sheet_calculations import calculate_sheet

SCHEMA = json.loads((Path(__file__).parent / "fixtures/hunter_starter.json").read_text(encoding="utf-8"))
TEMPLATE = TemplateDraft.model_validate(SCHEMA)
RECORD = {"name": SCHEMA["name"], "version": 2, "schema": SCHEMA}


def values_for_mode(index):
    attributes, skills = TEMPLATE.creation_rules
    values = {"nome": "Mara", "credo": "Inquisitivo", "impulso": "Curiosidade"}
    values.update(zip(attributes.fields, [4, 3, 3, 3, 2, 2, 2, 2, 1]))
    values.update(dict.fromkeys(skills.fields, 0))
    points = [int(value) for value, count in skills.options[index].counts.items() for _ in range(count)]
    values.update(zip(skills.fields, points))
    return values


@pytest.mark.parametrize("mode", [0, 1, 2])
def test_hunter_accepts_each_exact_distribution_and_derives_resources(mode):
    values = values_for_mode(mode)
    assert evaluate_creation_rules(TEMPLATE.creation_rules, values) == []
    _, name, prepared = prepare_sheet_creation(RECORD, "Mara", values)
    assert name == "Mara"
    assert prepared["vigor"] == 3
    assert prepared["resolucao"] == 1
    calculated = calculate_sheet(TEMPLATE, prepared)
    assert calculated["saude_max"] == 6
    assert calculated["vontade_max"] == 3


@pytest.mark.parametrize("group,field_id", [("atributos", "forca"), ("habilidades", "briga")])
def test_hunter_refuses_points_outside_distribution(group, field_id):
    values = values_for_mode(0)
    values[field_id] = 5
    assert group in [issue.rule_id for issue in evaluate_creation_rules(TEMPLATE.creation_rules, values)]
    with pytest.raises(ValueError):
        prepare_sheet_creation(RECORD, "Mara", values)


def test_hunter_requires_a_valid_drive_and_creed():
    values = values_for_mode(0)
    values["impulso"] = "valor não cadastrado"
    with pytest.raises(ValueError):
        prepare_sheet_creation(RECORD, "Mara", values)
