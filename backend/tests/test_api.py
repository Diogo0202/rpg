from fastapi.testclient import TestClient
from uuid import UUID

from app.main import app


client = TestClient(app)


def test_health_and_safe_dice_endpoint(monkeypatch) -> None:
    assert client.get("/health").json() == {"status": "ok"}

    denied = client.post("/api/v1/dice/roll", json={"expression": "2d6+1"})
    assert denied.status_code == 401
    assert str(UUID(denied.headers["x-request-id"])) == denied.headers["x-request-id"]

    async def mock_verify(authorization: str):
        assert authorization == "Bearer dummy-jwt"
        return {"id": "30000000-0000-4000-8000-000000000001"}

    monkeypatch.setattr("app.security.verify_supabase_user", mock_verify)
    response = client.post("/api/v1/dice/roll", json={"expression": "2d6+1"}, headers={"Authorization": "Bearer dummy-jwt"})
    assert response.status_code == 200
    assert response.headers["x-request-id"] != denied.headers["x-request-id"]
    assert 3 <= response.json()["total"] <= 13


def test_cors_headers_wrap_authentication_responses() -> None:
    response = client.get(
        "/api/v1/campaigns/00000000-0000-0000-0000-000000000001/chronicle",
        headers={"Origin": "http://localhost:3000"},
    )
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "X-Request-ID" in response.headers["access-control-expose-headers"]


def test_extraction_invalid_untrusted_metadata_returns_422(monkeypatch) -> None:
    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "local-test-token")
    response = client.post(
        "/api/v1/extractions/draft",
        json={"source_id": "x" * 129, "rights_confirmed": True, "page_references": [1], "suggested_system_name": "Sistema teste"},
        headers={"X-Worker-Token": "local-test-token"},
    )
    assert response.status_code == 422


def test_private_narrator_routes_are_mounted_and_require_a_session(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    campaign = "00000000-0000-0000-0000-000000000001"
    for area in ("second-inquisition", "chronicle"):
        response = client.get(f"/api/v1/campaigns/{campaign}/{area}")
        assert response.status_code == 401
    for system, payload in (
        ("hunter", {"base_pool": 1, "difficulty": 1}),
        ("one-ring", {"target": 1, "skill_dice": 0, "endurance": 1, "load": 0}),
        ("shadow-demon-lord", {"attribute": 10}),
        ("shadow-demon-lord/fate", {}),
    ):
        assert client.post(f"/api/v1/system-rolls/{system}", json=payload).status_code == 401


def test_extraction_requires_explicit_rights_confirmation(monkeypatch) -> None:
    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "local-test-token")
    response = client.post(
        "/api/v1/extractions/draft",
        json={
            "source_id": "source-1",
            "page_references": [1, 2],
            "suggested_system_name": "Sistema teste",
            "rights_confirmed": False,
        },
        headers={"X-Worker-Token": "local-test-token"},
    )
    assert response.status_code == 422


def test_extraction_draft_requires_trusted_worker(monkeypatch) -> None:
    payload = {
        "source_id": "source-1",
        "page_references": [1],
        "suggested_system_name": "Sistema teste",
        "rights_confirmed": True,
    }
    assert client.post("/api/v1/extractions/draft", json=payload).status_code == 503

    monkeypatch.setenv("EXTRACTION_WORKER_TOKEN", "local-test-token")
    assert client.post("/api/v1/extractions/draft", json=payload).status_code == 403
    assert client.post(
        "/api/v1/extractions/draft",
        json=payload,
        headers={"X-Worker-Token": "local-test-token"},
    ).status_code == 200
