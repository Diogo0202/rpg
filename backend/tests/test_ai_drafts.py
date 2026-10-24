from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.routes import ai_assistance as ai
from app.services import ai_provider

C = "10000000-0000-4000-8000-000000000001"
U = "20000000-0000-4000-8000-000000000001"
KEY = "70000000-0000-4000-8000-000000000001"
ENEMY = {"name": "Ghoul da ponte", "description": "Vigia os trilhos.", "threat": "alta", "tactics": "Ataca do alto.",
         "weakness": "Fogo.", "hook": "Carrega uma chave.", "questions": []}
ITEM = {"name": "Relógio parado", "description": "Para à meia-noite.", "appearance": "Latão gasto.", "origin": "Leilão.",
        "narrative_effect": "Revela quem mentiu.", "hook": "Alguém quer de volta.", "questions": []}


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(ai.router)
    state = {"calls": [], "quota": True, "manager": True, "result": ENEMY}

    async def actor(*args):
        return ai.Actor(U, "Bearer test", state["manager"], True)

    async def service(method, table, *, params=None, payload=None):
        state["calls"].append(table)
        if table == "rpc/ai_budget_reserve":
            return {"admitted": state["quota"], "reason": "ok" if state["quota"] else "budget"}
        return True

    async def generate(kind, context, template):
        state["kind"], state["context"] = kind, context
        return ai_provider.ProviderResult(state["result"], 80, 40, "fake")

    monkeypatch.setattr(ai, "_actor", actor)
    monkeypatch.setattr(ai, "_service", service)
    monkeypatch.setattr(ai.ai_provider, "provider_settings", lambda: SimpleNamespace(reserve_micro=1000, cost_micro=lambda i, o: i + o))
    monkeypatch.setattr(ai.ai_provider, "build_request", lambda *args: {})
    monkeypatch.setattr(ai.ai_provider, "generate_proposal", generate)
    return TestClient(app), state


def test_enemy_draft_is_generated_and_settled(client):
    http, state = client
    response = http.post(f"/api/v1/campaigns/{C}/ai/drafts", json={"kind": "enemy", "brief": "Inimigo urbano", "system_key": "vampire-v5", "threat": "alta", "idempotency_key": KEY})
    assert response.status_code == 200
    assert response.json() == {"kind": "enemy", "result": ENEMY}
    assert state["calls"] == ["rpc/ai_budget_reserve", "rpc/ai_budget_dispatch", "rpc/ai_budget_settle"]
    assert state["context"]["system"] == "vampire-v5"


def test_item_draft_uses_the_item_schema(client):
    http, state = client
    state["result"] = ITEM
    response = http.post(f"/api/v1/campaigns/{C}/ai/drafts", json={"kind": "item", "brief": "Objeto amaldiçoado", "idempotency_key": KEY})
    assert response.status_code == 200 and response.json()["result"]["narrative_effect"] == "Revela quem mentiu."


def test_players_cannot_spend_the_ai_budget(client):
    http, state = client
    state["manager"] = False
    response = http.post(f"/api/v1/campaigns/{C}/ai/drafts", json={"kind": "npc", "brief": "Qualquer", "idempotency_key": KEY})
    assert response.status_code == 403
    assert state["calls"] == []


def test_exhausted_budget_returns_429(client):
    http, state = client
    state["quota"] = False
    response = http.post(f"/api/v1/campaigns/{C}/ai/drafts", json={"kind": "enemy", "brief": "Qualquer", "idempotency_key": KEY})
    assert response.status_code == 429


def test_invalid_model_output_is_rejected_and_marked(client):
    http, state = client
    state["result"] = {**ENEMY, "threat": "apocalíptica", "attack_bonus": 7}
    response = http.post(f"/api/v1/campaigns/{C}/ai/drafts", json={"kind": "enemy", "brief": "Qualquer", "idempotency_key": KEY})
    assert response.status_code == 502
    assert "procedural" in response.json()["detail"]
    # Paid but invalid: the usage is still settled, never refunded blindly.
    assert state["calls"][-1] == "rpc/ai_budget_settle"


def test_enemy_and_item_schemas_forbid_mechanical_fields():
    with pytest.raises(ValidationError):
        ai_provider.DRAFT_MODELS["enemy"].model_validate({**ENEMY, "hp": 30})
    with pytest.raises(ValidationError):
        ai_provider.DRAFT_MODELS["item"].model_validate({**ITEM, "bonus": 2})
    schema = ai_provider.result_schema("enemy")
    assert schema["additionalProperties"] is False and "threat" in schema["required"]
