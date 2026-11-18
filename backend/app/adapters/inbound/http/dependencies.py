"""Composição de dependências por requisição: liga portas aos adaptadores concretos.

Testes trocam ``supabase_session`` em ``app.dependency_overrides`` para usar um Supabase falso.
"""

from __future__ import annotations

from fastapi import Depends, Header

from app.adapters.outbound.supabase.rest_client import SupabaseRest, SupabaseRestClient
from app.adapters.outbound.supabase.sheet_repository import SupabaseSheetRepository
from app.application.sheets.service import SheetService


def supabase_session(authorization: str | None = Header(default=None)) -> SupabaseRest:
    return SupabaseRestClient(authorization)


def sheet_service(supabase: SupabaseRest = Depends(supabase_session)) -> SheetService:
    return SheetService(identity=supabase, sheets=SupabaseSheetRepository(supabase))
