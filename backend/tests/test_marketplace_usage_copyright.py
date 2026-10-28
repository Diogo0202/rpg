from __future__ import annotations

import asyncio
import inspect

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient

from app.routes import marketplace as route
from app.services import marketplace


USER = "71000000-0000-4000-8000-000000000001"
SYSTEM = "73000000-0000-4000-8000-000000000001"
CAMPAIGN = "72000000-0000-4000-8000-000000000001"
TOKEN = "Bearer verified-marketplace-test-token"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(route.router)
    app.include_router(route.maintenance_router)
    return TestClient(app)


def _copyright_body(**changes) -> dict:
    body = {
        "reason": "Reproduz o texto integral do livro base.",
        "claimed_work": "Livro Básico Exemplo",
        "rights_holder": "Editora Exemplo",
        "evidence_url": "https://example.test/obra",
        "good_faith": True,
    }
    body.update(changes)
    return body


def _authenticated(monkeypatch, calls, result=None):
    async def current_user(_authorization):
        return USER

    async def request_user(_method, path, authorization, *, payload=None):
        calls.append((path, payload))
        return result

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)


# --- usage_count assíncrono -------------------------------------------------

def test_clone_schedules_background_aggregation_after_response(monkeypatch) -> None:
    calls, aggregations = [], []
    _authenticated(monkeypatch, calls, {"id": "84000000-0000-4000-8000-000000000001", "status": "needs_review"})

    async def apply():
        aggregations.append(len(calls))

    monkeypatch.setattr(marketplace, "apply_usage_events_in_background", apply)
    response = _client().post(f"/api/v1/marketplace/systems/{SYSTEM}/clone", headers={"Authorization": TOKEN},
                              json={"campaign_id": CAMPAIGN, "idempotency_key": "clone-key-0001"})
    assert response.status_code == 200
    assert [call[0] for call in calls] == ["rpc/marketplace_clone"]
    assert aggregations == [1], "aggregation runs once, after the clone RPC"


def test_failed_clone_does_not_schedule_aggregation(monkeypatch) -> None:
    aggregations = []

    async def current_user(_authorization):
        return USER

    async def request_user(*_args, **_kwargs):
        raise HTTPException(status_code=403, detail="operação não permitida")

    async def apply():  # pragma: no cover - must not run
        aggregations.append(True)

    monkeypatch.setattr(marketplace, "current_user_id", current_user)
    monkeypatch.setattr(marketplace, "request_user", request_user)
    monkeypatch.setattr(marketplace, "apply_usage_events_in_background", apply)
    response = _client().post(f"/api/v1/marketplace/systems/{SYSTEM}/clone", headers={"Authorization": TOKEN},
                              json={"campaign_id": CAMPAIGN, "idempotency_key": "clone-key-0001"})
    assert response.status_code == 403 and aggregations == []


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _fake_httpx(monkeypatch, response, sent):
    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append({"url": url, "headers": headers, "json": json})
            if isinstance(response, Exception):
                raise response
            return response

    monkeypatch.setattr(marketplace.httpx, "AsyncClient", FakeClient)


