import json
from pathlib import Path

import pytest

from app.models import TemplateDraft
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_creation import prepare_sheet_creation
from app.services.sheet_calculations import calculate_sheet

SCHEMA = json.loads((Path(__file__).parent / "fixtures/hunter_starter.json").read_text(encoding="utf-8"))
TEMPLATE = TemplateDraft.model_validate(SCHEMA)
RECORD = {"name": SCHEMA["name"], "version": 3, "schema": SCHEMA}


def values_for_mode(index):
    attributes, skills = TEMPLATE.creation_rules
    values = {"nome": "Mara", "credo": "Inquisitivo", "impulso": "Curiosidade",
              "conviccao_1": "Nunca deixar um inocente para trás", "pedra_toque_1": "Irmã Clara"}
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


@pytest.mark.parametrize("change,fragment", [
    ({"pedra_toque_1": ""}, "obrigatório|junto com pedra_toque_1"),
    ({"conviccao_2": "Proteger a célula"}, "junto com pedra_toque_2"),
    ({"conviccao_1": "x" * 161}, "160 caracteres"),
    ({"redencao": "y" * 241}, "240 caracteres"),
    ({"credo": "Livre"}, "incompatível"),
    ({"desespero": 6}, "entre 0 e 5"),
])
def test_hunter_v3_structured_traits_are_enforced(change, fragment):
    values = {**values_for_mode(0), **change}
    with pytest.raises(ValueError, match=fragment):
        prepare_sheet_creation(RECORD, "Mara", values)


def test_hunter_v3_accepts_three_complete_pairs_and_despair_state():
    values = {**values_for_mode(1), "em_desespero": True, "desespero": 3, "redencao": "Reparar o que destruí",
              "conviccao_2": "b", "pedra_toque_2": "c", "conviccao_3": "d", "pedra_toque_3": "e"}
    _, _, prepared = prepare_sheet_creation(RECORD, "Mara", values)
    assert prepared["em_desespero"] is True
    assert "pilares" not in {field.id for field in TEMPLATE.fields}
