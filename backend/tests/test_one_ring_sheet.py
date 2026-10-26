"""O Um Anel 2ª edição v2 starter (tests/fixtures/one_ring_starter.json, generated from the frontend)."""

import json
from pathlib import Path

import pytest

from app.models import TemplateDraft
from app.services import one_ring
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_calculations import calculate_sheet
from app.services.sheet_creation import prepare_sheet_creation

SCHEMA = json.loads((Path(__file__).parent / "fixtures/one_ring_starter.json").read_text(encoding="utf-8"))
TEMPLATE = TemplateDraft.model_validate(SCHEMA)
RECORD = {"name": SCHEMA["name"], "version": 2, "schema": SCHEMA}


def hero(**changes):
    values = {"nome": "Bilba", "linhagem": "Hobbits do Condado", "corpo": 3, "coracao": 6, "astucia": 5,
              "base_vigor": 18, "base_esperanca": 10, "base_aparar": 12, "vigor_marcha": 21, "valor": 1, "sabedoria": 1,
              "stealth": 2, "courtesy": 2, "bonus_escudo": 0, "carga": 0, "cansaco": 0, "sombra": 0, "cicatrizes": 0, "pericias_favorecidas": ["Furtividade", "Cortesia"]}
    values.update(changes)
    return values


def test_one_ring_template_has_the_specific_rules():
    ids = {field.id for field in TEMPLATE.fields}
    assert {"corpo", "coracao", "astucia", "tn_corpo", "vigor_max", "esperanca_max", "aparar", "cansaco",
            "cicatrizes", "valor", "sabedoria", "virtudes", "recompensas", "machados", "arcos", "lancas", "espadas"} <= ids
    assert len([field for field in TEMPLATE.fields if field.creation_step == "skills" and field.kind.value == "number"]) == 22
    assert [rule.id for rule in TEMPLATE.creation_rules] == ["atributos", "cultura"]


def test_one_ring_creation_derives_with_the_template_formulas():
    values = hero()
    assert evaluate_creation_rules(TEMPLATE.creation_rules, values) == []
    _, _, prepared = prepare_sheet_creation(RECORD, "Bilba", values)
    calculated = calculate_sheet(TEMPLATE, prepared)
    expected = one_ring.derived(prepared)
    for field_id, value in expected.items():
        assert calculated[field_id] == value
    assert (calculated["tn_corpo"], calculated["vigor_max"], calculated["aparar"]) == (17, 21, 17)


@pytest.mark.parametrize("change,rule", [({"corpo": 4}, "atributos"), ({"base_vigor": 20}, "cultura")])
def test_one_ring_creation_rejects_wrong_totals_and_culture_bases(change, rule):
    assert rule in [item.rule_id for item in evaluate_creation_rules(TEMPLATE.creation_rules, hero(**change))]


@pytest.mark.parametrize("change,fragment", [
    ({"pericias_favorecidas": ["Furtividade", "Cortesia", "Cura", "Enigmas"]}, "até 3 itens"),
    ({"pericias_favorecidas": ["Voar"]}, "lista do modelo"),
    ({"corpo": 8, "astucia": 0}, "entre 2 e 7"),
    ({"virtudes": ["v" * 121]}, "120 caracteres"),
])
def test_one_ring_field_limits(change, fragment):
    with pytest.raises(ValueError, match=fragment):
        prepare_sheet_creation(RECORD, "Bilba", hero(**change))


def test_culture_table_matches_the_template_grants():
    rule = TEMPLATE.creation_rules[1]
    assert {case.equals: tuple(case.add[key] for key in ("base_vigor", "base_esperanca", "base_aparar"))
            for case in rule.cases} == one_ring.CULTURES
