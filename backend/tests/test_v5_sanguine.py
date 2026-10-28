"""F2 (Vampiro V5): campos complementares da ficha, caçada, Vínculo de Sangue e Regente."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import v5_sanguine as routes
from app.routes.generators import require_signed_in_user
from app.services.sheet_values import validate_sheet_values
from app.services.v5_sanguine import (
    CLAN_BANES, INTENSITIES, RESONANCE_DISCIPLINES, RESONANCES, bane_severity, bond_degree, hunger_after_hunt,
    resonance_effect, v5_trait_problems,
)
from app.services.sheet_calculations import calculate_sheet
from app.models import TemplateDraft

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "v5_starter.json").read_text(encoding="utf-8"))
FIELDS = {field["id"]: field for field in FIXTURE["template"]["fields"]}
SHEET_ID = str(uuid4())
AUTH = {"Authorization": "Bearer token"}


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


# --- domínio -----------------------------------------------------------------------

@pytest.mark.parametrize("potency, severity", [(0, 0), (1, 2), (2, 2), (3, 3), (4, 3), (5, 4), (6, 4), (7, 5), (8, 5), (9, 6), (10, 6)])
def test_bane_severity_follows_blood_potency(potency: int, severity: int) -> None:
    assert bane_severity(potency) == severity


def test_bane_severity_formula_on_the_sheet_matches_the_table() -> None:
    draft = TemplateDraft.model_validate({key: FIXTURE["template"][key] for key in ("name", "version", "fields")})
    base = {key: value for key, value in FIXTURE["values"].items() if FIELDS[key]["kind"] not in {"formula", "roll"}}
    for potency in range(0, 11):
        assert calculate_sheet(draft, {**base, "potencia_sangue": potency})["severidade_perdicao"] == bane_severity(potency)


def test_hunger_never_rises_and_only_killing_reaches_zero() -> None:
    assert hunger_after_hunt(4, 2, False) == 2
    assert hunger_after_hunt(2, 5, False) == 1
    assert hunger_after_hunt(2, 5, True) == 0
    assert hunger_after_hunt(0, 3, False) == 0
    assert hunger_after_hunt(3, 0, True) == 3
    assert hunger_after_hunt(4, 5, False, potency=6) == 2   # F1 table: kill_to_reduce_below 2
    assert hunger_after_hunt(4, 5, False, potency=9) == 3
    assert hunger_after_hunt(4, 5, True, potency=9) == 0


def test_resonance_effect_bonus_and_tags() -> None:
    effect = resonance_effect("Colérica", "Aguda", "Segurança")
    assert effect and effect["delta"] == 1 and effect["applies_to_tags"] == ["disc_potencia", "disc_rapidez"]
    assert resonance_effect("Colérica", "Fugaz", "x") is None
    assert resonance_effect("Nenhuma", "Nenhuma", "x") is None
    with pytest.raises(ValueError):
        resonance_effect("Rubra", "Aguda", "x")


def test_bond_degree_rules() -> None:
    at = utc("2026-01-08T00:00:00")
    assert bond_degree([], 30, at) == 0
    assert bond_degree(["2026-01-01T22:00:00+00:00", "2026-01-01T23:00:00+00:00"], 30, at) == 1
    nights = [f"2026-01-0{day}T22:00:00Z" for day in (1, 3, 5, 7)]
    assert bond_degree(nights, 30, at) == 3
    assert bond_degree(nights[:3], 30, utc("2026-03-10T00:00:00")) == 1
    assert bond_degree(["2026-01-01T00:00:00Z", "2026-03-05T00:00:00Z"], 30, utc("2026-03-06T00:00:00")) == 1
    assert bond_degree(["2026-05-01T00:00:00Z"], 30, utc("2026-04-01T00:00:00")) == 0
    with pytest.raises(ValueError):
        bond_degree([], 0, at)


def test_lists_match_the_api_literals_and_the_frontend() -> None:
    assert set(routes.Resonance.__args__) == set(RESONANCES)
    assert set(routes.Intensity.__args__) == set(INTENSITIES)
    assert FIELDS["ressonancia_atual"]["options"] == list(RESONANCES)
    assert FIELDS["intensidade_ressonancia"]["options"] == list(INTENSITIES)
    assert {case["equals"]: case["options"] for case in FIELDS["perdicao"]["depends_on"]["cases"]} == {
        clan: [name] for clan, name in CLAN_BANES.items()}
    assert set(RESONANCE_DISCIPLINES) == set(RESONANCES)


# --- campos da ficha (validação genérica do template) ------------------------------------

WIZARD = json.loads((Path(__file__).parent / "fixtures" / "vampire_wizard_sheets.json").read_text(encoding="utf-8"))["v5"]


def _values(**changes: Any) -> dict[str, Any]:
    """The Brujah sheet the web wizard builds (fixtures/vampire_wizard_sheets.json), plus changes."""
    values = {**WIZARD["values"], "nome": WIZARD["name"], **changes}
    return {key: value for key, value in values.items() if value is not None}


def test_old_sheets_without_the_new_fields_stay_valid() -> None:
    old = {key: value for key, value in _values().items() if key not in {
        "conviccao_1", "pedra_toque_1", "conviccao_2", "pedra_toque_2", "conviccao_3", "pedra_toque_3",
        "principios_cronica", "ressonancia_atual", "intensidade_ressonancia", "discrasia"}}
    validate_sheet_values(old, FIELDS)
    assert v5_trait_problems(old) == []


def test_new_fields_are_enforced() -> None:
    validate_sheet_values(_values(conviccao_1="Proteger os meus", pedra_toque_1="Irmã", perdicao="Fúria Latente",
                                  principios_cronica=["Não matar inocentes"]), FIELDS)
    with pytest.raises(ValueError, match="junto"):
        validate_sheet_values(_values(conviccao_1="Sozinha", pedra_toque_1=""), FIELDS)
    with pytest.raises(ValueError, match="até 160"):
        validate_sheet_values(_values(conviccao_1="x" * 161, pedra_toque_1="y"), FIELDS)
    with pytest.raises(ValueError, match="até 5 itens"):
        validate_sheet_values(_values(principios_cronica=[f"P{n}" for n in range(6)]), FIELDS)
    with pytest.raises(ValueError):
        validate_sheet_values(_values(perdicao="Repulsivos"), FIELDS)  # Nosferatu bane on a Brujah
    with pytest.raises(ValueError, match="inativo"):
        validate_sheet_values(_values(cla="Caitiff", perdicao="Fúria Latente"), FIELDS)


def test_trait_problems_report_incoherent_resonance() -> None:
    assert v5_trait_problems({"ressonancia_atual": "Colérica", "intensidade_ressonancia": "Nenhuma"}) == ["Ressonância e intensidade andam juntas"]
    assert v5_trait_problems({"intensidade_ressonancia": "Intensa", "ressonancia_atual": "Animal", "discrasia": "x"}) == ["Discrasia só com Ressonância aguda"]
    assert v5_trait_problems({"cla": "Brujah", "perdicao": "Estética"}) == ["A Perdição não é a do clã escolhido"]


# --- API -----------------------------------------------------------------------------

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(app) as test_client:
        yield test_client


def _hunt(**changes: Any) -> dict[str, Any]:
    return {"operation_id": str(uuid4()), "prey": "Segurança", "resonance": "Colérica", "intensity": "Aguda",
            "dyscrasia": "Fúria", "slake": 2, "killed": False, **changes}


def test_hunt_calls_the_atomic_rpc(client, monkeypatch) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def fake_rpc(name, authorization, payload):
        calls.append((name, payload))
        return {"hunt": {"id": "h1", "hunger_after": 2}, "sheet": {"values": {"fome": 2}, "effects": [], "version": 4}, "replayed": False}

    monkeypatch.setattr(routes, "_rpc", fake_rpc)
    body = _hunt()
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/hunts", headers=AUTH, json=body)
    assert response.status_code == 201, response.text
    assert response.json()["sheet_values"] == {"fome": 2} and response.json()["sheet_version"] == 4
    assert calls == [("record_v5_hunt", {
        "p_sheet_id": SHEET_ID, "p_operation_id": body["operation_id"], "p_prey": "Segurança", "p_resonance": "Colérica",
        "p_intensity": "Aguda", "p_dyscrasia": "Fúria", "p_slake": 2, "p_killed": False, "p_notes": None,
    })]


@pytest.mark.parametrize("changes", [
    {"resonance": "Nenhuma"},                    # intensity without resonance
    {"intensity": "Intensa"},                    # dyscrasia needs acute
    {"slake": 6},
    {"resonance": "Rubra"},
    {"prey": "   "},
    {"extra": 1},
])
def test_hunt_rejects_incoherent_requests(client, monkeypatch, changes) -> None:
    async def never(*args, **kwargs):
        raise AssertionError("RPC must not be called")

    monkeypatch.setattr(routes, "_rpc", never)
    assert client.post(f"/api/v1/v5/sheets/{SHEET_ID}/hunts", headers=AUTH, json=_hunt(**changes)).status_code == 422


def test_hunt_errors_are_translated(client, monkeypatch) -> None:
    async def forbidden(name, authorization, payload):
        raise routes.HTTPException(status_code=403, detail="x")

    monkeypatch.setattr(routes, "_rpc", forbidden)
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/hunts", headers=AUTH, json=_hunt())
    assert response.status_code == 403 and "dono da ficha" in response.json()["detail"]


def test_bonds_are_listed_with_degree_and_history(client, monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    bond_id = str(uuid4())

    async def fake_request(method, path, authorization, *, params=None, payload=None):
        if path == "v5_blood_bonds":
            assert params["thrall_sheet_id"] == f"eq.{SHEET_ID}"
            return [{"id": bond_id, "decay_days": 30, "regnant_label": "Regente"}]
        assert path == "v5_blood_bond_drinks" and params["bond_id"] == f"in.({bond_id})"
        return [{"bond_id": bond_id, "drank_at": (now - timedelta(days=days)).isoformat()} for days in (1, 3)]

    monkeypatch.setattr(routes, "_request", fake_request)
    body = client.get(f"/api/v1/v5/sheets/{SHEET_ID}/blood-bonds", headers=AUTH).json()
    assert body[0]["degree"] == 2 and len(body[0]["drinks"]) == 2


def test_drink_needs_exactly_one_donor(client, monkeypatch) -> None:
    payloads: list[dict[str, Any]] = []

    async def fake_rpc(name, authorization, payload):
        payloads.append(payload)
        return {"bond": {}, "drink": {}, "degree": 1}

    monkeypatch.setattr(routes, "_rpc", fake_rpc)
    base = {"operation_id": str(uuid4())}
    assert client.post(f"/api/v1/v5/sheets/{SHEET_ID}/blood-bonds/drinks", headers=AUTH, json=base).status_code == 422
    both = {**base, "regnant_sheet_id": str(uuid4()), "regnant_entity_id": str(uuid4())}
    assert client.post(f"/api/v1/v5/sheets/{SHEET_ID}/blood-bonds/drinks", headers=AUTH, json=both).status_code == 422
    npc = str(uuid4())
    ok = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/blood-bonds/drinks", headers=AUTH,
                     json={**base, "regnant_entity_id": npc, "drank_at": "2026-10-20T22:00:00+00:00", "decay_days": 60})
    assert ok.status_code == 201
    assert payloads[0]["p_regnant_entity_id"] == npc and payloads[0]["p_regnant_sheet_id"] is None
    assert payloads[0]["p_decay_days"] == 60 and payloads[0]["p_drank_at"].startswith("2026-10-20T22:00")


def test_only_the_narrator_records_drinks(client, monkeypatch) -> None:
    async def forbidden(name, authorization, payload):
        raise routes.HTTPException(status_code=403, detail="x")

    monkeypatch.setattr(routes, "_rpc", forbidden)
    response = client.post(f"/api/v1/v5/sheets/{SHEET_ID}/blood-bonds/drinks", headers=AUTH,
                           json={"operation_id": str(uuid4()), "regnant_sheet_id": str(uuid4())})
    assert response.status_code == 403 and "narrador" in response.json()["detail"]


def test_regnant_action_waits_for_the_narrator(client, monkeypatch) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def fake_rpc(name, authorization, payload):
        calls.append((name, payload))
        return {"id": "a1", "status": "pendente" if name == "request_v5_regnant_action" else payload["p_decision"]}

    monkeypatch.setattr(routes, "_rpc", fake_rpc)
    bond_id, roll_id = str(uuid4()), str(uuid4())
    created = client.post(f"/api/v1/v5/blood-bonds/{bond_id}/regnant-actions", headers=AUTH,
                          json={"action": "  Mentir para o Regente ", "roll_id": roll_id})
    assert created.status_code == 201 and created.json()["status"] == "pendente"
    assert calls[0][1] == {"p_bond_id": bond_id, "p_action": "Mentir para o Regente", "p_roll_id": roll_id}
    assert client.post("/api/v1/v5/regnant-actions/00000000-0000-0000-0000-000000000001/decision", headers=AUTH,
                       json={"decision": "talvez"}).status_code == 422
    decided = client.post("/api/v1/v5/regnant-actions/00000000-0000-0000-0000-000000000001/decision", headers=AUTH,
                          json={"decision": "negada", "note": "O Vínculo segura"})
    assert decided.json()["status"] == "negada"


def test_regnant_decision_conflict_is_translated(client, monkeypatch) -> None:
    async def conflict(name, authorization, payload):
        raise routes.HTTPException(status_code=409, detail="x")

    monkeypatch.setattr(routes, "_rpc", conflict)
    response = client.post("/api/v1/v5/regnant-actions/00000000-0000-0000-0000-000000000001/decision", headers=AUTH,
                           json={"decision": "permitida"})
    assert response.status_code == 409 and "já foi decidida" in response.json()["detail"]
