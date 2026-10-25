import json
from pathlib import Path

import pytest

from app.models import TemplateDraft
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_calculations import calculate_sheet
from app.services.sheet_creation import prepare_sheet_creation

SCHEMA = json.loads((Path(__file__).parent / "fixtures/sotdl_starter.json").read_text(encoding="utf-8"))
TEMPLATE = TemplateDraft.model_validate(SCHEMA)
RECORD = {"name": SCHEMA["name"], "version": 1, "schema": SCHEMA}
RULE = TEMPLATE.creation_rules[0]
CHOICE = {"Humano": "Força +1", "Autômato": "Intelecto +2"}


def values_for(ancestry):
    """Level 0 values: rule base plus the ancestry adds and its chosen attribute raise."""
    case = next(item for item in RULE.cases if item.equals == ancestry)
    numbers = {field_id: RULE.base.get(field_id, 0) for field_id in RULE.fields}
    grants = [case.add]
    if ancestry in CHOICE:
        grants.append(next(option.add for option in case.choices[0].options if option.label == CHOICE[ancestry]))
    for add in grants:
        for field_id, amount in add.items():
            numbers[field_id] += amount
    values = {"nome": "Irmã Martha", "ancestralidade": ancestry, "fe": "Cristão", **numbers}
    if ancestry in CHOICE:
        values["ancestralidade_atributo"] = CHOICE[ancestry]
    return values


@pytest.mark.parametrize("ancestry", [item.equals for item in RULE.cases])
def test_each_ancestry_creates_a_level_zero_sheet(ancestry):
    values = values_for(ancestry)
    assert evaluate_creation_rules(TEMPLATE.creation_rules, values) == []
    _, name, prepared = prepare_sheet_creation(RECORD, "Irmã Martha", values)
    assert name == "Irmã Martha"
    calculated = calculate_sheet(TEMPLATE, prepared)
    assert calculated["defesa"] == prepared["agilidade"] + prepared["bonus_defesa"]
    assert calculated["saude"] == prepared["forca"] + prepared["bonus_saude"]
    assert calculated["mod_agilidade"] == prepared["agilidade"] - 10
    assert calculated["cura"] == calculated["saude"] // 4


def test_goblin_and_dwarf_numbers():
    goblin = calculate_sheet(TEMPLATE, prepare_sheet_creation(RECORD, "Vorek", values_for("Goblin"))[2])
    assert (goblin["forca"], goblin["agilidade"], goblin["mod_agilidade"], goblin["percepcao"]) == (8, 12, 2, 11)
    dwarf = calculate_sheet(TEMPLATE, prepare_sheet_creation(RECORD, "Baltazar", values_for("Anão"))[2])
    assert (dwarf["saude"], dwarf["deslocamento"], dwarf["cura"]) == (14, 8, 3)


def test_attributes_must_match_the_ancestry():
    values = values_for("Orc")
    values["forca"] = 14
    assert "ancestralidade" in [issue.rule_id for issue in evaluate_creation_rules(TEMPLATE.creation_rules, values)]
    with pytest.raises(ValueError):
        prepare_sheet_creation(RECORD, "Alaric", values)


def test_human_must_pick_the_raised_attribute():
    values = values_for("Humano")
    del values["ancestralidade_atributo"]
    with pytest.raises(ValueError):
        prepare_sheet_creation(RECORD, "Alaric", values)
