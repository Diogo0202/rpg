"""Clan and predator grants and locked power lists, on the real V5 starter.

tests/fixtures/v5_starter.json is the frontend starter (frontend/lib/system-starters.ts);
frontend/tests/creation-grants.test.mjs fails when the two drift apart.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.models import TemplateDraft
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_creation import prepare_sheet_creation

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "v5_starter.json").read_text(encoding="utf-8"))


def stored() -> dict[str, Any]:
    template = json.loads(json.dumps(FIXTURE["template"]))
    return {"name": template["name"], "version": 1, "schema": template}


def draft() -> TemplateDraft:
    return TemplateDraft.model_validate({**stored()["schema"]})


def valid_values() -> dict[str, Any]:
    """Brujah Blood Leech: Rapidez 1 + predator pick, Humanity 7 - 1."""
    values: dict[str, Any] = {key: value for key, value in FIXTURE["values"].items()}
    values.update(dict(zip(["forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole", "inteligencia", "raciocinio", "resolucao"],
                           [4, 3, 3, 3, 2, 2, 2, 2, 1])))
    values.update(dict(zip(["atletismo", "briga", "conducao", "furtividade", "ladroagem", "oficios", "sobrevivencia", "armas_brancas",
                            "armas_de_fogo", "etiqueta"], [4, 3, 3, 3, 2, 2, 2, 1, 1, 1])))
    values.update(cla="Brujah", predador="Sanguessuga", predador_disciplina="Rapidez", predador_especialidade="Briga (Membros)",
                  disc_potencia=1, disc_presenca=1, disc_rapidez=2, humanidade=6,
                  especialidades=["Briga (Membros)"],
                  defeitos=["Segredo Sombrio: Diablerista •• ou Rejeitado ••", "Exclusão de Presa: mortais ••"],
                  disciplinas=["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Ligeireza"])
    return values


def rule_ids(values: dict[str, Any]) -> list[str]:
    return sorted(item.rule_id for item in evaluate_creation_rules(draft().creation_rules, values))


def test_starter_parses_and_a_full_brujah_passes() -> None:
    assert rule_ids(valid_values()) == []
    _, name, values = prepare_sheet_creation(stored(), "Mara", valid_values())
    assert name == "Mara" and values["disc_rapidez"] == 2


@pytest.mark.parametrize("change, rule", [
    ({"disc_dominacao": 1}, "cla_disciplinas"),                 # an off-clan discipline
    ({"disc_rapidez": 3}, "cla_disciplinas"),                   # one dot too many
    ({"humanidade": 7}, "predador_bonus"),                      # Blood Leech loses one
    ({"predador_disciplina": "Dominação"}, "predador_bonus"),   # not a Blood Leech option
    ({"defeitos": []}, "predador_bonus"),                       # granted flaws removed
    ({"especialidades": []}, "predador_bonus"),
])
def test_tampered_grants_are_refused(change: dict[str, Any], rule: str) -> None:
    assert rule in rule_ids({**valid_values(), **change})


def test_clan_only_predator_option_needs_the_clan() -> None:
    values = {**valid_values(), "predador": "Ensacador", "predador_disciplina": "Feitiçaria do Sangue",
              "predador_especialidade": "Manha (Mercado negro)", "humanidade": 7, "disc_rapidez": 1, "disc_feiticaria": 1,
              "especialidades": ["Manha (Mercado negro)"], "vantagens": ["Estômago de Ferro •••"], "defeitos": ["Inimigo ••"]}
    messages = [item.message for item in evaluate_creation_rules(draft().creation_rules, values) if item.rule_id == "predador_bonus"]
    assert messages and "disciplina bônus" in messages[0]


@pytest.mark.parametrize("powers, reason", [
    (["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina"], "pede 2"),          # one Rapidez power short
    (["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Piscar"], "nível 3"),
    (["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Voar"], "não está na lista"),
    (["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Graça Felina"], "repetidos"),
    (["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Ligeireza", "Dominação: Compelir"], "Compelir pede nível 1"),  # no Dominação dots
])
def test_powers_come_from_the_locked_list(powers: list[str], reason: str) -> None:
    violations = [item for item in evaluate_creation_rules(draft().creation_rules, {**valid_values(), "disciplinas": powers}) if item.rule_id == "poderes"]
    assert violations and reason in violations[0].message


def test_tremere_needs_one_level_one_ritual() -> None:
    values = {**valid_values(), "cla": "Tremere", "disc_potencia": 0, "disc_presenca": 0, "disc_auspicios": 1, "disc_dominacao": 1,
              "disc_feiticaria": 1, "disc_rapidez": 1,
              "disciplinas": ["Auspícios: Sentidos Aguçados", "Dominação: Compelir", "Feitiçaria do Sangue: Vitae Corrosiva", "Rapidez: Graça Felina"]}
    assert rule_ids(values) == ["rituais_iniciais"]
    assert rule_ids({**values, "rituais": ["Feitiçaria do Sangue: Caminhada de Sangue"]}) == []
    assert rule_ids({**values, "rituais": ["Feitiçaria do Sangue: Olhos de Babel"]}) == ["rituais_iniciais"]


def test_homebrew_clan_case_is_enforced_like_an_official_one() -> None:
    schema = stored()["schema"]
    schema["fields"].append({"id": "disc_vapor_rubro", "label": "Vapor Rubro", "kind": "number", "required": False, "options": [],
                             "expression": None, "min": 0, "max": 5, "creation_step": "traits"})
    next(field for field in schema["fields"] if field["id"] == "cla")["options"].append("Filhos da Fuligem")
    clan_rule = next(rule for rule in schema["creation_rules"] if rule["id"] == "cla_disciplinas")
    clan_rule["fields"].append("disc_vapor_rubro")
    clan_rule["cases"].append({"equals": "Filhos da Fuligem", "add": {"disc_vapor_rubro": 1, "disc_fortitude": 1}, "homebrew": True})
    powers = next(rule for rule in schema["creation_rules"] if rule["id"] == "poderes")
    powers["fields"].append("disc_vapor_rubro")
    powers["sources"].append({"field": "disc_vapor_rubro", "label": "Vapor Rubro", "count": "dots", "max_level": "dots",
                              "powers": [{"name": "Névoa de Brasas", "level": 1}]})
    parsed = TemplateDraft.model_validate(schema)
    values = {**valid_values(), "cla": "Filhos da Fuligem", "disc_potencia": 0, "disc_presenca": 0, "disc_rapidez": 1,
              "disc_fortitude": 1, "disc_vapor_rubro": 1,
              "disciplinas": ["Fortitude: Resiliência", "Rapidez: Graça Felina", "Vapor Rubro: Névoa de Brasas"]}
    assert evaluate_creation_rules(parsed.creation_rules, values) == []
    # Two dots are not what the clan grants, and they would also ask for a second power.
    assert sorted(item.rule_id for item in evaluate_creation_rules(parsed.creation_rules, {**values, "disc_vapor_rubro": 2})) == ["cla_disciplinas", "poderes"]


@pytest.mark.parametrize("mutate", [
    lambda rules: rules[2].update(field="nome"),                                         # controller must be a select
    lambda rules: rules[2]["cases"][0]["add"].update(nome=1),                            # adds go to number fields
    lambda rules: rules[3]["cases"][0]["items"].update(nome=["x"]),                      # items go to collections
    lambda rules: rules[4].update(collection="nome"),                                    # powers live in a collection
    lambda rules: rules[4]["sources"][0].update(label="Com: dois-pontos"),
    lambda rules: rules[2]["cases"].append(dict(rules[2]["cases"][0])),                  # duplicated case
])
def test_invalid_grant_declarations_are_rejected(mutate) -> None:
    schema = stored()["schema"]
    mutate(schema["creation_rules"])
    with pytest.raises(ValidationError):
        TemplateDraft.model_validate(schema)
