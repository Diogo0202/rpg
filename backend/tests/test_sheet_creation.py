from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.adapters.inbound.http import sheets
from app.models import TemplateDraft
from app.services.sheet_creation import prepare_sheet_creation
from tests.support.fake_supabase import FakeSupabase, use_fake_supabase


CAMPAIGN_ID = "00000000-0000-0000-0000-000000000001"
TEMPLATE_ID = "00000000-0000-0000-0000-000000000002"
USER_ID = "00000000-0000-0000-0000-000000000003"
PORTRAIT = f"{CAMPAIGN_ID}/{USER_ID}/00000000-0000-0000-0000-000000000009.webp"

app = FastAPI()
app.include_router(sheets.router)
client = TestClient(app)


def template_row(fields: list[dict[str, Any]], **schema_metadata: Any) -> dict[str, Any]:
    # Older approved templates can lack schema name and version.
    return {"id": TEMPLATE_ID, "campaign_id": CAMPAIGN_ID, "schema": {"fields": fields, **schema_metadata}}


def marked_fields(expression: str = "strength + 2") -> list[dict[str, Any]]:
    return [
        {"id": "character_name", "label": "Nome", "kind": "text", "required": True, "character_name": True},
        {"id": "strength", "label": "Força", "kind": "number", "required": True},
        {"id": "pool", "label": "Reserva", "kind": "formula", "expression": expression},
        {"id": "check", "label": "Teste", "kind": "roll", "expression": "1d10"},
    ]


def test_template_draft_preserves_metadata_and_validates_name_markers() -> None:
    draft = TemplateDraft.model_validate({
        "name": "Ficha",
        "system_key": "vampire-v5",
        "rules_profile_version": 2,
        "fields": [
            {
                "id": "clan", "label": "Clã", "kind": "select", "options": ["Brujah"],
                "creation_step": "identity", "identity_kind": "clan", "character_name": False,
            },
            {"id": "nome", "label": "Nome", "kind": "text", "character_name": True},
        ],
    })
    assert draft.system_key == "vampire-v5"
    assert draft.rules_profile_version == 2
    assert draft.fields[0].creation_step == "identity"
    assert draft.fields[0].identity_kind == "clan"
    assert draft.fields[1].character_name is True

    duplicate_markers = {"name": "Ficha", "fields": [
        {"id": "nome", "label": "Nome", "kind": "text", "character_name": True},
        {"id": "outro_nome", "label": "Outro", "kind": "text", "character_name": True},
    ]}
    with pytest.raises(ValidationError, match="apenas um campo"):
        TemplateDraft.model_validate(duplicate_markers)

    wrong_kind = {"name": "Ficha", "fields": [
        {"id": "nome", "label": "Nome", "kind": "number", "character_name": True},
    ]}
    with pytest.raises(ValidationError, match="tipo texto"):
        TemplateDraft.model_validate(wrong_kind)


def test_creation_normalizes_marked_name_and_does_not_persist_formula_or_roll() -> None:
    _, name, values = prepare_sheet_creation(
        template_row(marked_fields()),
        "  Mara Vale  ",
        {"character_name": "Outro nome", "strength": 3, "pool": None, "check": None},
    )
    assert name == "Mara Vale"
    assert values == {"character_name": "Mara Vale", "strength": 3}


def test_legacy_numeric_nome_field_is_allowed_and_not_used_as_name_fallback() -> None:
    legacy = template_row([
        {"id": "nome", "label": "Nome numérico legado", "kind": "number"},
        {"id": "forca", "label": "Força", "kind": "number"},
    ])
    _, name, values = prepare_sheet_creation(legacy, "  Nara  ", {"nome": 5, "forca": 2})
    assert name == "Nara"
    assert values == {"nome": 5, "forca": 2}


def test_legacy_text_nome_field_receives_normalized_name() -> None:
    legacy = template_row([{"id": "nome", "label": "Nome", "kind": "text"}])
    _, name, values = prepare_sheet_creation(legacy, "  Nara  ", {})
    assert name == "Nara"
    assert values == {"nome": "Nara"}


