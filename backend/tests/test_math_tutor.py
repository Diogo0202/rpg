from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.inbound.http import ai_assistance as ai
from app.adapters.outbound.ai import provider as ai_provider
from app.adapters.outbound.supabase.ai_store import SupabaseAiPrivateStore
from app.application.ai.ports import Actor

C = "10000000-0000-4000-8000-000000000001"
U = "20000000-0000-4000-8000-000000000001"
OP = "30000000-0000-4000-8000-000000000001"


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(ai.router)

    app.dependency_overrides[ai.campaign_actor] = lambda: Actor(U, False, True)
    monkeypatch.setenv("AI_ENABLED", "false")
    return TestClient(app)


def use_paid_generation(client, run):
    """Troca a chamada paga inteira por uma função com a assinatura (campanha, ator, tipo, contexto, modelo, operação)."""
    class Paid:
        async def run(self, *args, check=None):
            return await run(*args[:6])

    client.app.dependency_overrides[ai.paid_generation] = Paid


def use_private_transport(client, transport):
    client.app.dependency_overrides[ai.ai_private_store] = lambda: SupabaseAiPrivateStore(transport)


def test_calculation_works_with_ai_disabled_and_no_database_write(client, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Cálculo não deve chamar o provedor nem gravar dados")

    use_private_transport(client, forbidden)
    monkeypatch.setattr(ai_provider, "generate_proposal", forbidden)
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

    use_paid_generation(client, forbidden)
    assert client.post(f"/api/v1/campaigns/{C}/ai/tutor", json={**body, "explain": True, "idempotency_key": OP}).status_code == 422


def test_explanation_receives_only_math_and_server_answer(client, monkeypatch):
    captured = {}

    async def explain(campaign, actor, kind, context, template, operation):
        captured.update(campaign=campaign, user=actor.id, kind=kind, context=context, template=template, operation=operation)
        return {"explanation": "- Multiplique 2 por 3.\n- O resultado é 6."}

    use_paid_generation(client, explain)
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
