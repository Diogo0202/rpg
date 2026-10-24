from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models import TemplateDraft
from app.routes import sheets
from app.services.creation_rules import evaluate_creation_rules
from app.services.sheet_creation import prepare_sheet_creation
from app.services.sheet_values import validate_sheet_values

ATTRIBUTES = ["forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole", "inteligencia", "raciocinio", "resolucao"]
SKILLS = [f"pericia_{index:02d}" for index in range(27)]
V5_RULES = [
    {"type": "group_distribution", "id": "atributos", "label": "Atributos", "fields": ATTRIBUTES,
     "options": [{"label": "Padrão", "counts": {"4": 1, "3": 3, "2": 4, "1": 1}}]},
    {"type": "group_distribution", "id": "habilidades", "label": "Habilidades", "fields": SKILLS, "options": [
        {"label": "Pau para toda obra", "counts": {"3": 1, "2": 8, "1": 10}},
        {"label": "Equilibrado", "counts": {"3": 3, "2": 5, "1": 7}},
        {"label": "Especialista", "counts": {"4": 1, "3": 3, "2": 3, "1": 3}},
    ]},
]


def template(rules: list[dict[str, Any]] | None = None, extra_fields: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    fields = [{"id": "nome", "label": "Nome", "kind": "text", "character_name": True}]
    fields += [{"id": field_id, "label": field_id, "kind": "number", "min": 1, "max": 5} for field_id in ATTRIBUTES]
    fields += [{"id": field_id, "label": field_id, "kind": "number", "min": 0, "max": 5} for field_id in SKILLS]
    fields += extra_fields or []
    return {"name": "V5 teste", "version": 1, "schema": {"fields": fields, "creation_rules": V5_RULES if rules is None else rules}}


def valid_values() -> dict[str, Any]:
    values: dict[str, Any] = dict(zip(ATTRIBUTES, [4, 3, 3, 3, 2, 2, 2, 2, 1]))
    values.update(zip(SKILLS, [3, 3, 3, 2, 2, 2, 2, 2] + [1] * 7))  # balanced; the rest stay 0
    return values


def draft(raw: dict[str, Any]) -> TemplateDraft:
    return TemplateDraft.model_validate({"name": raw["name"], **raw["schema"]})


def test_v5_valid_distribution_passes() -> None:
    assert evaluate_creation_rules(draft(template()).creation_rules, valid_values()) == []
    _, name, values = prepare_sheet_creation(template(), "Lia", valid_values())
    assert name == "Lia"
    assert values["forca"] == 4


def test_attribute_distribution_is_exact() -> None:
    values = valid_values()
    values["resolucao"] = 2  # 4/3/3/3/2/2/2/2/2 has no attribute at 1
    violations = evaluate_creation_rules(draft(template()).creation_rules, values)
    assert [item.rule_id for item in violations] == ["atributos"]
    assert "4" in violations[0].message
    with pytest.raises(ValueError, match="Atributos"):
        prepare_sheet_creation(template(), "Lia", values)


def test_any_listed_skill_distribution_is_accepted() -> None:
    values = valid_values()
    values.update(dict.fromkeys(SKILLS, 0))
    values.update(zip(SKILLS, [4, 3, 3, 3, 2, 2, 2, 1, 1, 1]))  # specialist
    assert evaluate_creation_rules(draft(template()).creation_rules, values) == []
    values[SKILLS[0]] = 5
    assert [item.rule_id for item in evaluate_creation_rules(draft(template()).creation_rules, values)] == ["habilidades"]


def test_field_limits_apply_on_every_write() -> None:
    fields = {field.id: field.model_dump(mode="json") for field in draft(template()).fields}
    validate_sheet_values({"forca": 5}, fields)
    with pytest.raises(ValueError, match="entre 1 e 5"):
        validate_sheet_values({"forca": 6}, fields)
    with pytest.raises(ValueError, match="entre 0 e 5"):
        validate_sheet_values({SKILLS[0]: -1}, fields)


def test_group_sum_and_points_budget() -> None:
    rules = [
        {"type": "group_sum", "id": "soma", "label": "Soma", "fields": ATTRIBUTES[:3], "max": 6},
        {"type": "points_budget", "id": "compra", "label": "Compra de pontos", "fields": ATTRIBUTES[3:6],
         "costs": {"1": 0, "2": 1, "3": 2, "4": 4}, "budget": 4},
    ]
    parsed = draft(template(rules)).creation_rules
    ok = dict(zip(ATTRIBUTES, [2, 2, 2, 3, 2, 2, 1, 1, 1]))
    assert evaluate_creation_rules(parsed, ok) == []
    over = {**ok, "forca": 3, "carisma": 4}
    assert sorted(item.rule_id for item in evaluate_creation_rules(parsed, over)) == ["compra", "soma"]
    outside = {**ok, "carisma": 5}
    assert "fora da tabela" in evaluate_creation_rules(parsed, outside)[0].message


@pytest.mark.parametrize("rule", [
    {"type": "group_sum", "id": "x", "label": "X", "fields": ["nome"], "max": 1},
    {"type": "group_sum", "id": "x", "label": "X", "fields": ["inexistente"], "max": 1},
    {"type": "group_distribution", "id": "x", "label": "X", "fields": ATTRIBUTES[:2], "options": [{"label": "Y", "counts": {"3": 3}}]},
    {"type": "group_sum", "id": "x", "label": "X", "fields": ATTRIBUTES[:2]},
    {"type": "script", "id": "x", "label": "X", "fields": ATTRIBUTES[:2]},
])
def test_invalid_rule_declarations_are_rejected(rule: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        draft(template([rule]))


def test_min_max_only_on_numbers() -> None:
    with pytest.raises(ValidationError, match="numéricos"):
        TemplateDraft.model_validate({"name": "Ficha", "fields": [{"id": "nome", "label": "Nome", "kind": "text", "max": 3}]})


def test_validate_creation_endpoint_reports_without_creating(monkeypatch) -> None:
    app = FastAPI()
    app.include_router(sheets.router)
    client = TestClient(app)

    async def current_user(_authorization):
        return "00000000-0000-0000-0000-000000000003"

    async def get_template(_campaign, _template, _authorization):
        return template()

    monkeypatch.setattr(sheets, "_current_user_id", current_user)
    monkeypatch.setattr(sheets, "_get_template", get_template)
    url = "/api/v1/campaigns/00000000-0000-0000-0000-000000000001/sheets/validate-creation"
    body = {"template_id": "00000000-0000-0000-0000-000000000002"}
    good = client.post(url, json={**body, "values": valid_values()}, headers={"Authorization": "Bearer t"})
    assert good.status_code == 200 and good.json()["valid"] is True
    bad = client.post(url, json={**body, "values": {**valid_values(), "forca": 9}}, headers={"Authorization": "Bearer t"})
    report = bad.json()
    assert report["valid"] is False
    assert any("entre 1 e 5" in error for error in report["field_errors"])
    assert [item["rule_id"] for item in report["violations"]] == ["atributos"]