def test_apply_usage_events_uses_service_role_rpc(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key")
    sent = []
    _fake_httpx(monkeypatch, _Response(200, 3), sent)
    assert asyncio.run(marketplace.apply_usage_events()) == 3
    assert sent[0]["url"] == "https://example.supabase.co/rest/v1/rpc/marketplace_apply_usage_events"
    assert sent[0]["headers"]["Authorization"] == "Bearer service-test-key"
    assert sent[0]["json"] == {"p_batch_size": marketplace.USAGE_BATCH_SIZE}


def test_apply_usage_events_without_service_key_is_deferred(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    sent = []
    _fake_httpx(monkeypatch, _Response(200, 1), sent)
    assert asyncio.run(marketplace.apply_usage_events()) is None
    assert sent == []


@pytest.mark.parametrize("payload", [True, -1, "3", None])
def test_apply_usage_events_rejects_invalid_rpc_result(monkeypatch, payload) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key")
    _fake_httpx(monkeypatch, _Response(200, payload), [])
    with pytest.raises(HTTPException) as error:
        asyncio.run(marketplace.apply_usage_events())
    assert error.value.status_code == 503


def test_background_aggregation_swallows_failures(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key")
    _fake_httpx(monkeypatch, marketplace.httpx.ConnectError("down"), [])
    assert asyncio.run(marketplace.apply_usage_events_in_background()) is None


def test_maintenance_endpoint_requires_service_secret(monkeypatch) -> None:
    applied = []

    async def apply():
        applied.append(True)
        return 7

    monkeypatch.setattr(marketplace, "apply_usage_events", apply)
    client = _client()
    monkeypatch.delenv("MARKETPLACE_MAINTENANCE_TOKEN", raising=False)
    assert client.post("/internal/maintenance/marketplace-usage").status_code == 503
    monkeypatch.setenv("MARKETPLACE_MAINTENANCE_TOKEN", "maintenance-secret")
    assert client.post("/internal/maintenance/marketplace-usage").status_code == 403
    assert client.post("/internal/maintenance/marketplace-usage", headers={"Authorization": TOKEN}).status_code == 403
    assert client.post("/internal/maintenance/marketplace-usage", headers={"X-Maintenance-Token": "wrong"}).status_code == 403
    assert applied == []
    ok = client.post("/internal/maintenance/marketplace-usage", headers={"X-Maintenance-Token": "maintenance-secret"})
    assert ok.status_code == 200 and ok.json() == {"applied": 7}


def test_public_list_reads_the_column_and_supports_popular_sort(monkeypatch) -> None:
    captured = []

    async def request_public(method, path, *, params=None, payload=None):
        captured.append((path, payload))
        return [{"id": SYSTEM, "name": "A", "description": "d", "tags": ["x"], "author_name": "a", "automation_level": "static",
                 "dependencies": [], "updated_at": "2026-10-26T10:00:00Z", "usage_count": 12, "likes": 0, "dislikes": 0}]

    monkeypatch.setattr(marketplace, "request_public", request_public)
    client = _client()
    popular = client.get("/api/v1/marketplace/systems?sort=popular")
    default = client.get("/api/v1/marketplace/systems")
    assert popular.status_code == 200 and popular.json()["items"][0]["usage_count"] == 12
    assert captured[0] == ("rpc/marketplace_search", {"p_q": None, "p_tags": [], "p_page": 1, "p_limit": 20, "p_sort": "popular"})
    assert captured[1][1]["p_sort"] == "recent" and default.json()["sort"] == "recent"
    assert client.get("/api/v1/marketplace/systems?sort=count").status_code == 422
    assert all(path == "rpc/marketplace_search" for path, _ in captured)


# --- denúncia de copyright ---------------------------------------------------

def test_copyright_report_uses_dedicated_rpc(monkeypatch) -> None:
    calls = []
    _authenticated(monkeypatch, calls, "84000000-0000-4000-8000-000000000001")
    response = _client().post(f"/api/v1/marketplace/systems/{SYSTEM}/report/copyright", headers={"Authorization": TOKEN},
                              json=_copyright_body(claimed_work="  Livro Básico Exemplo  ", evidence_url="  "))
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert calls == [("rpc/marketplace_report_copyright", {
        "p_system_id": SYSTEM, "p_reason": "Reproduz o texto integral do livro base.", "p_claimed_work": "Livro Básico Exemplo",
        "p_rights_holder": "Editora Exemplo", "p_evidence_url": None, "p_good_faith": True,
    })]


@pytest.mark.parametrize("changes", [
    {"good_faith": False},
    {"good_faith": "true"},
    {"claimed_work": " "},
    {"rights_holder": ""},
    {"reason": "curto"},
    {"evidence_url": "javascript:alert(1)"},
    {"evidence_url": "ftp://example.test/obra.pdf"},
    {"attachment": "obra.pdf"},
    {"file": {"name": "obra.pdf"}},
    {"reason": "Prova anexada: data:application/pdf;base64,JVBERi0xLjQK"},
])
def test_copyright_report_validation_and_no_attachments(monkeypatch, changes) -> None:
    calls = []
    _authenticated(monkeypatch, calls)
    body = _copyright_body(**changes)
    response = _client().post(f"/api/v1/marketplace/systems/{SYSTEM}/report/copyright", headers={"Authorization": TOKEN}, json=body)
    assert response.status_code == 422, changes
    assert calls == []


def test_copyright_report_requires_session(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    response = _client().post(f"/api/v1/marketplace/systems/{SYSTEM}/report/copyright", json=_copyright_body())
    assert response.status_code == 401


def test_report_limit_maps_to_429(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")

    class Response:
        status_code = 400
        content = b"x"

        def json(self):
            return {"code": "54000", "message": "report limit reached"}

    _fake_httpx(monkeypatch, Response(), [])
    with pytest.raises(HTTPException) as error:
        asyncio.run(marketplace.request_user("POST", "rpc/marketplace_report_copyright", TOKEN, payload={}))
    assert error.value.status_code == 429
    assert "report limit reached" not in str(error.value.detail)


def test_moderation_queue_keeps_copyright_fields_without_user_ids(monkeypatch) -> None:
    calls = []
    _authenticated(monkeypatch, calls, [{
        "id": "84000000-0000-4000-8000-000000000001", "system_id": SYSTEM, "system_name": "Lantern", "author_name": "Author",
        "system_status": "hidden", "reason": "Copia o livro", "created_at": "2026-10-26T10:00:00Z", "open_reports": 1,
        "category": "copyright", "claimed_work": "Livro", "rights_holder": "Editora", "evidence_url": "https://example.test",
        "reporter_id": USER,
    }])
    item = _client().get("/api/v1/marketplace/moderation/reports", headers={"Authorization": TOKEN}).json()["items"][0]
    assert item["category"] == "copyright" and item["claimed_work"] == "Livro" and item["evidence_url"] == "https://example.test"
    assert "reporter_id" not in item


# --- nenhum arquivo hospedado ------------------------------------------------

def test_marketplace_routes_accept_no_file_uploads() -> None:
    for api_route in [*route.router.routes, *route.maintenance_router.routes]:
        for parameter in inspect.signature(api_route.endpoint).parameters.values():
            assert parameter.annotation not in (UploadFile, "UploadFile"), api_route.path
            assert "UploadFile" not in str(parameter.annotation), api_route.path


@pytest.mark.parametrize("payload", [
    {"description": "Manual: data:application/pdf;base64,JVBERi0xLjQK"},
    {"description": "%PDF-1.7 raw bytes"},
    {"attachments": ["manual.pdf"]},
    {"template": {"name": "Simple Game", "fields": [{"id": "x", "label": "JVBERi0xLjQK", "kind": "text"}]}},
])
def test_publication_refuses_embedded_files(payload) -> None:
    body = {
        "template": {"name": "Simple Game", "fields": [{"id": "health", "label": "Health", "kind": "number"}]},
        "description": "A small test system.", "tags": ["D20"], "author_name": "RPG Author", "dependencies": [], "rights_confirmed": True,
    }
    body.update(payload)
    with pytest.raises(ValueError):
        marketplace.PublishRequest.model_validate(body)