@pytest.mark.parametrize(
    ("template", "name", "values", "detail"),
    [
        (template_row(marked_fields()), "Mara", {"strength": "3"}, "valor incompatível"),
        (template_row(marked_fields("strength / 0")), "Mara", {"strength": 3}, "divisão por zero"),
        (
            template_row(marked_fields(), system_key="hunter", rules_profile_version=1),
            "Mara", {"strength": 3}, "fonte oficial suportada",
        ),
        (template_row(marked_fields()), "   ", {"strength": 3}, "não pode ficar vazio"),
    ],
)
def test_creation_failures_are_reported_before_insert(
    template: dict[str, Any],
    name: str,
    values: dict[str, Any],
    detail: str,
) -> None:
    supabase = use_fake_supabase(app, FakeSupabase(
        user_id=USER_ID,
        on_request=lambda method, *_: [template] if method == "GET" else [{"id": "unexpected"}],
    ))
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/sheets",
        headers={"Authorization": "Bearer test-token"},
        json={"template_id": TEMPLATE_ID, "name": name, "values": values, "portrait_path": PORTRAIT},
    )

    assert response.status_code == 422
    assert detail in response.json()["detail"]
    assert len(supabase.requests) == 1
    lookup = supabase.requests[0]
    assert (lookup.method, lookup.path) == ("GET", "system_templates")
    assert lookup.params["status"] == "eq.approved"
    assert lookup.params["campaign_id"] == f"eq.{CAMPAIGN_ID}"


def test_create_route_loads_approved_db_template_and_inserts_prepared_values() -> None:
    approved = template_row(marked_fields())

    def respond(method: str, _path: str, _params: Any, payload: dict[str, Any] | None) -> Any:
        if method == "GET":
            return [approved]
        assert payload is not None
        return [{
            "id": "00000000-0000-0000-0000-000000000004",
            "name": payload["name"],
            "template_id": payload["template_id"],
            "values": payload["values"],
            "version": 1,
            "effects": [],
        }]

    supabase = use_fake_supabase(app, FakeSupabase(user_id=USER_ID, on_request=respond))
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/sheets",
        headers={"Authorization": "Bearer test-token"},
        json={"template_id": TEMPLATE_ID, "name": "  Mara Vale  ", "values": {"strength": 3}, "portrait_path": PORTRAIT},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Mara Vale"
    assert response.json()["values"] == {"character_name": "Mara Vale", "strength": 3}
    assert response.json()["version"] == 1
    assert response.json()["effects"] == []
    assert len(supabase.requests) == 2
    lookup, insert = supabase.requests
    assert lookup.params["id"] == f"eq.{TEMPLATE_ID}"
    assert lookup.params["campaign_id"] == f"eq.{CAMPAIGN_ID}"
    assert lookup.params["status"] == "eq.approved"
    assert (insert.method, insert.path) == ("POST", "character_sheets")
    assert insert.payload["values"] == {"character_name": "Mara Vale", "strength": 3}
    assert "pool" not in insert.payload["values"]
    assert "check" not in insert.payload["values"]


@pytest.mark.parametrize(
    "portrait",
    [
        None,
        "not-a-path.webp",
        f"00000000-0000-0000-0000-000000000099/{USER_ID}/00000000-0000-0000-0000-000000000009.webp",
        f"{CAMPAIGN_ID}/00000000-0000-0000-0000-000000000099/00000000-0000-0000-0000-000000000009.webp",
        f"{CAMPAIGN_ID}/{USER_ID}/00000000-0000-0000-0000-000000000009.png",
    ],
)
def test_create_route_requires_own_portrait_in_this_campaign(portrait: str | None) -> None:
    supabase = use_fake_supabase(app, FakeSupabase(user_id=USER_ID, on_request=lambda *_: [template_row(marked_fields())]))
    body: dict[str, Any] = {"template_id": TEMPLATE_ID, "name": "Mara", "values": {"strength": 3}}
    if portrait is not None:
        body["portrait_path"] = portrait
    response = client.post(f"/api/v1/campaigns/{CAMPAIGN_ID}/sheets", headers={"Authorization": "Bearer test-token"}, json=body)
    assert response.status_code == 422
    assert "character_sheets" not in [request.path for request in supabase.requests]


def test_create_route_persists_the_portrait_path() -> None:
    def respond(method: str, _path: str, _params: Any, payload: dict[str, Any] | None) -> Any:
        if method == "GET":
            return [template_row(marked_fields())]
        return [{"id": "00000000-0000-0000-0000-000000000004", **(payload or {}), "version": 1}]

    supabase = use_fake_supabase(app, FakeSupabase(user_id=USER_ID, on_request=respond))
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/sheets",
        headers={"Authorization": "Bearer test-token"},
        json={"template_id": TEMPLATE_ID, "name": "Mara", "values": {"strength": 3}, "portrait_path": PORTRAIT},
    )
    assert response.status_code == 201
    assert supabase.requests[-1].payload["portrait_path"] == PORTRAIT


def test_create_route_rejects_client_template_schema() -> None:
    use_fake_supabase(app, FakeSupabase(user_id=USER_ID))
    response = client.post(
        f"/api/v1/campaigns/{CAMPAIGN_ID}/sheets",
        headers={"Authorization": "Bearer test-token"},
        json={"template_id": TEMPLATE_ID, "name": "Mara", "schema": {"fields": []}},
    )
    assert response.status_code == 422
