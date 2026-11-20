from __future__ import annotations

from datetime import date
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.inbound.http import chronicle
from app.adapters.outbound.supabase.chronicle_store import SupabaseChronicleStore
from app.application.chronicle.ports import ChronicleRecord
from app.application.chronicle.service import MAX_PROFILE_ROWS
from tests.support.fake_supabase import FakeSupabase, stub_supabase


CAMPAIGN_ID = UUID("10000000-0000-4000-8000-000000000001")
SHEET_ID = UUID("20000000-0000-4000-8000-000000000001")
USER_ID = "30000000-0000-4000-8000-000000000001"


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(chronicle.router)
    with TestClient(app) as test_client:
        yield test_client


def _campaign_rows(table: str):
    if table == "system_templates":
        return [{
            "id": "40000000-0000-4000-8000-000000000001",
            "campaign_id": str(CAMPAIGN_ID), "name": "Modelo V5", "version": 1,
            "status": "approved",
            "schema": {"fields": [
                {"id": "forca", "label": "Força", "kind": "number"},
                {"id": "atletismo", "label": "Atletismo", "kind": "number"},
                {"id": "ambicao", "label": "Ambição", "kind": "text"},
                {"id": "manchas", "label": "Manchas", "kind": "number"},
            ]},
        }]
    if table == "character_sheets":
        return [{
            "id": str(SHEET_ID), "campaign_id": str(CAMPAIGN_ID),
            "template_id": "40000000-0000-4000-8000-000000000001",
            "owner_id": USER_ID, "name": "Mara", "values": {"forca": 3, "atletismo": 1, "ambicao": "Proteger a cidade", "manchas": 2},
            "updated_at": "2026-10-14T00:00:00Z",
        }]
    if table in {"chronicle_goals", "chronicle_supporters", "chronicle_defects", "chronicle_activity"}:
        return []
    raise AssertionError(f"table inesperada: {table}")


def _owned(respond):  # type: ignore[no-untyped-def]
    """Responde como se o usuário do teste fosse dono da campanha."""
    def wrapped(method, table, params=None, payload=None):  # type: ignore[no-untyped-def]
        if table == "campaigns":
            return [{"id": str(CAMPAIGN_ID), "owner_id": USER_ID}]
        return respond(method, table, params, payload)
    return wrapped


def _mock_authorized_data(client: TestClient) -> None:
    def request_supabase(_method, table, _params=None, payload=None):  # type: ignore[no-untyped-def]
        if payload is not None:
            return [{"id": "50000000-0000-4000-8000-000000000001", **payload}]
        return _campaign_rows(table)

    stub_supabase(client.app, request=_owned(request_supabase)).user_id = USER_ID


