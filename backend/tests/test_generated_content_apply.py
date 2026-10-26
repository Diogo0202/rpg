from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.routes import generators, modifiers, second_inquisition, v5_actions
from app.routes.generators import require_signed_in_user
from app.services import session_roll_activity, supabase_rpc


CAMPAIGN_ID = "00000000-0000-0000-0000-0000000000a1"
COMBAT_ID = "00000000-0000-0000-0000-0000000000c1"
SHEET_ID = "00000000-0000-0000-0000-0000000000d1"
HEADERS = {"Authorization": "Bearer valid-token"}

app = FastAPI()
app.include_router(generators.router)
app.include_router(second_inquisition.router)
app.include_router(modifiers.router)
app.include_router(v5_actions.router)
app.dependency_overrides[require_signed_in_user] = lambda: None
client = TestClient(app)


@pytest.fixture
def rpc_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []

    async def fake_rpc(function: str, authorization: str, payload: dict, **_: object):
        assert authorization == "Bearer valid-token"
        calls.append((function, payload))
        if function == "rpg_record_roll_activity":
            return {"status": "recorded", "activity_id": str(uuid.uuid4()), "used_trait_ids": payload["p_trait_ids"]}
        return {"application_id": str(uuid.uuid4()), "entity_id": str(uuid.uuid4()), "replayed": False}

    monkeypatch.setattr(generators, "call_rpc", fake_rpc)
    monkeypatch.setattr(second_inquisition, "call_rpc", fake_rpc)
    monkeypatch.setattr(session_roll_activity, "call_rpc", fake_rpc)
    return calls


def test_content_generate_returns_combat_block_for_selected_system() -> None:
    response = client.post("/api/v1/content/generate", json={"kind": "enemy", "seed": 5, "combat_system": "sotdl", "difficulty": "chefe"})
    assert response.status_code == 200
    block = response.json()["details"]["combat_block"]
    assert block["system"] == "sotdl" and block["tier"] == "chefe" and block["needs_book_check"] is True
    bad = client.post("/api/v1/content/generate", json={"kind": "enemy", "seed": 5, "combat_system": "dnd"})
    assert bad.status_code == 422


def test_apply_regenerates_by_seed_and_sends_block_to_combat(rpc_calls) -> None:
    key = str(uuid.uuid4())
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/content/apply", headers=HEADERS, json={
        "kind": "enemy", "seed": 8, "combat_system": "v5", "difficulty": "perigoso",
        "combat_id": COMBAT_ID, "save_entity": True, "idempotency_key": key,
    })
    assert response.status_code == 201
    function, payload = rpc_calls[0]
    assert function == "rpg_apply_generated_content"
    block = payload["p_combat_block"]
    assert payload["p_initiative"] == block["initiative"] and payload["p_health"] == block["health"]
    assert payload["p_source_kind"] == "generator" and payload["p_source_ref"]["seed"] == 8
    assert payload["p_idempotency_key"] == key and payload["p_combat_id"] == COMBAT_ID
    details = payload["p_entity_body"]["generated"]["details"]
    assert not {"weakness", "encounter_hook", "combat_block"} & set(details)


def test_apply_rejects_client_stats_and_incoherent_targets(rpc_calls) -> None:
    base = {"kind": "enemy", "seed": 1, "idempotency_key": str(uuid.uuid4())}
    url = f"/api/v1/campaigns/{CAMPAIGN_ID}/content/apply"
    assert client.post(url, headers=HEADERS, json={**base, "health": 99, "combat_system": "v5"}).status_code == 422
    assert client.post(url, headers=HEADERS, json={**base, "combat_id": COMBAT_ID}).status_code == 422
    assert client.post(url, headers=HEADERS, json={**base, "save_entity": False}).status_code == 422
    assert client.post(url, headers=HEADERS, json={**base, "kind": "item"}).status_code == 422
    assert rpc_calls == []


def test_apply_maps_database_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def closed(*_args, **_kwargs):
        raise HTTPException(status_code=409, detail="o combate já foi encerrado")

    monkeypatch.setattr(generators, "call_rpc", closed)
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/content/apply", headers=HEADERS, json={
        "kind": "npc", "seed": 2, "combat_system": "v3", "combat_id": COMBAT_ID, "idempotency_key": str(uuid.uuid4()),
    })
    assert response.status_code == 409


def _install_si(monkeypatch: pytest.MonkeyPatch, kinds: list[str], role: str = "master") -> None:
    async def manager(_campaign_id, authorization):
        if role != "master":
            raise HTTPException(status_code=403, detail="somente mestre")
        return authorization, "user"

    async def events(_campaign_id, _token):
        return [{
            "id": f"10000000-0000-0000-0000-00000000000{index}", "campaign_id": CAMPAIGN_ID, "event_kind": kind,
            "area_id": "centro", "occurred_at": "2026-10-15T12:00:00+00:00", "verified_at": "2026-10-15T12:00:00+00:00",
            "created_by": "user", "version": 1,
        } for index, kind in enumerate(kinds)]

    monkeypatch.setattr(second_inquisition, "_require_campaign_manager", manager)
    monkeypatch.setattr(second_inquisition, "_read_all_events", events)


