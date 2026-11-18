import asyncio
from uuid import UUID

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app.adapters.inbound.http import sheets
from app.adapters.outbound.supabase.sheet_repository import SupabaseSheetRepository
from app.application.sheets.service import SheetService
from app.main import app
from tests.support.fake_supabase import FakeSupabase


client = TestClient(app)
CAMPAIGN = "de100000-0000-4000-8000-000000000001"
SHEET = "de300000-0000-4000-8000-000000000001"
POWER = "de500000-0000-4000-8000-000000000001"
OPERATION = "de400000-0000-4000-8000-000000000001"


def test_demon_registration_and_activation_require_session():
    assert client.get(f"/api/v1/campaigns/{CAMPAIGN}/demon/evocations").status_code == 401
    assert client.post(f"/api/v1/sheets/{SHEET}/demon/evocations/activate", json={
        "evocation_id": POWER, "operation_id": OPERATION, "expected_version": 1,
    }).status_code == 401


def test_activation_passes_version_and_operation_id_to_atomic_rpc():
    supabase = FakeSupabase(
        user_id="de000000-0000-4000-8000-000000000002",
        on_rpc=lambda *_: {"activation": {"operation_id": OPERATION, "faith_after": 1}},
    )
    service = SheetService(identity=supabase, sheets=SupabaseSheetRepository(supabase))
    result = asyncio.run(sheets.activate_demon_evocation(
        UUID(SHEET), sheets.DemonEvocationActivation(
            evocation_id=UUID(POWER), operation_id=UUID(OPERATION), expected_version=1,
        ), service=service,
    ))
    assert result["activation"]["faith_after"] == 1
    assert supabase.rpcs == [("activate_demon_evocation", {
        "p_sheet_id": SHEET, "p_evocation_id": POWER,
        "p_operation_id": OPERATION, "p_expected_version": 1,
    })]


def test_registration_rejects_unverified_cost_shape():
    with pytest.raises(ValidationError):
        sheets.DemonEvocationRegister(
            name="Chama", lore_field="dou_chama", required_rank=2,
            faith_cost=True, source_title="Livro", source_page=170,
            verification_note="Conferido pelo narrador",
        )
