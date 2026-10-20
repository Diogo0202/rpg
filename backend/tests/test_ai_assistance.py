from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routes import ai_assistance as ai

C = "10000000-0000-4000-8000-000000000001"
U = "20000000-0000-4000-8000-000000000001"
P = "30000000-0000-4000-8000-000000000001"
T = "40000000-0000-4000-8000-000000000001"
E = "50000000-0000-4000-8000-000000000001"
OP = "60000000-0000-4000-8000-000000000001"
TEMPLATE = {"id": T, "name": "Modelo", "version": 1, "status": "approved", "schema": {"fields": [
    {"id": "nome", "label": "Nome", "kind": "text", "required": True},
    {"id": "forca", "label": "Força", "kind": "number", "required": True},
    {"id": "total", "label": "Total", "kind": "formula", "expression": "forca + 1"},
]}}
SHEET = {"name": "Mara", "values": {"nome": "Mara", "forca": 3}, "narrative": "Conceito", "questions": []}


@pytest.fixture
def app():
    application = FastAPI()
    application.include_router(ai.router)
    return application


@pytest.fixture
def actor(monkeypatch):
    who = ai.Actor(U, "Bearer test-user", False, True)
    async def current(*args):
        return who
    monkeypatch.setattr(ai, "_actor", current)
    return who


@pytest.fixture
def settings(monkeypatch):
    config = SimpleNamespace(reserve_micro=318432, cost_micro=lambda i, o: i + o)
    monkeypatch.setattr(ai.ai_provider, "provider_settings", lambda: config)
    monkeypatch.setattr(ai.ai_provider, "build_request", lambda *args: {})
    return config


def row(**changes):
    return {"id": P, "campaign_id": C, "author_id": U, "kind": "sheet", "status": "pending", "version": 1,
            "template_id": T, "target_id": None, "brief": "Uma investigadora", **changes}


@pytest.fixture
def store(monkeypatch):
    data = {"request": None, "content": {"context": {"template_hash": ai._template_hash(TEMPLATE)}}, "calls": [], "paid": 0, "quota": True}
    async def query(method, table, authorization, *, params=None, payload=None):
        data["calls"].append((method, table, params, payload))
        if table == "ai_requests":
            return [data["request"]] if data["request"] else []
        if table == "ai_proposal_contents":
            return [data["content"]] if data["content"] else []
        if table == "world_entities":
            return [{"id": E}] if params.get("id") == f"eq.{E}" else []
        if table.startswith("rpc/"):
            return {"request": row(status="approved"), "destination_id": E}
        return []
    async def service(method, table, *, params=None, payload=None):
        data["calls"].append((method, table, params, payload))
        if table == "rpc/ai_budget_reserve":
            return {"admitted": data["quota"], "reason": "ok" if data["quota"] else "budget"}
        if table.startswith("rpc/"):
            return True
        if table == "ai_requests":
            if method == "POST":
                data["request"] = {**payload, "version": 1}
            else:
                data["request"] = {**data["request"], **payload}
            return [data["request"]]
        if table == "ai_proposal_contents":
            data["content"] = {**(data["content"] or {}), **payload}
            return [data["content"]]
        raise AssertionError(table)
    async def template(*args):
        return TEMPLATE
    async def generate(*args):
        data["paid"] += 1
        return ai.ai_provider.ProviderResult(SHEET, 100, 20, "fake")
    monkeypatch.setattr(ai, "_request", query)
    monkeypatch.setattr(ai, "_service", service)
    monkeypatch.setattr(ai, "_get_template", template)
    monkeypatch.setattr(ai.ai_provider, "generate_proposal", generate)
    return data


def test_player_does_not_read_generated_content(app, actor, store):
    store.update(request=row(), content={"result": {"secret": "somente mestre"}, "context": {"private": "nota"}})
    response = TestClient(app).get(f"/api/v1/campaigns/{C}/ai/proposals/{P}")
    assert response.status_code == 200
    assert response.json()["result"] is None
    assert response.json()["context"] is None
    assert "somente mestre" not in response.text
    assert not any(call[1] == "ai_proposal_contents" for call in store["calls"])


@pytest.mark.parametrize("path", ["context", "preparations"])
def test_manager_only_resources(app, actor, store, path):
    assert TestClient(app).get(f"/api/v1/campaigns/{C}/ai/{path}").status_code == 403


def test_player_cannot_generate_npc_or_add_context(app, actor, store, settings):
    client = TestClient(app)
    base = {"brief": "Uma personagem", "idempotency_key": OP}
    assert client.post(f"/api/v1/campaigns/{C}/ai/proposals", json={**base, "kind": "npc"}).status_code == 403
    assert client.post(f"/api/v1/campaigns/{C}/ai/proposals", json={**base, "kind": "sheet", "template_id": T, "context_refs": [{"kind": "entity", "id": E}]}).status_code == 403
    assert store["paid"] == 0