def test_si_containment_team_enters_combat_with_panel_stats(monkeypatch: pytest.MonkeyPatch, rpc_calls) -> None:
    _install_si(monkeypatch, ["masquerade_breach", "masquerade_breach", "public_discipline"])  # 50 pontos, nível 2
    url = f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition/responses/containment_team/apply"
    response = client.post(url, headers=HEADERS, json={"combat_id": COMBAT_ID, "idempotency_key": str(uuid.uuid4())})
    assert response.status_code == 201
    _, payload = rpc_calls[0]
    assert payload["p_source_kind"] == "second_inquisition"
    assert payload["p_source_ref"]["level"] == 2 and payload["p_source_ref"]["stats"]["health"] == 6
    assert payload["p_health"] == 6 and payload["p_entity_kind"] == "npc"
    assert "stats" not in payload["p_entity_body"]


def test_si_refuses_untriggered_responses_and_non_combat_insertion(monkeypatch: pytest.MonkeyPatch, rpc_calls) -> None:
    _install_si(monkeypatch, ["masquerade_breach"])  # 20 pontos, nível 1
    base = f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition/responses"
    assert client.post(f"{base}/containment_team/apply", headers=HEADERS, json={"idempotency_key": str(uuid.uuid4())}).status_code == 409
    assert client.post(f"{base}/wiretap/apply", headers=HEADERS, json={"combat_id": COMBAT_ID, "idempotency_key": str(uuid.uuid4())}).status_code == 422
    ok = client.post(f"{base}/wiretap/apply", headers=HEADERS, json={"idempotency_key": str(uuid.uuid4())})
    assert ok.status_code == 201 and rpc_calls[-1][1]["p_entity_kind"] == "event" and rpc_calls[-1][1]["p_combat_id"] is None


def test_si_apply_requires_manager(monkeypatch: pytest.MonkeyPatch, rpc_calls) -> None:
    _install_si(monkeypatch, ["masquerade_breach"], role="player")
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/second-inquisition/responses/wiretap/apply", headers=HEADERS,
                           json={"idempotency_key": str(uuid.uuid4())})
    assert response.status_code == 403 and rpc_calls == []


def test_v5_action_roll_records_chronicle_activity(rpc_calls) -> None:
    response = client.post("/api/v1/v5/roll", headers=HEADERS, json={
        "pool": 3, "hunger": 1, "difficulty": 2,
        "chronicle": {"sheet_id": SHEET_ID, "trait_ids": ["destreza", "armas_brancas"], "roll_key": "sessao-1:v5-1"},
    })
    assert response.status_code == 200
    assert response.headers["X-Chronicle-Activity"] == "recorded"
    assert "chronicle" not in response.json()
    function, payload = rpc_calls[-1]
    assert function == "rpg_record_roll_activity" and payload["p_roll_key"] == "sessao-1:v5-1"
    without = client.post("/api/v1/v5/roll", headers=HEADERS, json={"pool": 3, "hunger": 1, "difficulty": 2})
    assert without.status_code == 200 and "X-Chronicle-Activity" not in without.headers


def test_modifier_roll_records_chronicle_activity_without_changing_the_body(rpc_calls) -> None:
    response = client.post("/api/v1/modifiers/roll", headers=HEADERS, json={
        "base_pool": 2, "die_sides": 10,
        "chronicle": {"sheet_id": SHEET_ID, "trait_ids": ["forca", "forca", "briga"], "roll_key": "sessao-1:rolagem-9"},
    })
    assert response.status_code == 200
    assert response.headers["X-Chronicle-Activity"] == "recorded"
    assert set(response.json()) == {"preview", "rolls", "total"}
    function, payload = rpc_calls[0]
    assert function == "rpg_record_roll_activity"
    assert payload["p_trait_ids"] == ["forca", "briga"] and payload["p_roll_key"] == "sessao-1:rolagem-9"


def test_roll_without_context_skips_the_hook(rpc_calls) -> None:
    response = client.post("/api/v1/modifiers/roll", json={"base_pool": 1, "die_sides": 6})
    assert response.status_code == 200 and "X-Chronicle-Activity" not in response.headers and rpc_calls == []


@pytest.mark.anyio
async def test_hook_never_breaks_the_roll(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing(*_args, **_kwargs):
        raise HTTPException(status_code=503, detail="Supabase indisponível")

    monkeypatch.setattr(session_roll_activity, "call_rpc", failing)
    result = await session_roll_activity.record_session_roll("Bearer x", sheet_id=SHEET_ID, trait_ids=["forca"])
    assert result.status == "error"

    async def odd(*_args, **_kwargs):
        return {"status": "something-else"}

    monkeypatch.setattr(session_roll_activity, "call_rpc", odd)
    result = await session_roll_activity.record_session_roll("Bearer x", sheet_id=SHEET_ID, trait_ids=["forca"])
    assert result.status == "error"


@pytest.mark.anyio
async def test_rpc_helper_translates_sqlstate(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/rpc/rpg_apply_generated_content"
        return httpx.Response(400, json={"code": "54000", "message": "combat already has 50 participants"})

    transport = httpx.MockTransport(handler)
    original = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs["transport"] = transport
        return original(*args, **kwargs)

    monkeypatch.setattr(supabase_rpc.httpx, "AsyncClient", patched)
    with pytest.raises(HTTPException) as error:
        await supabase_rpc.call_rpc("rpg_apply_generated_content", "Bearer x", {})
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as missing:
        await supabase_rpc.call_rpc("rpg_apply_generated_content", "", {})
    assert missing.value.status_code == 401
