from __future__ import annotations

import os
import re
import secrets
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, ValidationError, field_validator, model_validator

from app.services import marketplace


router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])
# Fora de /api/v1: não usa sessão de usuário; exige o segredo de manutenção do serviço.
maintenance_router = APIRouter(prefix="/internal/maintenance", tags=["maintenance"], include_in_schema=False)

_EVIDENCE_URL = re.compile(r"https?://[^\s]+", re.IGNORECASE)


class CopyrightReportRequest(BaseModel):
    """Denúncia de copyright: só texto e um link opcional; nenhum arquivo é aceito."""

    model_config = ConfigDict(extra="forbid")

    reason: StrictStr = Field(min_length=10, max_length=2000)
    claimed_work: StrictStr = Field(min_length=2, max_length=300)
    rights_holder: StrictStr = Field(min_length=2, max_length=200)
    evidence_url: StrictStr | None = Field(default=None, max_length=500)
    good_faith: StrictBool

    @model_validator(mode="before")
    @classmethod
    def no_attachments(cls, value: Any) -> Any:
        marketplace.reject_embedded_files(value)
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
        if not _EVIDENCE_URL.fullmatch(result):
            raise ValueError("o link deve começar com http:// ou https://")
        return result

    @field_validator("good_faith")
    @classmethod
    def statement_required(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("a declaração de boa-fé é obrigatória")
        return value


class VoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: StrictInt = Field(ge=-1, le=1)


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: StrictStr = Field(min_length=10, max_length=2000)


class CloneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    campaign_id: UUID
    idempotency_key: StrictStr = Field(min_length=8, max_length=100)


class PublishExistingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: UUID
    expected_digest: StrictStr = Field(pattern=r"^[a-f0-9]{64}$")
    description: StrictStr = Field(min_length=1, max_length=2000)
    tags: list[StrictStr] = Field(min_length=1, max_length=20)
    author_name: StrictStr = Field(min_length=1, max_length=80)
    dependencies: list[StrictStr] = Field(default_factory=list, max_length=30)
    rights_confirmed: StrictBool


def _required_reason(value: str) -> str:
    result = value.strip()
    if len(result) < 3:
        raise ValueError("informe o motivo da decisão")
    return result


class ResolveReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["restore", "remove"]
    note: StrictStr = Field(min_length=3, max_length=2000)

    @field_validator("note")
    @classmethod
    def trimmed_note(cls, value: str) -> str:
        return _required_reason(value)


class ModerateSystemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["hide", "restore", "remove"]
    note: StrictStr = Field(min_length=3, max_length=2000)

    @field_validator("note")
    @classmethod
    def trimmed_note(cls, value: str) -> str:
        return _required_reason(value)


# Leituras de moderação: somente campos desta lista chegam ao cliente (nenhum id de usuário).
_QUEUE_FIELDS = ("id", "system_id", "system_name", "author_name", "system_status", "reason", "created_at", "open_reports",
                 "category", "claimed_work", "rights_holder", "evidence_url")
_SYSTEM_FIELDS = ("id", "name", "author_name", "status", "updated_at", "open_reports")
_HISTORY_FIELDS = ("id", "system_id", "system_name", "action", "previous_status", "current_status", "note", "from_report", "by_me", "created_at")


def _rows(value: Any, fields: tuple[str, ...]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise HTTPException(status_code=503, detail="resposta inválida da moderação")
    return [{field: row.get(field) for field in fields} for row in value if isinstance(row, dict)]


def _card(row: dict[str, Any], *, detail: bool = False) -> dict[str, Any]:
    result = {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "tags": row["tags"],
        "author_name": row["author_name"],
        "automation_level": row["automation_level"],
        "dependencies": row["dependencies"],
        "updated_at": row["updated_at"],
        "usage_count": row["usage_count"],
        "likes": row["likes"],
        "dislikes": row["dislikes"],
    }
    if detail:
        result["template"] = row["template"]
    return result


@router.get("/systems")
async def list_systems(
    q: str | None = Query(default=None, max_length=120),
    tags: list[str] = Query(default=[] , max_length=20),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    sort: Literal["recent", "popular"] = Query(default="recent"),
) -> dict[str, Any]:
    if any(not tag.strip() or len(tag) > 40 for tag in tags):
        raise HTTPException(status_code=422, detail="tag inválida")
    # usage_count vem da coluna agregada (índice parcial); nada é contado na leitura.
    rows = await marketplace.request_public(
        "POST", "rpc/marketplace_search",
        payload={"p_q": q.strip() if q and q.strip() else None, "p_tags": [tag.strip() for tag in tags], "p_page": page, "p_limit": limit, "p_sort": sort},
    )
    return {"items": [_card(row) for row in rows], "page": page, "limit": limit, "sort": sort}


@router.get("/systems/{system_id}")
async def get_system(system_id: UUID) -> dict[str, Any]:
    rows = await marketplace.request_public(
        "GET", "marketplace_systems",
        params={"select": "id,name,description,tags,author_name,automation_level,dependencies,updated_at,usage_count,likes,dislikes,template", "id": f"eq.{system_id}", "status": "eq.published", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="sistema não encontrado")
    return _card(rows[0], detail=True)


@router.post("/systems")
async def publish_system(payload: marketplace.PublishRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    owner_id = await marketplace.current_user_id(authorization)
    record = marketplace.validate_publication(payload)
    published = await marketplace.publish_as_service(owner_id, record)
    return _card(published, detail=True)


@router.get("/publishable-templates")
async def publishable_templates(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    rows = await marketplace.request_user("POST", "rpc/marketplace_publishable_templates", authorization, payload={})
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise HTTPException(status_code=503, detail="lista de modelos inválida")
    fields = ("id", "campaign_id", "campaign_name", "name", "version")
    return {"items": [{field: row.get(field) for field in fields} for row in rows]}


@router.get("/managed-campaigns")
async def managed_campaigns(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    rows = await marketplace.request_user("POST", "rpc/marketplace_managed_campaigns", authorization, payload={})
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise HTTPException(status_code=503, detail="lista de campanhas inválida")
    return {"items": [{"id": row.get("id"), "name": row.get("name")} for row in rows]}


@router.get("/publishable-templates/{template_id}")
async def publishable_template(template_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    schema = await marketplace.request_user(
        "POST", "rpc/marketplace_export_template", authorization, payload={"p_template_id": str(template_id)},
    )
    if not isinstance(schema, dict):
        raise HTTPException(status_code=503, detail="modelo aprovado inválido")
    return {"template": schema, "digest": marketplace.template_digest(schema)}


@router.post("/systems/from-template")
async def publish_existing_template(
    payload: PublishExistingRequest, authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    owner_id = await marketplace.current_user_id(authorization)
    schema = await marketplace.request_user(
        "POST", "rpc/marketplace_export_template", authorization,
        payload={"p_template_id": str(payload.template_id)},
    )
    if not isinstance(schema, dict):
        raise HTTPException(status_code=503, detail="modelo aprovado inválido")
    if marketplace.template_digest(schema) != payload.expected_digest:
        raise HTTPException(status_code=409, detail="o modelo mudou; confira a prévia novamente")
    try:
        publication = marketplace.PublishRequest.model_validate({
            "template": schema,
            "description": payload.description,
            "tags": payload.tags,
            "author_name": payload.author_name,
            "dependencies": payload.dependencies,
            "rights_confirmed": payload.rights_confirmed,
        })
    except (ValidationError, ValueError) as error:
        raise HTTPException(status_code=422, detail="modelo aprovado não atende às regras de publicação") from error
    record = marketplace.validate_publication(publication)
    published = await marketplace.publish_as_service(owner_id, record)
    return _card(published, detail=True)


@router.post("/systems/{system_id}/vote")
async def vote_system(system_id: UUID, payload: VoteRequest, authorization: str | None = Header(default=None)) -> dict[str, bool]:
    if payload.value not in {-1, 1}:
        raise HTTPException(status_code=422, detail="vote deve ser 1 ou -1")
    await marketplace.current_user_id(authorization)
    await marketplace.request_user("POST", "rpc/marketplace_vote", authorization, payload={"p_system_id": str(system_id), "p_value": payload.value})
    return {"ok": True}


@router.post("/systems/{system_id}/report")
async def report_system(system_id: UUID, payload: ReportRequest, authorization: str | None = Header(default=None)) -> dict[str, bool]:
    await marketplace.current_user_id(authorization)
    await marketplace.request_user(
        "POST", "rpc/marketplace_report", authorization,
        payload={"p_system_id": str(system_id), "p_reason": payload.reason.strip()},
    )
    return {"ok": True}


@router.post("/systems/{system_id}/report/copyright")
async def report_copyright(system_id: UUID, payload: CopyrightReportRequest, authorization: str | None = Header(default=None)) -> dict[str, bool]:
    await marketplace.current_user_id(authorization)
    await marketplace.request_user(
        "POST", "rpc/marketplace_report_copyright", authorization,
        payload={
            "p_system_id": str(system_id), "p_reason": payload.reason, "p_claimed_work": payload.claimed_work,
            "p_rights_holder": payload.rights_holder, "p_evidence_url": payload.evidence_url, "p_good_faith": True,
        },
    )
    return {"ok": True}


@router.post("/systems/{system_id}/clone")
async def clone_system(
    system_id: UUID,
    payload: CloneRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    result = await marketplace.request_user(
        "POST", "rpc/marketplace_clone", authorization,
        payload={"p_system_id": str(system_id), "p_campaign_id": str(payload.campaign_id), "p_idempotency_key": payload.idempotency_key},
    )
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="resposta inválida ao copiar o sistema")
    # A cópia só grava um evento; o contador é agregado depois da resposta.
    background_tasks.add_task(marketplace.apply_usage_events_in_background)
    return result


@maintenance_router.post("/marketplace-usage")
async def run_usage_aggregation(x_maintenance_token: str | None = Header(default=None)) -> dict[str, int]:
    """Gatilho periódico (cron externo) quando pg_cron não está disponível."""
    expected = os.getenv("MARKETPLACE_MAINTENANCE_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="manutenção não configurada")
    if not x_maintenance_token or len(x_maintenance_token) > 512 or not secrets.compare_digest(
        x_maintenance_token.encode("utf-8"), expected.encode("utf-8")
    ):
        raise HTTPException(status_code=403, detail="manutenção não autorizada")
    applied = await marketplace.apply_usage_events()
    if applied is None:
        raise HTTPException(status_code=503, detail="chave de serviço não configurada")
    return {"applied": applied}


@router.get("/moderation/reports")
async def list_moderation_reports(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    reports = await marketplace.request_user(
        "POST", "rpc/marketplace_moderation_queue", authorization,
        payload={"p_page": page, "p_limit": limit},
    )
    return {"items": _rows(reports, _QUEUE_FIELDS), "page": page, "limit": limit}


@router.get("/moderation/me")
async def moderation_access(authorization: str | None = Header(default=None)) -> dict[str, bool]:
    """Diz à interface se a sessão é moderadora; a decisão vem do banco, nunca do cliente."""
    await marketplace.current_user_id(authorization)
    result = await marketplace.request_user("POST", "rpc/marketplace_is_moderator", authorization, payload={})
    return {"is_moderator": result is True}


@router.get("/moderation/systems")
async def list_moderation_systems(
    status: Literal["published", "hidden", "removed"] | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    rows = await marketplace.request_user(
        "POST", "rpc/marketplace_moderation_systems", authorization,
        payload={"p_status": status, "p_q": q.strip() if q and q.strip() else None, "p_page": page, "p_limit": limit},
    )
    return {"items": _rows(rows, _SYSTEM_FIELDS), "page": page, "limit": limit}


@router.get("/moderation/log")
async def list_moderation_log(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    rows = await marketplace.request_user(
        "POST", "rpc/marketplace_moderation_history", authorization,
        payload={"p_page": page, "p_limit": limit},
    )
    return {"items": _rows(rows, _HISTORY_FIELDS), "page": page, "limit": limit}


@router.post("/moderation/reports/{report_id}/resolve")
async def resolve_moderation_report(
    report_id: UUID,
    payload: ResolveReportRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, bool]:
    await marketplace.current_user_id(authorization)
    await marketplace.request_user(
        "POST", "rpc/marketplace_resolve_report", authorization,
        payload={"p_report_id": str(report_id), "p_action": payload.action, "p_resolution_note": payload.note},
    )
    return {"ok": True}


@router.post("/moderation/systems/{system_id}")
async def moderate_system(
    system_id: UUID,
    payload: ModerateSystemRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    await marketplace.current_user_id(authorization)
    status = await marketplace.request_user(
        "POST", "rpc/marketplace_moderate_system", authorization,
        payload={"p_system_id": str(system_id), "p_action": payload.action, "p_note": payload.note},
    )
    if status not in {"published", "hidden", "removed"}:
        raise HTTPException(status_code=503, detail="resposta inválida da moderação")
    return {"ok": True, "status": status}
