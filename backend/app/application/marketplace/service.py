"""Casos de uso do marketplace: catálogo, publicação, importação, votos, denúncias e moderação."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from app.application.identity import CurrentUser
from app.application.marketplace.ports import (
    CopyrightReport,
    MarketplaceCatalog,
    MarketplaceMember,
    MarketplaceServiceRole,
    Row,
    SearchQuery,
)
from app.domain.errors import Conflict, InvalidInput, NotFound, ServiceUnavailable
from app.domain.marketplace import PublishRequest, template_digest, validate_import_schema, validate_publication

logger = logging.getLogger(__name__)

CARD_FIELDS = (
    "id", "name", "description", "tags", "author_name", "automation_level", "dependencies",
    "updated_at", "usage_count", "likes", "dislikes",
)
# Leituras de moderação: só estes campos chegam ao cliente, nunca um id de usuário.
QUEUE_FIELDS = (
    "id", "system_id", "system_name", "author_name", "system_status", "reason", "created_at", "open_reports",
    "category", "claimed_work", "rights_holder", "evidence_url",
)
MODERATED_SYSTEM_FIELDS = ("id", "name", "author_name", "status", "updated_at", "open_reports")
HISTORY_FIELDS = (
    "id", "system_id", "system_name", "action", "previous_status", "current_status", "note", "from_report", "by_me", "created_at",
)
PUBLISHABLE_TEMPLATE_FIELDS = ("id", "campaign_id", "campaign_name", "name", "version")
PENDING_IMPORT_FIELDS = ("id", "name", "version", "schema", "source_name", "source_status")
SYSTEM_STATUSES = frozenset({"published", "hidden", "removed"})
MAX_TAG_LENGTH = 40


@dataclass(frozen=True)
class ExistingTemplatePublication:
    template_id: UUID
    expected_digest: str
    description: str
    tags: list[str]
    author_name: str
    dependencies: list[str]
    rights_confirmed: bool


def card(row: Row, *, detail: bool = False) -> Row:
    result = {field: row[field] for field in CARD_FIELDS}
    if detail:
        result["template"] = row["template"]
    return result


def only_fields(value: Any, fields: tuple[str, ...], invalid: str) -> list[Row]:
    """Copia só os campos públicos de cada linha; uma lista com item inválido é resposta inválida."""
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ServiceUnavailable(invalid)
    return [{field: row.get(field) for field in fields} for row in value]


def _moderation_rows(value: Any, fields: tuple[str, ...]) -> list[Row]:
    if not isinstance(value, list):
        raise ServiceUnavailable("resposta inválida da moderação")
    return [{field: row.get(field) for field in fields} for row in value if isinstance(row, dict)]


def _trimmed_or_none(text: str | None) -> str | None:
    return text.strip() if text and text.strip() else None


class MarketplaceService:
    def __init__(
        self,
        identity: CurrentUser,
        catalog: MarketplaceCatalog,
        member: MarketplaceMember,
        service_role: MarketplaceServiceRole,
    ) -> None:
        self._identity = identity
        self._catalog = catalog
        self._member = member
        self._service_role = service_role

    # Catálogo público -------------------------------------------------------------------

    async def search(self, text: str | None, tags: list[str], page: int, limit: int, sort: str) -> Row:
        if any(not tag.strip() or len(tag) > MAX_TAG_LENGTH for tag in tags):
            raise InvalidInput("tag inválida")
        # usage_count vem da coluna agregada; nada é contado na leitura.
        rows = await self._catalog.search(SearchQuery(_trimmed_or_none(text), [tag.strip() for tag in tags], page, limit, sort))
        return {"items": [card(row) for row in rows], "page": page, "limit": limit, "sort": sort}

    async def system(self, system_id: UUID) -> Row:
        rows = await self._catalog.published_system(system_id)
        if not rows:
            raise NotFound("sistema não encontrado")
        return card(rows[0], detail=True)

    # Publicação ---------------------------------------------------------------------------

    async def publish(self, publication: PublishRequest) -> Row:
        owner_id = await self._identity.current_user_id()
        return await self._publish_as(owner_id, publication)

    async def publishable_templates(self) -> Row:
        await self._identity.current_user_id()
        rows = await self._member.publishable_templates()
        return {"items": only_fields(rows, PUBLISHABLE_TEMPLATE_FIELDS, "lista de modelos inválida")}

    async def publishable_template(self, template_id: UUID) -> Row:
        await self._identity.current_user_id()
        schema = await self._exported_template(template_id)
        return {"template": schema, "digest": template_digest(schema)}

    async def publish_existing(self, request: ExistingTemplatePublication) -> Row:
        owner_id = await self._identity.current_user_id()
        schema = await self._exported_template(request.template_id)
        if template_digest(schema) != request.expected_digest:
            raise Conflict("o modelo mudou; confira a prévia novamente")
        try:
            publication = PublishRequest.model_validate({
                "template": schema, "description": request.description, "tags": request.tags,
                "author_name": request.author_name, "dependencies": request.dependencies,
                "rights_confirmed": request.rights_confirmed,
            })
        except (ValidationError, ValueError) as error:
            raise InvalidInput("modelo aprovado não atende às regras de publicação") from error
        return await self._publish_as(owner_id, publication)

    # Importação para campanhas ------------------------------------------------------------

    async def managed_campaigns(self) -> Row:
        await self._identity.current_user_id()
        rows = await self._member.managed_campaigns()
        return {"items": only_fields(rows, ("id", "name"), "lista de campanhas inválida")}

    async def pending_imports(self, campaign_id: UUID) -> Row:
        await self._identity.current_user_id()
        rows = await self._member.pending_imports(campaign_id)
        return {"items": only_fields(rows, PENDING_IMPORT_FIELDS, "lista de importações inválida")}

    async def approve_import(self, campaign_id: UUID, template_id: UUID) -> Row:
        await self._identity.current_user_id()
        review = await self._member.import_review(campaign_id, template_id)
        if not isinstance(review, dict) or not isinstance(review.get("schema"), dict):
            raise ServiceUnavailable("importação inválida")
        validate_import_schema(review["schema"])
        approved_id = await self._member.approve_import(campaign_id, template_id, review["schema"])
        if approved_id != str(template_id):
            raise ServiceUnavailable("aprovação não confirmada")
        return {"id": approved_id, "status": "approved"}

    # Participação -------------------------------------------------------------------------

    async def vote(self, system_id: UUID, value: int) -> Row:
        if value not in {-1, 1}:
            raise InvalidInput("vote deve ser 1 ou -1")
        await self._identity.current_user_id()
        await self._member.vote(system_id, value)
        return {"ok": True}

    async def report(self, system_id: UUID, reason: str) -> Row:
        await self._identity.current_user_id()
        await self._member.report(system_id, reason.strip())
        return {"ok": True}

    async def report_copyright(self, system_id: UUID, report: CopyrightReport) -> Row:
        await self._identity.current_user_id()
        await self._member.report_copyright(system_id, report)
        return {"ok": True}

    async def clone(self, system_id: UUID, campaign_id: UUID, idempotency_key: str) -> Row:
        """A cópia só grava um evento de uso; o contador é agregado depois da resposta."""
        await self._identity.current_user_id()
        result = await self._member.clone(system_id, campaign_id, idempotency_key)
        if not isinstance(result, dict):
            raise ServiceUnavailable("resposta inválida ao copiar o sistema")
        return result

    # Uso agregado ----------------------------------------------------------------------------

    async def aggregate_usage(self) -> int:
        applied = await self._service_role.apply_usage_events()
        if applied is None:
            raise ServiceUnavailable("chave de serviço não configurada")
        return applied

    async def aggregate_usage_in_background(self) -> None:
        """Tarefa pós-cópia: falhas só são registradas; o job periódico recupera o atraso."""
        try:
            await self._service_role.apply_usage_events()
        except Exception:  # noqa: BLE001 - a resposta da cópia já foi enviada
            logger.warning("marketplace usage aggregation failed; the periodic job will retry")

    # Moderação -------------------------------------------------------------------------------

    async def is_moderator(self) -> Row:
        """A decisão vem do banco, nunca do cliente."""
        await self._identity.current_user_id()
        return {"is_moderator": await self._member.is_moderator() is True}

    async def moderation_queue(self, page: int, limit: int) -> Row:
        await self._identity.current_user_id()
        rows = await self._member.moderation_queue(page, limit)
        return {"items": _moderation_rows(rows, QUEUE_FIELDS), "page": page, "limit": limit}

    async def moderation_systems(self, status: str | None, text: str | None, page: int, limit: int) -> Row:
        await self._identity.current_user_id()
        rows = await self._member.moderation_systems(status, _trimmed_or_none(text), page, limit)
        return {"items": _moderation_rows(rows, MODERATED_SYSTEM_FIELDS), "page": page, "limit": limit}

    async def moderation_log(self, page: int, limit: int) -> Row:
        await self._identity.current_user_id()
        rows = await self._member.moderation_history(page, limit)
        return {"items": _moderation_rows(rows, HISTORY_FIELDS), "page": page, "limit": limit}

    async def resolve_report(self, report_id: UUID, action: str, note: str) -> Row:
        await self._identity.current_user_id()
        await self._member.resolve_report(report_id, action, note)
        return {"ok": True}

    async def moderate_system(self, system_id: UUID, action: str, note: str) -> Row:
        await self._identity.current_user_id()
        status = await self._member.moderate_system(system_id, action, note)
        if status not in SYSTEM_STATUSES:
            raise ServiceUnavailable("resposta inválida da moderação")
        return {"ok": True, "status": status}

    # Apoio ------------------------------------------------------------------------------------

    async def _exported_template(self, template_id: UUID) -> Row:
        schema = await self._member.export_template(template_id)
        if not isinstance(schema, dict):
            raise ServiceUnavailable("modelo aprovado inválido")
        return schema

    async def _publish_as(self, owner_id: str, publication: PublishRequest) -> Row:
        record = validate_publication(publication)
        return card(await self._service_role.publish(owner_id, record), detail=True)
