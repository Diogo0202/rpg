from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.adapters.inbound.http import sheets
from app.adapters.inbound.http.errors import http_status
from app.adapters.outbound.supabase.rest_client import SupabaseRestClient
from app.domain.errors import DomainError
from app.models import TemplateDraft
from tests.support.fake_supabase import FakeSupabase, use_fake_supabase


app = FastAPI()
app.include_router(sheets.router)
client = TestClient(app)
SHEET_ID = "42000000-0000-0000-0000-000000000001"
OPERATION_ID = "52000000-0000-0000-0000-000000000001"
AUTH = {"Authorization": "Bearer test-token"}
SCHEMA = {
    "fields": [
        {"id": "autocontrole", "label": "Autocontrole", "kind": "number"},
        {"id": "resolucao", "label": "Determinação", "kind": "number"},
        {"id": "vontade_max", "label": "Vontade máxima", "kind": "formula", "expression": "autocontrole + resolucao"},
        {"id": "vontade_superficial", "label": "Dano na Vontade", "kind": "number"},
        {"id": "experiencia", "label": "Experiência", "kind": "number"},
    ],
    "experience_field": "experiencia",
    "meta_currencies": [
        {"id": "vontade", "label": "Força de Vontade", "field": "vontade_superficial", "mode": "track", "max_field": "vontade_max"}
    ],
}


SHEET_ROW = {"campaign_id": "22000000-0000-0000-0000-000000000001", "template_id": "32000000-0000-0000-0000-000000000001",
             "values": {"autocontrole": 2, "resolucao": 1, "vontade_superficial": 2}}
TEMPLATE_ROW = {"name": "V5 base", "version": 1, "schema": SCHEMA}


@pytest.fixture
def calls() -> list[tuple[str, dict[str, Any]]]:
    supabase = use_fake_supabase(app, FakeSupabase(
        user_id="12000000-0000-0000-0000-000000000001",
        on_request=lambda _method, path, *_: [TEMPLATE_ROW if path == "system_templates" else SHEET_ROW],
        on_rpc=lambda _name, payload: {"sheet": {"id": SHEET_ID}, "event": {"delta": payload.get("p_delta", payload.get("p_amount"))}},
    ))
    return supabase.rpcs


def test_adjust_calls_idempotent_rpc_without_expected_version(calls) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/adjust", json={"operation_id": OPERATION_ID, "field_id": "saude_superficial", "delta": 2}, headers=AUTH)
    assert response.status_code == 200
    assert calls == [("adjust_sheet_number_idempotent", {"p_sheet_id": SHEET_ID, "p_operation_id": OPERATION_ID, "p_field_id": "saude_superficial", "p_delta": 2, "p_reason": None})]


@pytest.mark.parametrize("body", [
    {"field_id": "x_y", "delta": 1},
    {"operation_id": OPERATION_ID, "field_id": "x_y", "delta": 0},
    {"operation_id": OPERATION_ID, "field_id": "x_y", "delta": 5000},
    {"operation_id": OPERATION_ID, "field_id": "x_y", "delta": 1, "values": {}},
])
def test_adjust_rejects_zero_large_or_extra_payloads(calls, body) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/adjust", json=body, headers=AUTH)
    assert response.status_code == 422
    assert calls == []


def test_experience_forwards_amount_to_increment_xp(calls) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/experience", json={"amount": 10, "reason": "sessão 3"}, headers=AUTH)
    assert response.status_code == 200
    assert calls == [("increment_xp", {"p_sheet_id": SHEET_ID, "p_amount": 10, "p_reason": "sessão 3"})]


def test_meta_currency_respects_formula_maximum(calls) -> None:
    accepted = client.post(f"/api/v1/sheets/{SHEET_ID}/meta-currencies/vontade", json={"amount": 1}, headers=AUTH)
    assert accepted.status_code == 200
    rejected = client.post(f"/api/v1/sheets/{SHEET_ID}/meta-currencies/vontade", json={"amount": 2}, headers=AUTH)
    assert rejected.status_code == 422
    assert "não pode passar de 3" in rejected.json()["detail"]
    assert [name for name, _ in calls] == ["spend_meta_currency"]


def test_unknown_meta_currency_is_404(calls) -> None:
    response = client.post(f"/api/v1/sheets/{SHEET_ID}/meta-currencies/inspiracao", json={"amount": 1}, headers=AUTH)
    assert response.status_code == 404
    assert calls == []


@pytest.mark.parametrize(("code", "status"), [("42501", 403), ("23514", 422), ("23505", 409), ("22023", 422), ("XX000", 403)])
def test_rpc_maps_postgres_errors_without_leaking_messages(monkeypatch, code, status) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/rpc/increment_xp"
        return httpx.Response(400, json={"code": code, "message": "internal detail"})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    import asyncio

    with pytest.raises(DomainError) as error:
        asyncio.run(SupabaseRestClient("Bearer test-token").rpc("increment_xp", {"p_amount": 1}))
    assert http_status(error.value) == status
    assert "internal detail" not in error.value.message


def test_template_draft_validates_resource_references() -> None:
    TemplateDraft.model_validate({"name": "V5 base", **SCHEMA})
    with pytest.raises(ValidationError, match="experiência precisa ser numérico"):
        TemplateDraft.model_validate({"name": "V5 base", **SCHEMA, "experience_field": "vontade_max"})
    with pytest.raises(ValidationError, match="campo numérico"):
        TemplateDraft.model_validate({
            "name": "V5 base", "fields": SCHEMA["fields"],
            "meta_currencies": [{"id": "insp", "label": "Inspiração", "field": "vontade_max", "mode": "pool"}],
        })