def test_chronicle_route_requires_auth_header(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle")
    assert response.status_code == 401


def test_other_campaign_manager_cannot_read_campaign_data(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    calls: list[str] = []

    def request_supabase(_method, table, params=None, payload=None):  # type: ignore[no-untyped-def]
        calls.append(table)
        if table == "campaigns":
            return [{"id": str(CAMPAIGN_ID), "owner_id": "another-user"}]
        if table == "campaign_members":
            return []
        raise AssertionError("campaign payload was queried before narrator authorization")

    stub_supabase(client.app, request=request_supabase).user_id = USER_ID
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle", headers={"Authorization": "Bearer test"})
    assert response.status_code == 403
    assert calls == ["campaigns", "campaign_members"]


def test_maps_stable_attribute_and_skill_ids_without_classifying_other_numbers(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_authorized_data(client)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle", headers={"Authorization": "Bearer test"})
    assert response.status_code == 200
    character = response.json()["characters"][0]
    assert [(trait["id"], trait["category"]) for trait in character["traits"]] == [
        ("forca", "attribute"), ("atletismo", "skill"),
    ]
    assert character["legacy_text_fields"] == [{"id": "ambicao", "populated": True}]
    assert character["unclassified_numeric_field_ids"] == ["manchas"]


def test_empty_history_is_reported_as_insufficient_and_goals_are_not_inferred_from_text(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_authorized_data(client)
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle", headers={"Authorization": "Bearer test"})
    assert response.status_code == 200
    body = response.json()
    assert body["report"]["activity_record_count"] == 0
    assert body["report"]["underused_traits"] == []
    assert body["report"]["conflicting_goals"] == []
    assert any("texto livre" in note for note in body["report"]["notes"])
    assert any("Nenhuma atividade" in note for note in body["report"]["notes"])


def test_activity_rejects_trait_reference_outside_selected_sheet(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_authorized_data(client)
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle/activity",
        headers={"Authorization": "Bearer test"},
        json={"occurred_on": date.today().isoformat(), "character_id": str(SHEET_ID), "used_trait_ids": ["manchas"]},
    )
    assert response.status_code == 422
    assert "registro" in response.json()["detail"]


def test_activity_persists_dates_and_stable_field_ids(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_authorized_data(client)
    posted: dict[str, object] = {}

    def request_supabase(_method, table, params=None, payload=None):  # type: ignore[no-untyped-def]
        if payload is not None:
            posted.update(payload)
            return [{"id": "50000000-0000-4000-8000-000000000001", **payload}]
        return _campaign_rows(table)

    stub_supabase(client.app, request=_owned(request_supabase))
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle/activity",
        headers={"Authorization": "Bearer test"},
        json={"occurred_on": "2026-10-12", "character_id": str(SHEET_ID), "used_trait_ids": ["forca", "atletismo"]},
    )
    assert response.status_code == 201
    assert posted["sheet_id"] == str(SHEET_ID)
    assert posted["occurred_on"] == "2026-10-12"
    assert posted["used_trait_ids"] == ["forca", "atletismo"]


def test_bounded_supabase_reads_follow_pages_past_server_row_cap() -> None:
    import asyncio

    offsets: list[str] = []

    def request(_method, _table, params=None, payload=None):  # type: ignore[no-untyped-def]
        offset, limit = int(params["offset"]), int(params["limit"])
        offsets.append(params["offset"])
        return [{"id": index, "sheet_id": "x"} for index in range(offset, min(offset + limit, MAX_PROFILE_ROWS + 1))]

    store = SupabaseChronicleStore(FakeSupabase(on_request=request))
    rows = asyncio.run(store.records(ChronicleRecord.GOAL, CAMPAIGN_ID, [], MAX_PROFILE_ROWS))
    assert len(rows) == MAX_PROFILE_ROWS + 1
    assert offsets == ["0", "500", "1000"]


def test_too_many_goals_are_refused_with_413(client: TestClient) -> None:
    def request(_method, table, params=None, payload=None):  # type: ignore[no-untyped-def]
        if table == "chronicle_goals":
            offset, limit = int(params["offset"]), int(params["limit"])
            return [{"id": index, "sheet_id": str(SHEET_ID)} for index in range(offset, min(offset + limit, MAX_PROFILE_ROWS + 1))]
        return _campaign_rows(table)

    stub_supabase(client.app, request=_owned(request)).user_id = USER_ID
    response = client.get(f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle", headers={"Authorization": "Bearer test"})
    assert response.status_code == 413
    assert "metas" in response.json()["detail"]


def test_activity_accepts_uuid_references_owned_by_selected_character(client, monkeypatch):
    _mock_authorized_data(client)
    goal_id = "60000000-0000-4000-8000-000000000001"
    defect_id = "60000000-0000-4000-8000-000000000002"
    supporter_id = "60000000-0000-4000-8000-000000000003"
    posted = {}

    def request(_method, table, params=None, payload=None):  # type: ignore[no-untyped-def]
        if payload is not None:
            posted.update(payload)
            return [{"id": "50000000-0000-4000-8000-000000000001", **payload}]
        common = {"sheet_id": str(SHEET_ID)}
        if table == "chronicle_goals":
            return [{**common, "id": goal_id, "goal_type": "ambition", "statement": "Proteger a cidade",
                     "target_id": "cidade", "target_label": "Cidade", "polarity": "pursues"}]
        if table == "chronicle_defects":
            return [{**common, "id": defect_id, "statement": "Uma dívida"}]
        if table == "chronicle_supporters":
            return [{**common, "id": supporter_id, "name": "Lia"}]
        return _campaign_rows(table)

    stub_supabase(client.app, request=_owned(request))
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/chronicle/activity",
        headers={"Authorization": "Bearer test"},
        json={"occurred_on": date.today().isoformat(), "character_id": str(SHEET_ID),
              "used_ambition_ids": [goal_id], "used_defect_ids": [defect_id],
              "threatened_supporter_ids": [supporter_id]},
    )
    assert response.status_code == 201, response.text
    assert posted["used_goal_ids"] == [goal_id]
    assert posted["used_defect_ids"] == [defect_id]
    assert posted["threatened_supporter_ids"] == [supporter_id]
