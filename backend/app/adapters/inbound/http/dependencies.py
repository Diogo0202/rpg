"""Composição de dependências por requisição: liga portas aos adaptadores concretos.

Testes trocam ``supabase_session`` em ``app.dependency_overrides`` para usar um Supabase falso.
"""

from __future__ import annotations

from fastapi import Depends, Header

from app.adapters.outbound.email.invite_mailer import EnvironmentInviteMailer
from app.adapters.outbound.supabase.advance_repository import SupabaseAdvanceRepository
from app.adapters.outbound.supabase.chronicle_store import SupabaseChronicleStore
from app.adapters.outbound.supabase.invite_reservations import SupabaseInviteReservations
from app.adapters.outbound.supabase.marketplace import (
    SupabaseMarketplaceCatalog,
    SupabaseMarketplaceMember,
    SupabaseMarketplaceServiceRole,
)
from app.adapters.outbound.supabase.rest_client import SupabaseRest, SupabaseRestClient
from app.adapters.outbound.supabase.roll_activity import ChronicleRollRecorder
from app.adapters.outbound.supabase.sanguine_store import SupabaseSanguineStore
from app.adapters.outbound.supabase.sheet_repository import SupabaseSheetRepository
from app.adapters.outbound.supabase.sync_gateway import SupabaseSyncGateway, SupabaseSyncTransport, SyncTransport
from app.adapters.outbound.supabase.v5_repository import SupabaseV5Store
from app.adapters.outbound.supabase.weapon_reader import SupabaseWeaponReader
from app.application.chronicle.service import ChronicleService
from app.application.experience.service import ExperienceService
from app.application.invites.service import InviteEmailService, InviteMailer
from app.application.marketplace.ports import MarketplaceCatalog, MarketplaceServiceRole
from app.application.marketplace.service import MarketplaceService
from app.application.mobile_sync.service import MobileSyncService
from app.application.sheets.service import SheetService
from app.application.v5.actions import V5ActionService
from app.application.v5.blood import V5BloodService
from app.application.v5.ports import RollActivityRecorder, WeaponReader
from app.application.v5.rolls import V5RollService
from app.application.v5.sanguine import V5SanguineService


def supabase_session(authorization: str | None = Header(default=None)) -> SupabaseRest:
    return SupabaseRestClient(authorization)


def sheet_service(supabase: SupabaseRest = Depends(supabase_session)) -> SheetService:
    return SheetService(identity=supabase, sheets=SupabaseSheetRepository(supabase))


def experience_service(supabase: SupabaseRest = Depends(supabase_session)) -> ExperienceService:
    return ExperienceService(identity=supabase, advances=SupabaseAdvanceRepository(supabase))


def roll_activity_recorder(authorization: str | None = Header(default=None)) -> RollActivityRecorder:
    return ChronicleRollRecorder(authorization)


def v5_roll_service(
    supabase: SupabaseRest = Depends(supabase_session),
    activity: RollActivityRecorder = Depends(roll_activity_recorder),
) -> V5RollService:
    return V5RollService(SupabaseV5Store(supabase), activity)


def v5_blood_service(supabase: SupabaseRest = Depends(supabase_session)) -> V5BloodService:
    return V5BloodService(SupabaseV5Store(supabase))


def v5_sanguine_service(supabase: SupabaseRest = Depends(supabase_session)) -> V5SanguineService:
    return V5SanguineService(SupabaseSanguineStore(supabase))


def chronicle_service(supabase: SupabaseRest = Depends(supabase_session)) -> ChronicleService:
    return ChronicleService(identity=supabase, store=SupabaseChronicleStore(supabase))


def sync_transport(authorization: str | None = Header(default=None)) -> SyncTransport:
    return SupabaseSyncTransport(authorization)


def mobile_sync_service(transport: SyncTransport = Depends(sync_transport)) -> MobileSyncService:
    return MobileSyncService(SupabaseSyncGateway(transport))


def marketplace_catalog() -> MarketplaceCatalog:
    return SupabaseMarketplaceCatalog()


def marketplace_service_role() -> MarketplaceServiceRole:
    return SupabaseMarketplaceServiceRole()


def marketplace_service(
    supabase: SupabaseRest = Depends(supabase_session),
    catalog: MarketplaceCatalog = Depends(marketplace_catalog),
    service_role: MarketplaceServiceRole = Depends(marketplace_service_role),
) -> MarketplaceService:
    return MarketplaceService(supabase, catalog, SupabaseMarketplaceMember(supabase), service_role)


def invite_mailer() -> InviteMailer:
    return EnvironmentInviteMailer()


def invite_email_service(
    supabase: SupabaseRest = Depends(supabase_session), mailer: InviteMailer = Depends(invite_mailer),
) -> InviteEmailService:
    return InviteEmailService(SupabaseInviteReservations(supabase), mailer)


def weapon_reader(supabase: SupabaseRest = Depends(supabase_session)) -> WeaponReader:
    return SupabaseWeaponReader(supabase)


def v5_action_service(
    supabase: SupabaseRest = Depends(supabase_session),
    weapons: WeaponReader = Depends(weapon_reader),
    activity: RollActivityRecorder = Depends(roll_activity_recorder),
) -> V5ActionService:
    return V5ActionService(SupabaseV5Store(supabase), weapons, activity)
