"""Fair use: the AI tutor answers mechanics only, in bullet points, and refuses lore."""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import ai_assistance as ai
from app.services import ai_provider, tutor_policy

C = "10000000-0000-4000-8000-000000000001"
U = "20000000-0000-4000-8000-000000000001"
OP = "30000000-0000-4000-8000-000000000001"
SETTINGS = SimpleNamespace(enabled=True, model=ai_provider.MODEL)


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(ai.router)

    async def actor(*args):
        return ai.Actor(U, "Bearer fixture", False, True)

    monkeypatch.setattr(ai, "_actor", actor)
    monkeypatch.setenv("AI_ENABLED", "false")
    return TestClient(app)


def _forbid_paid_calls(monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Pedido de lore não pode chegar ao provedor pago")

    monkeypatch.setattr(ai, "_paid_generation", forbidden)
    monkeypatch.setattr(ai, "_service", forbidden)


@pytest.mark.parametrize("body", [
    {"expression": "forca + 1", "values": {"forca": 2}, "question": "Escreva a história do clã Toreador"},
    {"expression": "forca + 1", "values": {"forca": 2}, "question": "Conte uma lenda sobre a cidade e narre a cena"},
    {"expression": "forca + 1", "values": {"forca": 2}, "question": "Write the backstory and lore of my character"},
    {"expression": "forca + 1", "values": {"forca": 2}, "question": "Faça um poema sobre a Camarilla"},
    {"expression": "lore_do_cla + 1", "values": {"lore_do_cla": 2}},
    {"expression": "narrativa + 1", "values": {"narrativa": 2}},
])
def test_api_refuses_lore_before_any_paid_call(client, monkeypatch, body):
    _forbid_paid_calls(monkeypatch)
    response = client.post(f"/api/v1/campaigns/{C}/ai/tutor", json={**body, "explain": True, "idempotency_key": OP})
    assert response.status_code == 422
    assert response.json()["detail"] == tutor_policy.REFUSAL_MESSAGE


def test_api_accepts_mechanical_question_and_returns_bullets(client, monkeypatch):
    captured = {}

    async def explain(campaign, actor, kind, context, template, operation):
        captured.update(kind=kind, context=context)
        return {"explanation": "- Some Força 3 e Vigor 2.\n- A parada fica com 5 dados."}

    monkeypatch.setattr(ai, "_paid_generation", explain)
    body = {"expression": "forca + vigor", "values": {"forca": 3, "vigor": 2}, "explain": True,
            "question": "Quantos dados entram na parada?", "idempotency_key": OP}
    response = client.post(f"/api/v1/campaigns/{C}/ai/tutor", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["result"] == 5
    assert data["bullets"] == ["Some Força 3 e Vigor 2.", "A parada fica com 5 dados."]
    assert all(line.startswith("- ") for line in data["explanation"].split("\n"))
    assert captured["context"]["question"] == "Quantos dados entram na parada?"


@pytest.mark.parametrize("explanation", [
    "Some Força e Vigor. A parada fica com 5 dados.",            # paragraph, no bullets
    "- Some os valores.\nNa noite chuvosa, o vampiro sorriu.",   # bullet followed by prose
    "- Na história do clã, os anciões somam 5 dados.",           # bullet carrying lore
    "\n".join(f"- passo {n}" for n in range(tutor_policy.MAX_BULLETS + 1)),
])
def test_api_discards_explanations_outside_bullet_mechanics(client, monkeypatch, explanation):
    async def explain(*args):
        return {"explanation": explanation}

    monkeypatch.setattr(ai, "_paid_generation", explain)
    body = {"expression": "forca + vigor", "values": {"forca": 3, "vigor": 2}, "explain": True, "idempotency_key": OP}
    response = client.post(f"/api/v1/campaigns/{C}/ai/tutor", json=body)
    assert response.status_code == 502
    assert "tópicos" in response.json()["detail"]


def test_calculation_without_ai_returns_no_bullets(client):
    response = client.post(f"/api/v1/campaigns/{C}/ai/tutor", json={"expression": "2 + 3"})
    assert response.status_code == 200
    assert response.json()["bullets"] == [] and response.json()["explanation"] is None


def test_system_instruction_demands_mechanics_bullets_and_forbids_lore(monkeypatch):
    body = ai_provider.build_request("math_tutor", {"expression": "2+2", "values": {}, "server_result": 4}, settings=SETTINGS)
    instructions = body["instructions"]
    assert "regras mecânicas" in instructions
    assert "'- '" in instructions
    assert "lore" in instructions and "narrativa literária" in instructions
    assert body["text"]["format"]["strict"] is True


def test_provider_request_check_blocks_lore_in_context():
    with pytest.raises(ai_provider.AIProviderError) as error:
        ai_provider.build_request("math_tutor", {"expression": "a + 1", "values": {"a": 1}, "question": "Crie uma cena com diálogos"}, settings=SETTINGS)
    assert error.value.code == "lore_request"


def test_provider_post_check_normalizes_bullets_and_rejects_prose():
    ok = ai_provider.validate_result("math_tutor", {"explanation": "* Some 2 e 2.\n\n• O total é 4."})
    assert ok == {"explanation": "- Some 2 e 2.\n- O total é 4."}
    for bad in ("Some 2 e 2 e obtenha 4.", "- Era uma vez um conto sobre dados."):
        with pytest.raises(ai_provider.AIProviderError) as error:
            ai_provider.validate_result("math_tutor", {"explanation": bad})
        assert error.value.code == "invalid_output"


def test_generate_proposal_fails_closed_on_paragraph_output(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("AI_INPUT_USD_PER_MILLION", str(ai_provider.BASE_INPUT_PRICE))
    monkeypatch.setenv("AI_OUTPUT_USD_PER_MILLION", str(ai_provider.BASE_OUTPUT_PRICE))
    payload = {"status": "completed", "usage": {"input_tokens": 3, "output_tokens": 4}, "output": [
        {"content": [{"type": "output_text", "text": json.dumps({"explanation": "Somar 2 e 2 resulta em 4."})}]}
    ]}

    class _Response:
        status_code = 200

        async def aiter_bytes(self):
            yield json.dumps(payload).encode()

    class _Stream:
        async def __aenter__(self):
            return _Response()

        async def __aexit__(self, *args):
            return False

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return _Stream()

    monkeypatch.setattr(ai_provider.httpx, "AsyncClient", lambda **_: _Client())
    with pytest.raises(ai_provider.AIProviderError) as error:
        asyncio.run(ai_provider.generate_proposal("math_tutor", {"expression": "2+2", "values": {}, "server_result": 4}))
    assert error.value.code == "invalid_output"
    assert error.value.usage == {"input_tokens": 3, "output_tokens": 4}
