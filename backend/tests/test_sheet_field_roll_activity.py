from app.domain.errors import ServiceUnavailable
from fastapi.testclient import TestClient

from app.main import app


SHEET = "43000000-0000-4000-8000-000000000091"
CAMPAIGN = "23000000-0000-4000-8000-000000000091"


def test_dice_field_context_records_exact_expression_and_exposes_status(monkeypatch):
    calls = []

    async def verify(authorization):
        return {"id": "13000000-0000-4000-8000-000000000092"}

    async def rpc(name, authorization, payload):
        calls.append((name, authorization, payload))
        return {"status": "recorded", "activity_id": SHEET}

    monkeypatch.setattr("app.security.verify_supabase_user", verify)
    monkeypatch.setattr("app.adapters.outbound.supabase.roll_activity.call_rpc", rpc)
    response = TestClient(app).post("/api/v1/dice/roll", headers={"Authorization": "Bearer test", "Origin": "http://localhost:3000"}, json={
        "expression": "2d6 + 3", "chronicle": {"sheet_id": SHEET, "campaign_id": CAMPAIGN,
        "roll_field_id": "teste", "roll_key": "field:1", "trait_ids": ["forca"]},
    })
    assert response.status_code == 200
    assert response.headers["x-chronicle-activity"] == "recorded"
    assert "X-Chronicle-Activity" in response.headers["access-control-expose-headers"]
    assert calls == [("rpg_record_sheet_field_roll", "Bearer test", {
        "p_sheet_id": SHEET, "p_campaign_id": CAMPAIGN, "p_field_id": "teste",
        "p_expression": "2d6 + 3", "p_roll_key": "field:1",
    })]


def test_optional_context_and_failed_activity_do_not_break_dice(monkeypatch):
    async def verify(authorization):
        return {"id": "13000000-0000-4000-8000-000000000092"}

    async def rpc(*args):
        raise ServiceUnavailable("unavailable")

    monkeypatch.setattr("app.security.verify_supabase_user", verify)
    monkeypatch.setattr("app.adapters.outbound.supabase.roll_activity.call_rpc", rpc)
    client = TestClient(app)
    response = client.post("/api/v1/dice/roll", headers={"Authorization": "Bearer test"}, json={"expression": "1d6"})
    assert response.status_code == 200
    assert "x-chronicle-activity" not in response.headers
    response = client.post("/api/v1/dice/roll", headers={"Authorization": "Bearer test"}, json={
        "expression": "1d6", "chronicle": {"sheet_id": SHEET, "roll_field_id": "teste"},
    })
    assert response.status_code == 200
    assert response.headers["x-chronicle-activity"] == "error"
