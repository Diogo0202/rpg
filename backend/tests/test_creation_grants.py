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
    """Brujah Blood Leech of the 13th generation: Rapidez 1 + predator pick, Humanity 7 - 1, Blood Potency 1 + 1,
    7 points of own advantages (Resources included) and 2 of own flaws besides the predator's."""
    values: dict[str, Any] = {key: value for key, value in FIXTURE["values"].items()}
    values.update(dict(zip(["forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole", "inteligencia", "raciocinio", "resolucao"],
                           [4, 3, 3, 3, 2, 2, 2, 2, 1])))
    values.update(dict(zip(["atletismo", "briga", "conducao", "furtividade", "ladroagem", "oficios", "sobrevivencia", "armas_brancas",
                            "armas_de_fogo", "etiqueta"], [4, 3, 3, 3, 2, 2, 2, 1, 1, 1])))
    values.update(cla="Brujah", predador="Sanguessuga", predador_disciplina="Rapidez", predador_especialidade="Briga (Membros)",
                  disc_potencia=1, disc_presenca=1, disc_rapidez=2, humanidade=6, geracao=13, potencia_sangue=2, recursos=1,
                  especialidades=["Briga (Membros)", "Ofícios (Marcenaria)", "Atletismo (Corrida)"],
                  vantagens=["Aliados •••", "Refúgio (2)", "Contatos 1"],
                  defeitos=["Segredo Sombrio: Diablerista •• ou Rejeitado ••", "Exclusão de Presa: mortais ••", "Vício Irremediável ••"],
                  disciplinas=["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Ligeireza"])
    return values


@pytest.mark.parametrize("generation, potency", [(16, 1), (14, 1), (13, 2), (12, 2), (11, 3), (10, 3)])
def test_blood_potency_follows_generation_plus_the_predator(generation: int, potency: int) -> None:
    values = {**valid_values(), "geracao": generation, "potencia_sangue": potency}
    # The band holds; a Brujah of the 14th-16th generation is refused only by the clan-generation rule.
    assert rule_ids(values) == ([] if generation <= 13 else ["cla_geracao"])
    assert "predador_bonus" in rule_ids({**values, "potencia_sangue": potency - 1})


def thin_blood() -> dict[str, Any]:
    """Thin-blooded Consensualista of the 15th generation: Thin-Blood Alchemy 1, Auspícios from the predator, Potency 0."""
    return {**valid_values(), "cla": "Sangue-Ralo", "predador": "Consensualista", "predador_disciplina": "Auspícios",
            "predador_especialidade": "Medicina (Flebotomia)", "geracao": 15, "potencia_sangue": 0, "humanidade": 8,
            "disc_potencia": 0, "disc_presenca": 0, "disc_rapidez": 0, "disc_alquimia": 1, "disc_auspicios": 1, "medicina": 0,
            "especialidades": ["Medicina (Flebotomia)", "Ofícios (Marcenaria)", "Atletismo (Corrida)"],
            "defeitos": ["Segredo Sombrio: quebra da Máscara •", "Exclusão de Presa: quem não consente •", "Analfabeto ••"],
            "disciplinas": ["Alquimia do Sangue-Ralo: Longo Alcance", "Auspícios: Sentidos Aguçados"]}


def test_clan_and_generation_must_match() -> None:
    assert rule_ids(thin_blood()) == []
    messages = [item.message for item in evaluate_creation_rules(draft().creation_rules, {**thin_blood(), "geracao": 13, "potencia_sangue": 1},
                                                                  {"geracao": "Geração"}) if item.rule_id == "cla_geracao"]
    assert messages and "Geração deve ficar entre 14 e 16 para Sangue-Ralo" in messages[0]
    # Caitiff are allowed, in the starting generations of every other clan.
    caitiff = {**valid_values(), "cla": "Caitiff", "caitiff_disciplina_1": "Potência", "caitiff_disciplina_2": "Presença",
               "caitiff_disciplina_3": "Rapidez"}
    assert rule_ids(caitiff) == []
    assert rule_ids({**caitiff, "geracao": 14, "potencia_sangue": 1}) == ["cla_geracao"]


