"""priority_points on the real Vampire V3 starter (tests/fixtures/v3_starter.json).

frontend/tests/priority-points.test.mjs fails when the fixture drifts from frontend/lib/system-starters.ts.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.models import TemplateDraft
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_creation import prepare_sheet_creation

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "v3_starter.json").read_text(encoding="utf-8"))

def draft() -> TemplateDraft:
    return TemplateDraft.model_validate(FIXTURE["template"])


def stored() -> dict[str, Any]:
    return {"name": FIXTURE["template"]["name"], "version": 1, "schema": FIXTURE["template"]}


def valid_values() -> dict[str, Any]:
    """Brujah with exactly the free budgets spent: attributes 7/5/3, abilities 13/9/5, 3 disciplines, 5 backgrounds, 7 virtues."""
    # Empty optional selects are not stored by the workshop, so they are not part of a sheet.
    values: dict[str, Any] = {key: value for key, value in FIXTURE["values"].items() if value != ""}
    # Attributes (base 1): physical +7, social +5, mental +3 -> 15 free, then 0 attribute freebies.
    values.update(forca=4, destreza=3, vigor=3, carisma=3, manipulacao=3, aparencia=2, percepcao=2, inteligencia=2, raciocinio=2)
    # Abilities (base 0): talents 13, skills 9, knowledges 5.
    values.update(prontidao=3, esportes=2, briga=3, esquiva=2, empatia=2, expressao=1,
                  empatia_animais=2, oficios=2, conducao=2, etiqueta=1, armas_brancas=2,
                  academicos=2, investigacao=2, ocultismo=1)
    # Clan disciplines: Brujah = Rapidez, Potência, Presença; 3 dots.
    values.update(cla="Brujah", disc_rapidez=1, disc_potencia=1, disc_presenca=1)
    # Backgrounds: 5 dots. Virtues (base 1): +7.
    values.update(ant_aliados=2, ant_recursos=2, ant_status=1)
    values.update(consciencia=3, autocontrole=3, coragem=4)
    # Humanity base = Consciência + Autocontrole = 6, Willpower base = Coragem = 4; both stay at base.
    values.update(humanidade=6, forca_vontade=4)
    return values


FREEBIES = {"ant_contatos": 4, "disc_rapidez": 2, "humanidade": 7, "forca_vontade": 5, "briga": 4}


def violated(values: dict[str, Any]) -> list[str]:
    return [item.rule_id for item in evaluate_creation_rules(draft().creation_rules, values)]


def test_starter_parses_with_a_derived_field_list() -> None:
    rule = draft().creation_rules[0]
    assert rule.type == "priority_points" and rule.freebies == 15
    assert "humanidade" in rule.fields and "consciencia" in rule.fields and len(rule.fields) == len(set(rule.fields))


def test_the_exact_budgets_leave_all_freebies_unspent() -> None:
    # Everything above spends exactly the budgets, so 15 freebies are still owed.
    assert violated(valid_values()) == ["criacao_v3"]
    message = evaluate_creation_rules(draft().creation_rules, valid_values())[0].message
    assert "restam 15" in message


def test_freebies_are_bought_with_per_pool_costs() -> None:
    values = valid_values()
    values.update(FREEBIES)
    assert violated(values) == []        # 4 backgrounds + 7 discipline + 1 humanity + 1 willpower + 2 ability = 15
    values.update(esquiva=3)             # one more ability dot: 17
    assert violated(values) == ["criacao_v3"]
    values.update(esquiva=2, ant_contatos=3)  # two dots short of 15
    assert violated(values) == ["criacao_v3"]
    values.update(ant_contatos=4)
    _, name, saved = prepare_sheet_creation(stored(), "Mara", values)
    assert name == "Mara" and saved["disc_rapidez"] == 2


@pytest.mark.parametrize("change, why", [
    ({"forca": 5, "destreza": 5, "vigor": 5}, "5/5/5 physical leaves nothing for the other groups"),
    ({"carisma": 1, "manipulacao": 1}, "an attribute group below its budget"),
    ({"disc_dominacao": 1}, "a discipline outside the clan"),
    ({"humanidade": 5}, "Humanity below its base"),
    ({"coragem": 5, "forca_vontade": 4}, "Willpower base moved without following it"),
    ({"briga": 2.5}, "fractional dots"),
])
def test_tampering_is_refused(change: dict[str, Any], why: str) -> None:
    values = {**valid_values(), **FREEBIES}
    assert violated(values) == []
    assert violated({**values, **change}) == ["criacao_v3"], why


def test_caitiff_may_take_any_discipline_and_a_clan_cannot() -> None:
    values = {**valid_values(), **FREEBIES}
    swapped = {**values, "disc_presenca": 0, "disc_quietus": 1}  # same dot count, one discipline outside Brujah
    assert violated({**swapped, "cla": "Caitiff"}) == []
    assert violated({**swapped, "cla": "Assamita"}) == ["criacao_v3"]  # Quietus is theirs, but Potência is not
    assert violated({**swapped, "cla": "Brujah"}) == ["criacao_v3"]


def test_unknown_clan_unlocks_nothing() -> None:
    values = {**valid_values(), **FREEBIES}
    assert violated({**values, "cla": "Inventado"}) == ["criacao_v3"]
    assert violated({k: v for k, v in values.items() if k != "cla"}) == ["criacao_v3"]


def test_non_numbers_are_refused() -> None:
    values = {**valid_values(), "forca": "alta"}
    messages = [item.message for item in evaluate_creation_rules(draft().creation_rules, values)]
    assert messages and "preencha todos os campos" in messages[0]


@pytest.mark.parametrize("mutate", [
    lambda rule: rule["pools"][0].update(budgets=[7, 5]),                          # one budget per group
    lambda rule: rule["pools"][1]["groups"][0]["fields"].append("forca"),          # a field in two pools
    lambda rule: rule["pools"].append(dict(rule["pools"][0])),                     # duplicated pool id
    lambda rule: rule["pools"][0].update(cost=101),
    lambda rule: rule["pools"][2]["allowed"]["cases"]["Brujah"].append("briga"),   # permitted field outside the pool
    lambda rule: rule.update(freebies=-1),
])
def test_invalid_declarations_are_rejected(mutate) -> None:
    template = json.loads(json.dumps(FIXTURE["template"]))
    mutate(template["creation_rules"][0])
    with pytest.raises(ValidationError):
        TemplateDraft.model_validate(template)


def test_limits_on_the_pool_selector_field() -> None:
    template = json.loads(json.dumps(FIXTURE["template"]))
    template["creation_rules"][0]["pools"][2]["allowed"]["field"] = "forca"  # a number, not a select
    with pytest.raises(ValidationError, match="select"):
        TemplateDraft.model_validate(template)

