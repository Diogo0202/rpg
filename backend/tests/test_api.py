from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_and_safe_dice_endpoint() -> None:
    assert client.get("/health").json() == {"status": "ok"}

    response = client.post("/api/v1/dice/roll", json={"expression": "2d6+1"})
    assert response.status_code == 200
    assert 3 <= response.json()["total"] <= 13


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