def test_thin_blood_refuses_the_blood_potency_predator() -> None:
    values = {**thin_blood(), "predador": "Sanguessuga", "predador_disciplina": "Rapidez", "predador_especialidade": "Briga (Membros)",
              "potencia_sangue": 1, "humanidade": 6, "disc_auspicios": 0, "disc_rapidez": 1, "medicina": 0,
              "especialidades": ["Briga (Membros)", "Ofícios (Marcenaria)", "Atletismo (Corrida)"],
              "defeitos": ["Segredo Sombrio: Diablerista •• ou Rejeitado ••", "Exclusão de Presa: mortais ••", "Analfabeto ••"],
              "disciplinas": ["Alquimia do Sangue-Ralo: Longo Alcance", "Rapidez: Graça Felina"]}
    violations = evaluate_creation_rules(draft().creation_rules, values, {"predador": "Tipo de predador"})
    assert [item.rule_id for item in violations] == ["cla_geracao"]
    assert "Tipo de predador Sanguessuga não combina com Sangue-Ralo" in violations[0].message


@pytest.mark.parametrize("specialties, reason", [
    (["Briga (Membros)", "Atletismo (Corrida)"], "falta especialização em Ofícios"),
    (["Briga (Membros)", "Ofícios (Marcenaria)"], "1 especialização, o esperado é 2"),
    (["Briga (Membros)", "Ofícios (Marcenaria)", "Atletismo (Corrida)", "Briga (Bares)"], "3 especializações, o esperado é 2"),
    (["Briga (Membros)", "Ofícios (Marcenaria)", "Medicina (Cirurgia)"], "pede ao menos 1 ponto em Medicina"),
    (["Briga (Membros)", "Ofícios (Marcenaria)", "Corrida"], "formato Habilidade (especialização)"),
    (["Briga (Membros)", "Ofícios (Marcenaria)", "Ofícios (marcenaria)"], "repetidas"),
])
def test_free_specialties(specialties: list[str], reason: str) -> None:
    violations = [item for item in evaluate_creation_rules(draft().creation_rules, {**valid_values(), "especialidades": specialties})
                  if item.rule_id == "especializacoes"]
    assert violations and reason in violations[0].message


def test_each_required_skill_with_dots_gets_its_own_specialty() -> None:
    values = {**valid_values(), "atletismo": 0, "academicos": 4,
              "especialidades": ["Briga (Membros)", "Ofícios (Marcenaria)", "Acadêmicos (História)", "acadêmicos (Direito)"]}
    assert "especializacoes" not in rule_ids(values), "the free one may go to a required skill too, any letter case"
    assert "especializacoes" in rule_ids({**values, "especialidades": ["Briga (Membros)", "Ofícios (Marcenaria)", "Briga (Bares)"]})


@pytest.mark.parametrize("change, reason", [
    ({"vantagens": ["Aliados •••", "Refúgio (2)", "Pacto Antigo 1"]}, "Pacto Antigo 1 fora do catálogo"),
    ({"vantagens": ["Aliados •••", "Bela •", "Contatos ••"]}, "Bela aceita 2 pontos"),
    ({"defeitos": ["Segredo Sombrio: Diablerista •• ou Rejeitado ••", "Exclusão de Presa: mortais ••", "Vício ••"]}, "Vício aceita 1 ponto"),
])
def test_advantages_and_flaws_come_from_the_catalog(change: dict[str, Any], reason: str) -> None:
    violations = [item for item in evaluate_creation_rules(draft().creation_rules, {**valid_values(), **change}) if "catálogo" in item.message or "aceita" in item.message]
    assert violations and reason in violations[0].message


