from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.inbound.http import ai_assistance as ai
from app.adapters.outbound.ai import provider
from app.adapters.outbound.supabase.ai_store import SupabaseAiPrivateStore
from app.application.ai.ports import Actor
from app.application.ai.service import content_hash, template_hash
from app.domain.errors import ServiceUnavailable
from tests.support.fake_supabase import FakeSupabase, use_fake_supabase

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
def actor(app):
    who = Actor(U, False, True)
    app.dependency_overrides[ai.campaign_actor] = lambda: who
    return who


@pytest.fixture
def settings(monkeypatch):
    config = SimpleNamespace(reserve_micro=318432, cost_micro=lambda i, o: i + o)
    monkeypatch.setattr(provider, "provider_settings", lambda: config)
    monkeypatch.setattr(provider, "build_request", lambda *args: {})
    return config


def use_private_transport(app, transport):
    app.dependency_overrides[ai.ai_private_store] = lambda: SupabaseAiPrivateStore(transport)


def row(**changes):
    return {"id": P, "campaign_id": C, "author_id": U, "kind": "sheet", "status": "pending", "version": 1,
            "template_id": T, "target_id": None, "brief": "Uma investigadora", **changes}


@pytest.fixture
def store(app, monkeypatch):
    data = {"request": None, "content": {"context": {"template_hash": template_hash(TEMPLATE)}}, "calls": [], "paid": 0, "quota": True}
    async def query(method, table, params=None, payload=None):
        data["calls"].append((method, table, params, payload))
        if table == "system_templates":
            return [TEMPLATE]
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
    async def generate(*args):
        data["paid"] += 1
        return provider.ProviderResult(SHEET, 100, 20, "fake")
    use_fake_supabase(app, FakeSupabase(user_id=U, on_request=query))
    use_private_transport(app, service)
    data["service"] = service
    monkeypatch.setattr(provider, "generate_proposal", generate)
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
        raise provider.AIProviderError("provider_error")
    monkeypatch.setattr(provider, "generate_proposal", failed)
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json={"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP})
    assert response.status_code == 502
    paths = [call[1] for call in store["calls"]]
    assert "rpc/ai_budget_uncertain" in paths
    assert "rpc/ai_budget_cancel" not in paths
    assert store["request"]["status"] == "failed"


def test_known_usage_on_refusal_is_settled(app, actor, store, settings, monkeypatch):
    async def refusal(*args):
        raise provider.AIProviderError("refusal", {"input_tokens": 10, "output_tokens": 5})
    monkeypatch.setattr(provider, "generate_proposal", refusal)
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json={"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP})
    assert response.status_code == 502
    settlement = next(call[3] for call in store["calls"] if call[1] == "rpc/ai_budget_settle")
    assert settlement["p_actual_micro"] == 15


@pytest.mark.parametrize("failure", ["sheet_validation", "npc_relationship"])
def test_known_usage_survives_local_validation_failure(app, actor, store, settings, monkeypatch, failure):
    actor.manager = True
    result = {**SHEET, "values": {"total": 99}}
    kind = "sheet"
    if failure == "npc_relationship":
        kind = "npc"
        result = {"name": "Mara", "description": "Informante", "motivation": "Proteger a rua",
                  "voice": "Direta", "secret": "Uma dívida", "hook": "Um pedido",
                  "relationships": [{"target_id": E, "relation_type": "aliada", "notes": ""}], "questions": []}

    async def generated(*args):
        store["paid"] += 1
        return provider.ProviderResult(result, 100, 20, "fake")

    monkeypatch.setattr(provider, "generate_proposal", generated)
    body = {"kind": kind, "brief": "Uma personagem", "idempotency_key": OP}
    if kind == "sheet":
        body["template_id"] = T
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json=body)
    assert response.status_code == (422 if kind == "npc" else 502)
    settlements = [call[3] for call in store["calls"] if call[1] == "rpc/ai_budget_settle"]
    assert len(settlements) == 1
    assert settlements[0]["p_actual_micro"] == 120
    assert not any(call[1] == "rpc/ai_budget_uncertain" for call in store["calls"])
    assert store["paid"] == 1
    assert store["request"]["status"] == "failed"
    replay = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json=body)
    assert replay.status_code == 201
    assert replay.json()["request"]["status"] == "failed"
    assert store["paid"] == 1


def test_persistence_failure_does_not_settle_known_usage_twice(app, actor, store, settings, monkeypatch):
    service = store["service"]

    async def failed_write(method, table, **kwargs):
        if table == "ai_proposal_contents" and method == "PATCH":
            raise ServiceUnavailable("Banco indisponível")
        return await service(method, table, **kwargs)

    use_private_transport(app, failed_write)
    response = TestClient(app).post(f"/api/v1/campaigns/{C}/ai/proposals", json={
        "kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP})
    assert response.status_code == 503
    assert len([call for call in store["calls"] if call[1] == "rpc/ai_budget_settle"]) == 1
    assert not any(call[1] == "rpc/ai_budget_uncertain" for call in store["calls"])
    assert store["paid"] == 1


def test_financial_operations_are_scoped_to_proposal(app, actor, store, settings):
    client = TestClient(app)
    body = {"kind": "sheet", "brief": "Uma personagem", "template_id": T, "idempotency_key": OP}
    first = client.post(f"/api/v1/campaigns/{C}/ai/proposals", json=body)
    assert first.status_code == 201
    # A different campaign permits the same client key and creates its own proposal.
    store["request"] = None
    other_campaign = "10000000-0000-4000-8000-000000000002"
    second = client.post(f"/api/v1/campaigns/{other_campaign}/ai/proposals", json=body)
    assert second.status_code == 201
    reservations = [call[3]["p_operation_id"] for call in store["calls"] if call[1] == "rpc/ai_budget_reserve"]
    assert len(set(reservations)) == 2
    for path in ["rpc/ai_budget_dispatch", "rpc/ai_budget_settle"]:
        assert [call[3]["p_operation_id"] for call in store["calls"] if call[1] == path] == reservations
    assert first.json()["request"]["idempotency_key"] == OP
    assert second.json()["request"]["idempotency_key"] == OP


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
    store["request"] = row(version=2, last_operation_id=OP, last_operation_hash=content_hash(payload.model_dump(mode="json")))
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
    store.update(request=row(), content={"result": SHEET, "context": {"original": None, "template_hash": template_hash(TEMPLATE)}})
    captured = {}
    async def generate(kind, context, template):
        captured.update(context)
        return provider.ProviderResult(SHEET, 100, 20, "fake")
    monkeypatch.setattr(provider, "generate_proposal", generate)
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
