import json
from pathlib import Path

import pytest

from app.models import TemplateDraft
from app.services.creation_rules import evaluate_creation_rules
from app.services.hunter_traits import HUNTER_EDGES, template_creation_problems
from app.services.sheet_creation import prepare_sheet_creation
from app.services.sheet_calculations import calculate_sheet

SCHEMA = json.loads((Path(__file__).parent / "fixtures/hunter_starter.json").read_text(encoding="utf-8"))
TEMPLATE = TemplateDraft.model_validate(SCHEMA)
RECORD = {"name": SCHEMA["name"], "version": 4, "schema": SCHEMA}
RULES = {rule.id: rule for rule in TEMPLATE.creation_rules}
LABELS = {field.id: field.label for field in TEMPLATE.fields}
REQUIRED_SPECIALTIES = ["ciencia", "academicos", "oficios", "performance"]


def values_for_mode(index):
    attributes, skills = RULES["atributos"], RULES["habilidades"]
    values = {"nome": "Mara", "credo": "Inquisitivo", "impulso": "Curiosidade",
              "conviccao_1": "Nunca deixar um inocente para trás", "pedra_toque_1": "Irmã Clara",
              "vantagens": ["Contatos: polícia ••", "Aliados •••", "Linguística ••"], "defeitos": ["Segredo Sombrio ••"],
              "triunfos": ["Arsenal", "Biblioteca"], "distincoes": ["Arsenal: Especializado"],
              "equipamento": ["Lanterna tática", "Kit de primeiros socorros"]}
    values.update(zip(attributes.fields, [4, 3, 3, 3, 2, 2, 2, 2, 1]))
    values.update(dict.fromkeys(skills.fields, 0))
    points = [int(value) for value, count in skills.options[index].counts.items() for _ in range(count)]
    values.update(zip(skills.fields, points))
    with_dots = [field for field in REQUIRED_SPECIALTIES if values[field] > 0]
    free = next(field for field in skills.fields if values[field] > 0)
    values["especialidades"] = [f"{LABELS[field]} (foco)" for field in with_dots] + [f"{LABELS[free]} (segunda área)"]
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
    assert template_creation_problems(TEMPLATE.system_key, TEMPLATE.version, set(LABELS), prepared) == []


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
    ({"desespero": 3}, "desconhecido|desespero"),
    ({"triunfos": ["Arsenal", "Voo Livre"]}, "Triunfos .* lista do modelo"),
])
def test_hunter_v4_structured_traits_are_enforced(change, fragment):
    values = {**values_for_mode(0), **change}
    with pytest.raises(ValueError, match=fragment):
        prepare_sheet_creation(RECORD, "Mara", values)


@pytest.mark.parametrize("change,rule_id", [
    ({"especialidades": []}, "especializacoes"),
    ({"vantagens": ["Aliados •••"]}, "vantagens_pontos"),
    ({"vantagens": ["Poder Secreto •••••••"]}, "vantagens_pontos"),
    ({"defeitos": []}, "defeitos_pontos"),
])
def test_hunter_specialties_advantages_and_flaws_follow_the_rules(change, rule_id):
    values = {**values_for_mode(0), **change}
    assert rule_id in [issue.rule_id for issue in evaluate_creation_rules(TEMPLATE.creation_rules, values)]


def test_hunter_v4_has_no_sheet_desperation_and_lists_edges():
    fields = {field.id: field for field in TEMPLATE.fields}
    assert TEMPLATE.version == 4
    assert "desespero" not in fields
    assert fields["em_desespero"].kind.value == "checkbox"
    assert fields["triunfos"].item_options == list(HUNTER_EDGES)
    assert "Arsenal: Especializado" in fields["distincoes"].item_options
    assert fields["equipamento"].kind.value == "collection"


@pytest.mark.parametrize("change,fragment", [
    ({"triunfos": ["Arsenal"], "distincoes": []}, "Na criação"),
    ({"triunfos": ["Arsenal", "Frota"], "distincoes": ["Arsenal: Excepcional", "Frota: Blindagem"]}, "Na criação"),
    ({"distincoes": ["Frota: Blindagem"]}, "pede o Triunfo Frota"),
])
def test_hunter_creation_checks_the_starting_edges_and_perks(change, fragment):
    values = {**values_for_mode(0), **change}
    _, _, prepared = prepare_sheet_creation(RECORD, "Mara", values)
    problems = template_creation_problems(TEMPLATE.system_key, TEMPLATE.version, set(LABELS), prepared)
    assert any(fragment in problem for problem in problems)


def test_one_edge_with_two_perks_and_despair_state_are_accepted():
    values = {**values_for_mode(1), "em_desespero": True, "redencao": "Reparar o que destruí",
              "triunfos": ["Sentir o Sobrenatural"], "distincoes": ["Sentir o Sobrenatural: Alcance", "Sentir o Sobrenatural: Precisão"],
              "conviccao_2": "b", "pedra_toque_2": "c", "conviccao_3": "d", "pedra_toque_3": "e"}
    _, _, prepared = prepare_sheet_creation(RECORD, "Mara", values)
    assert prepared["em_desespero"] is True
    assert template_creation_problems(TEMPLATE.system_key, TEMPLATE.version, set(LABELS), prepared) == []
    assert "pilares" not in {field.id for field in TEMPLATE.fields}


def test_older_hunter_templates_skip_the_edge_count():
    values = {"credo": "Marcial", "impulso": "Juramento", "conviccao_1": "a", "pedra_toque_1": "b"}
    assert template_creation_problems("hunter", 3, {"conviccao_1", "triunfos"}, values) == []
    assert template_creation_problems("vampire-v5", 4, {"nome"}, {}) == []
