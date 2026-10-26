import json
from pathlib import Path

import pytest

from app.models import TemplateDraft
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_creation import prepare_sheet_creation


SCHEMA = json.loads((Path(__file__).parent / "fixtures/demon_fallen_starter.json").read_text(encoding="utf-8"))
TEMPLATE = TemplateDraft.model_validate(SCHEMA)
RULE = TEMPLATE.creation_rules[0]


def valid_values():
    values = {"nome": "Auriel", "casa": "Flagelos", "tormento_permanente": 3}
    groups = RULE.pools
    for pool in groups:
        for group in pool.groups:
            values.update({field_id: pool.base for field_id in group.fields})
    attributes = groups[0].groups
    for group, ratings in zip(attributes, ([4, 3, 3], [3, 3, 2], [2, 2, 2])):
        values.update(dict(zip(group.fields, ratings)))
    abilities = groups[1].groups
    for group, ratings in zip(abilities, ([3, 3, 3, 3, 1], [3, 3, 3], [3, 2])):
        values.update(dict(zip(group.fields, ratings)))
    values[groups[2].groups[0].fields[0]] = 5
    values["dou_ventos"] = 3
    values.update({"consciencia": 3, "conviccao": 2, "coragem": 1})
    values["fe_permanente"] = 3
    values["vontade_max"] = 5
    # 5 attribute + 2 ability + 7 lore + 1 background = 15 freebie points.
    values[attributes[0].fields[0]] += 1
    values[abilities[0].fields[0]] += 1
    values["dou_ventos"] += 1
    values[groups[2].groups[0].fields[1]] += 1
    return values


def test_starter_creates_a_sheet_with_fifteen_freebies():
    values = valid_values()
    assert len(TEMPLATE.fields) == 106
    assert evaluate_creation_rules(TEMPLATE.creation_rules, values) == []
    _, name, saved = prepare_sheet_creation({"name": SCHEMA["name"], "version": 1, "schema": SCHEMA}, "Auriel", values)
    assert name == saved["nome"] == "Auriel"
    assert saved["vontade_max"] == 5


@pytest.mark.parametrize("changes", [
    {"vontade_max": 4},
    {"fe_permanente": 2},
    {"consciencia": 0},
    {"forca": 6},
    {"tormento_permanente": 4},
])
def test_invalid_creation_is_rejected(changes):
    with pytest.raises(ValueError):
        prepare_sheet_creation({"name": SCHEMA["name"], "version": 1, "schema": SCHEMA}, "Auriel", {**valid_values(), **changes})


def test_willpower_tracks_the_two_highest_virtues():
    values = valid_values()
    values.update({"consciencia": 1, "conviccao": 3, "coragem": 2})
    assert evaluate_creation_rules(TEMPLATE.creation_rules, values) == []
    values["vontade_max"] = 6
    assert [issue.rule_id for issue in evaluate_creation_rules(TEMPLATE.creation_rules, values)] == ["criacao_demonio"]


def test_house_limits_lores_and_sets_initial_torment():
    values = valid_values()
    values["dou_ventos"] = 0
    values["dou_carne"] = 4
    assert "criacao_demonio" in [issue.rule_id for issue in evaluate_creation_rules(TEMPLATE.creation_rules, values)]
    values = valid_values()
    values["casa"] = "Diabos"
    values["tormento_permanente"] = 4
    values["dou_ventos"] = 0
    values["dou_celestiais"] = 4
    assert evaluate_creation_rules(TEMPLATE.creation_rules, values) == []
