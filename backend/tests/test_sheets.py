from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.routes import sheets
from app.routes.sheets import SheetCreate, SheetUpdate, _template_fields, _validate_values
from fastapi import HTTPException


sheets_app = FastAPI()
sheets_app.include_router(sheets.router)
client = TestClient(sheets_app)
TEMPLATE_SCHEMA = {
    "fields": [
        {"id": "character_name", "kind": "text"},
        {"id": "strength", "kind": "number"},
        {"id": "clan", "kind": "select", "options": ["Brujah", "Toreador"]},
        {"id": "active", "kind": "checkbox"},
        {"id": "inventory", "kind": "collection"},
        {"id": "pool", "kind": "formula", "expression": "strength + 2"},
    ]
}


def test_modular_sheet_payload_and_field_validation() -> None:
    sheet = SheetCreate(
        template_id=UUID("00000000-0000-0000-0000-000000000001"),
        name="Mara Vale",
        values={"character_name": "Mara Vale", "strength": 3, "clan": "Brujah", "active": True, "inventory": []},
    )
    assert sheet.values["strength"] == 3
    fields = _template_fields({"schema": TEMPLATE_SCHEMA})
    _validate_values(sheet.values, fields)
    _validate_values({"pool": None}, fields)


@pytest.mark.parametrize(
    "values",
    [
        {"not_in_template": "value"},
        {"strength": True},
        {"clan": "Ventrue"},
        {"active": "yes"},
        {"inventory": {}},
        {"pool": 7},
    ],
)
def test_modular_sheet_rejects_unknown_or_mistyped_fields(values: dict[str, object]) -> None:
    with pytest.raises(HTTPException) as error:
        _validate_values(values, _template_fields({"schema": TEMPLATE_SCHEMA}))
    assert error.value.status_code == 422


def test_modular_sheet_requires_non_calculated_required_fields() -> None:
    fields = _template_fields({"schema": {"fields": [{"id": "character_name", "kind": "text", "required": True}]}})
    with pytest.raises(HTTPException, match="campo obrigatório ausente"):
        _validate_values({}, fields)


def test_sheet_payload_requires_version_and_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        SheetUpdate(name="Mara")
    with pytest.raises(ValidationError):
        SheetUpdate(expected_version=1, owner_id="attacker")


def test_sheet_routes_require_a_supabase_session(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "public-test-key")
    response = client.get("/api/v1/campaigns/00000000-0000-0000-0000-000000000001/sheets")
    assert response.status_code == 401