def test_catalog_names_take_detail_and_the_narrator_may_open_it() -> None:
    detailed = {**valid_values(), "vantagens": ["aliados: polícia •••", "Refúgio (Biblioteca) (2)", "Contatos 1"]}
    assert rule_ids(detailed) == []
    schema = stored()["schema"]
    next(rule for rule in schema["creation_rules"] if rule["id"] == "vantagens_pontos")["allow_homebrew"] = True
    homebrew = TemplateDraft.model_validate(schema)
    values = {**valid_values(), "vantagens": ["Aliados •••", "Refúgio (2)", "Pacto Antigo 1"]}
    assert evaluate_creation_rules(homebrew.creation_rules, values) == []
    # Listed names still take only their costs.
    assert [item.rule_id for item in evaluate_creation_rules(homebrew.creation_rules, {**values, "vantagens": ["Bela •", "Aliados •••", "Contatos ••"]})] == ["vantagens_pontos"]


def test_a_generation_outside_the_bands_is_refused() -> None:
    messages = [item.message for item in evaluate_creation_rules(draft().creation_rules, {**valid_values(), "geracao": 9})
                if item.rule_id == "predador_bonus"]
    assert messages and "fora das faixas" in messages[0]


@pytest.mark.parametrize("change, rule, reason", [
    ({"vantagens": ["Aliados •••", "Refúgio (2)"]}, "vantagens_pontos", "6 de 7"),
    ({"recursos": 2}, "vantagens_pontos", "8 de 7"),                               # Resources counts toward the 7
    ({"vantagens": ["Aliados •••", "Refúgio (2)", "Mawla"]}, "vantagens_pontos", "indique os pontos"),
    ({"defeitos": ["Segredo Sombrio: Diablerista •• ou Rejeitado ••", "Exclusão de Presa: mortais ••"]}, "defeitos_pontos", "0 de 2"),
])
def test_advantages_and_flaws_spend_exactly_their_points(change: dict[str, Any], rule: str, reason: str) -> None:
    violations = [item for item in evaluate_creation_rules(draft().creation_rules, {**valid_values(), **change}) if item.rule_id == rule]
    assert violations and reason in violations[0].message


def test_predator_items_do_not_count_and_swapping_predator_frees_them() -> None:
    # The Alleycat's criminal contacts are extra: the same own 7 points still pass.
    values = {**valid_values(), "predador": "Gato de Beco", "predador_disciplina": "Potência", "predador_especialidade": "Briga (Agarrar)",
              "disc_potencia": 2, "disc_rapidez": 1, "potencia_sangue": 1, "especialidades": ["Briga (Agarrar)", "Ofícios (Marcenaria)", "Atletismo (Corrida)"],
              "disciplinas": ["Potência: Corpo Letal", "Potência: Proeza", "Presença: Fascínio", "Rapidez: Graça Felina"],
              "vantagens": ["Aliados •••", "Refúgio (2)", "Contatos 1", "Contatos criminosos •••"], "defeitos": ["Vício Irremediável ••"]}
    assert rule_ids(values) == []
    # Under another predator the same item is the player's own and breaks the budget.
    assert "vantagens_pontos" in rule_ids({**values, "predador": "Sanguessuga", "predador_disciplina": "Rapidez",
                                           "predador_especialidade": "Briga (Membros)", "disc_potencia": 1, "disc_rapidez": 2})


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
    lambda rules: rules[6]["catalog"].append({"name": "aliados", "costs": [1]}),         # repeated catalog name
    lambda rules: rules[6]["catalog"][0].update(costs=[0]),                              # costs start at 1
    lambda rules: rules[8].update(field="nome"),                                        # ranges follow a select
    lambda rules: rules[8]["default"]["ranges"].update(nome={"min": 1, "max": 2}),      # ranges on number fields
    lambda rules: rules[8]["cases"][0]["exclude"].update(geracao=["x"]),                # exclusions name selects
    lambda rules: rules[8]["default"]["ranges"]["geracao"].update(min=20),              # min above max
    lambda rules: rules[9].update(required=["nome"]),                                   # required skills are listed
    lambda rules: rules[9]["skills"].append({"field": "nome", "label": "Nome"}),        # skills are number fields
    lambda rules: rules[9].update(fields=["atletismo"]),                                # fields stay empty
])
def test_invalid_grant_declarations_are_rejected(mutate) -> None:
    schema = stored()["schema"]
    mutate(schema["creation_rules"])
    with pytest.raises(ValidationError):
        TemplateDraft.model_validate(schema)