def test_generation_only_saves_private_proposal_and_idempotent_retry(app, actor, store, settings):
    client = TestClient(app)
    body = {"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP}
    response = client.post(f"/api/v1/campaigns/{C}/ai/proposals", json=body)
    assert response.status_code == 201
    assert response.json()["request"]["status"] == "pending"
    assert "result" not in response.json()
    assert store["content"]["campaign_id"] == C
    assert store["content"]["result"] == SHEET
    assert store["paid"] == 1
    assert client.post(f"/api/v1/campaigns/{C}/ai/proposals", json=body).status_code == 201
    assert store["paid"] == 1
    assert client.post(f"/api/v1/campaigns/{C}/ai/proposals", json={**body, "brief": "Outro conceito"}).status_code == 409
    assert not any(call[1] in {"character_sheets", "world_entities", "campaign_sessions"} and call[0] != "GET" for call in store["calls"])


def test_budget_rejection_prevents_provider(app, actor, store, settings):
    store["quota"] = False
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json={"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP})
    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"
    assert store["paid"] == 0
    assert store["request"]["status"] == "failed"


def test_provider_timeout_keeps_financial_reservation(app, actor, store, settings, monkeypatch):
    async def failed(*args):
        raise ai.ai_provider.AIProviderError("provider_error")
    monkeypatch.setattr(ai.ai_provider, "generate_proposal", failed)
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json={"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP})
    assert response.status_code == 502
    paths = [call[1] for call in store["calls"]]
    assert "rpc/ai_budget_uncertain" in paths
    assert "rpc/ai_budget_cancel" not in paths
    assert store["request"]["status"] == "failed"


def test_known_usage_on_refusal_is_settled(app, actor, store, settings, monkeypatch):
    async def refusal(*args):
        raise ai.ai_provider.AIProviderError("refusal", {"input_tokens": 10, "output_tokens": 5})
    monkeypatch.setattr(ai.ai_provider, "generate_proposal", refusal)
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json={"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP})
    assert response.status_code == 502
    settlement = next(call[3] for call in store["calls"] if call[1] == "rpc/ai_budget_settle")
    assert settlement["p_actual_micro"] == 15


def test_approval_validates_required_and_calculated_fields(app, actor, store, settings):
    actor.manager = True
    store["request"] = row()
    client = TestClient(app)
    url = f"/api/v1/campaigns/{C}/ai/proposals/{P}/approve"
    assert client.post(url, json={"expected_version": 1, "result": {**SHEET, "values": {"nome": "Mara"}}}).status_code == 422
    assert client.post(url, json={"expected_version": 1, "result": {**SHEET, "values": {**SHEET["values"], "total": 9}}}).status_code == 422
    assert client.post(url, json={"expected_version": 1, "result": SHEET}).status_code == 200
    call = next(call for call in store["calls"] if call[1] == "rpc/ai_approve_proposal")
    assert call[3]["p_result"]["values"] == SHEET["values"]
    assert client.post(url, json={"expected_version": 2, "result": SHEET}).status_code == 409


def test_player_cannot_approve_even_own_proposal(app, actor, store):
    store["request"] = row()
    assert TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals/{P}/approve", json={"expected_version": 1, "result": SHEET}).status_code == 403


def test_changed_or_foreign_context_never_reaches_provider(app, actor, store, settings):
    actor.manager = True
    client = TestClient(app)
    ref = {"kind": "entity", "id": E}
    preview = client.post(f"/api/v1/campaigns/{C}/ai/context/preview", json={"context_refs": [ref]}).json()
    assert preview["context"]["items"][0]["id"] == E
    response = client.post(f"/api/v1/campaigns/{C}/ai/proposals", json={"kind": "npc", "brief": "Um NPC novo", "idempotency_key": OP, "context_refs": [ref], "context_hash": "0" * 64})
    assert response.status_code == 409
    assert store["paid"] == 0
    unknown = client.post(f"/api/v1/campaigns/{C}/ai/context/preview", json={"context_refs": [{"kind": "entity", "id": T}]})
    assert unknown.status_code == 404


def test_refinement_replay_does_not_regenerate(app, actor, store, settings):
    actor.manager = True
    payload = ai.ProposalRefine(expected_version=1, instruction="Melhore o conceito", idempotency_key=UUID(OP))
    store["request"] = row(version=2, last_operation_id=OP, last_operation_hash=ai._hash(payload.model_dump(mode="json")))
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals/{P}/refine", json=payload.model_dump(mode="json"))
    assert response.status_code == 200
    assert store["paid"] == 0


def test_disabled_configuration_never_creates_proposal(app, actor, store, monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "false")
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json={"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP})
    assert response.status_code == 503
    assert store["request"] is None


def test_refinement_keeps_manager_edits_as_generation_input(app, actor, store, settings, monkeypatch):
    actor.manager = True
    store.update(request=row(), content={"result": SHEET, "context": {"original": None, "template_hash": ai._template_hash(TEMPLATE)}})
    captured = {}
    async def generate(kind, context, template):
        captured.update(context)
        return ai.ai_provider.ProviderResult(SHEET, 100, 20, "fake")
    monkeypatch.setattr(ai.ai_provider, "generate_proposal", generate)
    edited = {**SHEET, "narrative": "Revisão manual importante"}
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals/{P}/refine", json={"expected_version": 1, "instruction": "Mantenha minha revisão", "result": edited, "idempotency_key": OP})
    assert response.status_code == 200
    assert captured["previous_result"]["narrative"] == "Revisão manual importante"
    assert store["request"]["version"] == 2


def test_ai_routes_are_mounted_under_global_authentication():
    from app.main import app as secured_app
    response = TestClient(secured_app).get(f"/api/v1/campaigns/{C}/ai/config")
    assert response.status_code == 401


def test_changed_approved_template_conflicts_before_approval(app, actor, store):
    actor.manager = True
    store["request"] = row()
    store["content"] = {"context": {"template_hash": "old-template"}}
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals/{P}/approve", json={"expected_version": 1, "result": SHEET})
    assert response.status_code == 409
    assert not any(call[1] == "rpc/ai_approve_proposal" for call in store["calls"])
