from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import ai_assistance as ai
from app.services import ai_provider

C = "10000000-0000-4000-8000-000000000001"
U = "20000000-0000-4000-8000-000000000001"
OP = "30000000-0000-4000-8000-000000000001"


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(ai.router)

    async def actor(*args):
        return ai.Actor(U, "Bearer fixture", False, True)

    monkeypatch.setattr(ai, "_actor", actor)
    monkeypatch.setenv("AI_ENABLED", "false")
    return TestClient(app)


def test_calculation_works_with_ai_disabled_and_no_database_write(client, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Cálculo não deve chamar o provedor nem gravar dados")

    monkeypatch.setattr(ai, "_service", forbidden)
    monkeypatch.setattr(ai.ai_provider, "generate_proposal", forbidden)
    response = client.post(f"/api/v1/campaigns/{C}/ai/tutor", json={"expression": "forca + vigor * 2", "values": {"forca": 3, "vigor": 2}})
    assert response.status_code == 200
    assert response.json()["result"] == 7
    assert response.json()["explanation"] is None


@pytest.mark.parametrize("body", [
    {"expression": "__import__('os').system('dir')"},
    {"expression": "1 / 0"},
    {"expression": "10 ** 999"},
    {"expression": "missing + 2"},
    {"expression": "forca + 2", "values": {"forca": True}},
    {"expression": "2 + 2", "context_refs": ["campanha"]},
    {"expression": "2 + 2", "values": {"nexus_result": 1}},
    {"expression": "forca + 2", "values": {"forca": 1_000_001}},
])
def test_invalid_arithmetic_never_generates(client, body, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Nenhuma chamada paga para entrada inválida")

    monkeypatch.setattr(ai, "_paid_generation", forbidden)
    assert client.post(f"/api/v1/campaigns/{C}/ai/tutor", json={**body, "explain": True, "idempotency_key": OP}).status_code == 422


def test_explanation_receives_only_math_and_server_answer(client, monkeypatch):
    captured = {}

    async def explain(campaign, actor, kind, context, template, operation):
        captured.update(campaign=campaign, user=actor.id, kind=kind, context=context, template=template, operation=operation)
        return {"explanation": "Multiplique 2 por 3. O resultado é 6."}

    monkeypatch.setattr(ai, "_paid_generation", explain)
    body = {"expression": "forca * 3", "values": {"forca": 2}, "explain": True, "idempotency_key": OP}
    response = client.post(f"/api/v1/campaigns/{C}/ai/tutor", json=body)
    assert response.status_code == 200
    assert response.json()["result"] == 6
    assert captured["kind"] == "math_tutor"
    assert captured["context"] == {"expression": "forca * 3", "values": {"forca": 2}, "server_result": 6}
    assert captured["template"] is None
    first = captured["operation"]
    client.post(f"/api/v1/campaigns/{C}/ai/tutor", json=body)
    assert captured["operation"] == first


@pytest.mark.parametrize("kind", ["sheet", "npc", "session", "enemy", "item"])
def test_provider_rejects_narrative_generation_before_network(kind):
    with pytest.raises(ai_provider.AIProviderError) as error:
        ai_provider.build_request(kind, {}, settings=SimpleNamespace(enabled=True))
    assert error.value.code == "math_tutor_only"


def test_tutor_config_does_not_enable_old_generation_controls(client):
    response = client.get(f"/api/v1/campaigns/{C}/ai/config")
    assert response.json()["enabled"] is False
    assert response.json()["tutor_enabled"] is False
    assert response.json()["mode"] == "math_tutor"


def test_explanation_requires_operation_key(client):
    assert client.post(f"/api/v1/campaigns/{C}/ai/tutor", json={"expression": "2+2", "explain": True}).status_code == 422
