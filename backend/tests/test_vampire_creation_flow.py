"""End to end: the sheets the web wizard builds step by step are checked and created by the API.

tests/fixtures/vampire_wizard_sheets.json is written by frontend/tests/vampire-creation-flow.test.mjs
(UPDATE_FIXTURES=1), which walks the wizard with the real starters; the templates are the starter
fixtures v3_starter.json and v5_starter.json that the frontend tests keep in sync.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import sheets

FIXTURES = Path(__file__).parent / "fixtures"
SHEETS = json.loads((FIXTURES / "vampire_wizard_sheets.json").read_text(encoding="utf-8"))
TEMPLATES = {system: json.loads((FIXTURES / f"{system}_starter.json").read_text(encoding="utf-8"))["template"] for system in ("v3", "v5")}

CAMPAIGN_ID = "00000000-0000-0000-0000-000000000001"
TEMPLATE_ID = "00000000-0000-0000-0000-000000000002"
USER_ID = "00000000-0000-0000-0000-000000000003"
PORTRAIT = f"{CAMPAIGN_ID}/{USER_ID}/00000000-0000-0000-0000-000000000009.webp"

app = FastAPI()
app.include_router(sheets.router)
client = TestClient(app)


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch):
    inserted: list[dict[str, Any]] = []
    state = {"system": "v3"}

    async def current_user_id(authorization: str | None) -> str:
        return USER_ID

    async def request(method: str, path: str, authorization: str | None, *, params=None, payload=None):
        if method == "GET":
            template = TEMPLATES[state["system"]]
            return [{"id": TEMPLATE_ID, "campaign_id": CAMPAIGN_ID, "name": template["name"], "version": 1, "schema": template}]
        inserted.append(payload or {})
        return [{"id": "00000000-0000-0000-0000-000000000004", **(payload or {}), "version": 1}]

    monkeypatch.setattr(sheets, "_current_user_id", current_user_id)
    monkeypatch.setattr(sheets, "_request", request)
    return state, inserted


def check(values: dict[str, Any]) -> dict[str, Any]:
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sheets/validate-creation",
                           headers={"Authorization": "Bearer t"}, json={"template_id": TEMPLATE_ID, "values": values})
    assert response.status_code == 200, response.text
    return response.json()


def create(name: str, values: dict[str, Any]):
    return client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sheets", headers={"Authorization": "Bearer t"},
                       json={"template_id": TEMPLATE_ID, "name": name, "values": values, "portrait_path": PORTRAIT})


@pytest.mark.parametrize("system", ["v3", "v5"])
def test_the_wizard_sheet_is_valid_and_created(api, system: str) -> None:
    state, inserted = api
    state["system"] = system
    sheet = SHEETS[system]
    report = check(sheet["values"])
    assert report == {"valid": True, "field_errors": [], "violations": []}
    response = create(sheet["name"], sheet["values"])
    assert response.status_code == 201, response.text
    assert inserted[0]["values"]["nome"] == "Mara"
    assert all(field["kind"] != "formula" or field["id"] not in inserted[0]["values"] for field in TEMPLATES[system]["fields"])


@pytest.mark.parametrize("change, rule", [
    ({"forca": 5}, "criacao_v3"),                  # 5 more freebies than the 15
    ({"disc_dominacao": 1, "disc_rapidez": 1}, "criacao_v3"),  # an off-clan discipline
    ({"humanidade": 6}, "criacao_v3"),             # Humanity bought back below the freebie
    ({"ant_contatos": 3}, "criacao_v3"),           # one freebie left unspent
])
def test_v3_tampering_is_reported_per_step_and_refused_on_create(api, change: dict[str, Any], rule: str) -> None:
    values = {**SHEETS["v3"]["values"], **change}
    report = check(values)
    assert report["valid"] is False and [item["rule_id"] for item in report["violations"]] == [rule]
    response = create("Mara", values)
    assert response.status_code == 422


@pytest.mark.parametrize("change, rule", [
    ({"potencia_sangue": 3}, "predador_bonus"),    # 13th generation Blood Leech starts at 2
    ({"geracao": 9}, "predador_bonus"),             # outside the starting bands
    ({"recursos": 2}, "vantagens_pontos"),          # 8 of 7 advantage points
    ({"defeitos": ["Segredo Sombrio: Diablerista •• ou Rejeitado ••", "Exclusão de Presa: mortais ••"]}, "defeitos_pontos"),
    ({"predador_especialidade": "Furtividade (Contra Membros)"}, "predador_bonus"),  # specialty swapped without the item
])
def test_v5_tampering_is_reported_and_refused(api, change: dict[str, Any], rule: str) -> None:
    state, _ = api
    state["system"] = "v5"
    values = {**SHEETS["v5"]["values"], **change}
    report = check(values)
    assert rule in [item["rule_id"] for item in report["violations"]]
    assert create("Mara", values).status_code == 422
