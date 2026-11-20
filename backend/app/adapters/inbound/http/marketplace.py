"""Adaptador HTTP do marketplace e do gatilho de manutenção da contagem de uso."""

from __future__ import annotations

import os
import re
import secrets
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator, model_validator

from app.adapters.inbound.http.dependencies import marketplace_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.marketplace.ports import CopyrightReport
from app.application.marketplace.service import ExistingTemplatePublication, MarketplaceService
from app.domain.errors import Forbidden, ServiceUnavailable
from app.domain.marketplace import PublishRequest, reject_embedded_files

router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"], route_class=DomainErrorRoute)
# Fora de /api/v1: não usa sessão de usuário; exige o segredo de manutenção do serviço.
maintenance_router = APIRouter(
    prefix="/internal/maintenance", tags=["maintenance"], include_in_schema=False, route_class=DomainErrorRoute,
)
Marketplace = Depends(marketplace_service)

EVIDENCE_URL = re.compile(r"https?://[^\s]+", re.IGNORECASE)
MAX_MAINTENANCE_TOKEN_LENGTH = 512
MAX_PAGE_SIZE = 50


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _required_reason(value: str) -> str:
    result = value.strip()
    if len(result) < 3:
        raise ValueError("informe o motivo da decisão")
    return result


class CopyrightReportRequest(_Strict):
    """Denúncia de copyright: só texto e um link opcional; nenhum arquivo é aceito."""

    reason: StrictStr = Field(min_length=10, max_length=2000)
    claimed_work: StrictStr = Field(min_length=2, max_length=300)
    rights_holder: StrictStr = Field(min_length=2, max_length=200)
    evidence_url: StrictStr | None = Field(default=None, max_length=500)
    good_faith: StrictBool

    @model_validator(mode="before")
    @classmethod
    def no_attachments(cls, value: Any) -> Any:
        reject_embedded_files(value)
        return value

    @field_validator("reason", "claimed_work", "rights_holder")
    @classmethod
    def trimmed(cls, value: str) -> str:
        result = value.strip()
        if len(result) < 2:
            raise ValueError("o campo não pode ficar vazio")
        return result

    @field_validator("evidence_url")
    @classmethod
    def http_link(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        result = value.strip()
        if not EVIDENCE_URL.fullmatch(result):
            raise ValueError("o link deve começar com http:// ou https://")
        return result

    @field_validator("good_faith")
    @classmethod
    def statement_required(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("a declaração de boa-fé é obrigatória")
        return value


class VoteRequest(_Strict):
    value: StrictInt = Field(ge=-1, le=1)


class ReportRequest(_Strict):
    reason: StrictStr = Field(min_length=10, max_length=2000)


class CloneRequest(_Strict):
    campaign_id: UUID
    idempotency_key: StrictStr = Field(min_length=8, max_length=100)


class PublishExistingRequest(_Strict):
    template_id: UUID
    expected_digest: StrictStr = Field(pattern=r"^[a-f0-9]{64}$")
    description: StrictStr = Field(min_length=1, max_length=2000)
    tags: list[StrictStr] = Field(min_length=1, max_length=20)
    author_name: StrictStr = Field(min_length=1, max_length=80)
    dependencies: list[StrictStr] = Field(default_factory=list, max_length=30)
    rights_confirmed: StrictBool


class ResolveReportRequest(_Strict):
    action: Literal["restore", "remove"]
    note: StrictStr = Field(min_length=3, max_length=2000)

    @field_validator("note")
    @classmethod
    def trimmed_note(cls, value: str) -> str:
        return _required_reason(value)


class ModerateSystemRequest(_Strict):
    action: Literal["hide", "restore", "remove"]
    note: StrictStr = Field(min_length=3, max_length=2000)

    @field_validator("note")
    @classmethod
    def trimmed_note(cls, value: str) -> str:
        return _required_reason(value)


# Catálogo e publicação ------------------------------------------------------------------


@router.get("/systems")
async def list_systems(
    q: str | None = Query(default=None, max_length=120),
    tags: list[str] = Query(default=[], max_length=20),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=MAX_PAGE_SIZE),
    sort: Literal["recent", "popular"] = Query(default="recent"),
    service: MarketplaceService = Marketplace,
) -> dict[str, Any]:
    return await service.search(q, tags, page, limit, sort)


@router.get("/systems/{system_id}")
async def get_system(system_id: UUID, service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.system(system_id)


@router.post("/systems")
async def publish_system(payload: PublishRequest, service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.publish(payload)


@router.get("/publishable-templates")
async def publishable_templates(service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.publishable_templates()


@router.get("/publishable-templates/{template_id}")
async def publishable_template(template_id: UUID, service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.publishable_template(template_id)


@router.post("/systems/from-template")
async def publish_existing_template(payload: PublishExistingRequest, service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.publish_existing(ExistingTemplatePublication(**payload.model_dump()))


# Importação ---------------------------------------------------------------------------------


@router.get("/managed-campaigns")
async def managed_campaigns(service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.managed_campaigns()


@router.get("/campaigns/{campaign_id}/imports")
async def pending_imports(campaign_id: UUID, service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.pending_imports(campaign_id)


@router.post("/campaigns/{campaign_id}/imports/{template_id}/approve")
async def approve_import(campaign_id: UUID, template_id: UUID, service: MarketplaceService = Marketplace) -> dict[str, Any]:
    return await service.approve_import(campaign_id, template_id)


# Participação ---------------------------------------------------------------------------------


@router.post("/systems/{system_id}/vote")
async def vote_system(system_id: UUID, payload: VoteRequest, service: MarketplaceService = Marketplace) -> dict[str, bool]:
    return await service.vote(system_id, payload.value)


@router.post("/systems/{system_id}/report")
async def report_system(system_id: UUID, payload: ReportRequest, service: MarketplaceService = Marketplace) -> dict[str, bool]:
    return await service.report(system_id, payload.reason)


@router.post("/systems/{system_id}/report/copyright")
async def report_copyright(
    system_id: UUID, payload: CopyrightReportRequest, service: MarketplaceService = Marketplace,
) -> dict[str, bool]:
    report = CopyrightReport(payload.reason, payload.claimed_work, payload.rights_holder, payload.evidence_url)
    return await service.report_copyright(system_id, report)


@router.post("/systems/{system_id}/clone")
async def clone_system(
    system_id: UUID, payload: CloneRequest, background_tasks: BackgroundTasks, service: MarketplaceService = Marketplace,
) -> dict[str, Any]:
    result = await service.clone(system_id, payload.campaign_id, payload.idempotency_key)
    background_tasks.add_task(service.aggregate_usage_in_background)
    return result


@maintenance_router.post("/marketplace-usage")
async def run_usage_aggregation(
    x_maintenance_token: str | None = Header(default=None), service: MarketplaceService = Marketplace,
) -> dict[str, int]:
    """Gatilho periódico (cron externo) quando pg_cron não está disponível."""
    expected = os.getenv("MARKETPLACE_MAINTENANCE_TOKEN")
    if not expected:
        raise ServiceUnavailable("manutenção não configurada")
    if not _same_secret(x_maintenance_token, expected):
        raise Forbidden("manutenção não autorizada")
    return {"applied": await service.aggregate_usage()}


def _same_secret(given: str | None, expected: str) -> bool:
    if not given or len(given) > MAX_MAINTENANCE_TOKEN_LENGTH:
        return False
    return secrets.compare_digest(given.encode("utf-8"), expected.encode("utf-8"))


# Moderação --------------------------------------------------------------------------------------


@router.get("/moderation/me")
async def moderation_access(service: MarketplaceService = Marketplace) -> dict[str, bool]:
    return await service.is_moderator()


@router.get("/moderation/reports")
async def list_moderation_reports(
    page: int = Query(default=1, ge=1), limit: int = Query(default=20, ge=1, le=MAX_PAGE_SIZE),
    service: MarketplaceService = Marketplace,
) -> dict[str, Any]:
    return await service.moderation_queue(page, limit)


@router.get("/moderation/systems")
async def list_moderation_systems(
    status: Literal["published", "hidden", "removed"] | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=MAX_PAGE_SIZE),
    service: MarketplaceService = Marketplace,
) -> dict[str, Any]:
    return await service.moderation_systems(status, q, page, limit)


@router.get("/moderation/log")
async def list_moderation_log(
    page: int = Query(default=1, ge=1), limit: int = Query(default=20, ge=1, le=MAX_PAGE_SIZE),
    service: MarketplaceService = Marketplace,
) -> dict[str, Any]:
    return await service.moderation_log(page, limit)


@router.post("/moderation/reports/{report_id}/resolve")
async def resolve_moderation_report(
    report_id: UUID, payload: ResolveReportRequest, service: MarketplaceService = Marketplace,
) -> dict[str, bool]:
    return await service.resolve_report(report_id, payload.action, payload.note)


@router.post("/moderation/systems/{system_id}")
async def moderate_system(
    system_id: UUID, payload: ModerateSystemRequest, service: MarketplaceService = Marketplace,
) -> dict[str, Any]:
    return await service.moderate_system(system_id, payload.action, payload.note)
