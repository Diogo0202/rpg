"""Sincronização do aplicativo mobile (ADR 0001): campanhas visíveis, permissões e troca de operações."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol
from uuid import UUID

from pydantic import ValidationError

from app.application.mobile_sync.validation import campaign_row, changes_page, push_response, snapshot_page
from app.domain.errors import Forbidden, InvalidInput, UnexpectedUpstreamResponse
from app.services.mobile_sync import ENTITY_FIELDS, PROTOCOL_VERSION, SyncMutation

Row = dict[str, Any]
MAX_VISIBLE_CAMPAIGNS = 500
MEMBER_ROLES = frozenset({"master", "player", "guest"})
PLAYER_ENTITIES = ("character_sheets", "character_inventory")
NO_ACCESS = "acesso não permitido nesta campanha"
INVALID_CAMPAIGNS = "resposta inválida de campanhas"
INVALID_MEMBERS = "resposta inválida de membros"
UPSTREAM_PARSE_ERRORS = (ValidationError, ValueError, TypeError, KeyError, AttributeError, OverflowError)


class SyncGateway(Protocol):
    """Respostas cruas do armazenamento; o caso de uso valida cada uma antes de devolver."""

    async def visible_campaigns(self) -> Any: ...

    async def campaign(self, campaign_id: UUID) -> Any: ...

    async def membership(self, campaign_id: UUID, user_id: str) -> Any: ...

    async def push(self, campaign_id: UUID, device_id: UUID, mutations: list[Row]) -> Any: ...

    async def snapshot(self, campaign_id: UUID, entity_type: str, after_id: UUID | None, limit: int) -> Any: ...

    async def changes(self, campaign_id: UUID, cursor: int, limit: int) -> Any: ...


def checked(value: Any, validator: Callable[[Any], Row], label: str) -> Row:
    try:
        return validator(value)
    except UPSTREAM_PARSE_ERRORS as error:
        raise UnexpectedUpstreamResponse(f"resposta inválida de {label}") from error


def writable_fields(role: str) -> dict[str, list[str]]:
    """Campos que cada papel pode alterar pelo aplicativo."""
    manager = role in {"owner", "master"}
    writable: dict[str, list[str]] = {}
    if role == "owner":
        writable["campaigns"] = sorted(ENTITY_FIELDS["campaigns"])
    if manager:
        for entity_type, fields in ENTITY_FIELDS.items():
            if entity_type != "campaigns" and entity_type not in PLAYER_ENTITIES:
                writable[entity_type] = sorted(fields)
    if manager or role == "player":
        for entity_type in PLAYER_ENTITIES:
            writable[entity_type] = sorted(ENTITY_FIELDS[entity_type])
    return writable


class MobileSyncService:
    def __init__(self, gateway: SyncGateway) -> None:
        self._gateway = gateway

    async def campaigns(self) -> Row:
        rows = await self._gateway.visible_campaigns()

        def validate(value: Any) -> Row:
            if type(value) is not list or len(value) > MAX_VISIBLE_CAMPAIGNS:
                raise ValueError("lista inválida")
            return {"protocol_version": PROTOCOL_VERSION, "campaigns": [campaign_row(row) for row in value]}

        return checked(rows, validate, "campanhas")

    async def capabilities(self, campaign_id: UUID, user_id: str) -> Row:
        role = await self._role(campaign_id, user_id)
        return {
            "protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id),
            "role": role, "entity_fields": writable_fields(role),
        }

    async def push(self, campaign_id: UUID, device_id: UUID, mutations: list[SyncMutation]) -> Row:
        response = await self._gateway.push(
            campaign_id, device_id, [item.model_dump(mode="json", exclude_unset=True) for item in mutations],
        )
        return checked(response, lambda data: push_response(data, campaign_id, mutations), "push")

    async def snapshot(self, campaign_id: UUID, entity_type: str, after_id: UUID | None, limit: int) -> Row:
        if entity_type not in ENTITY_FIELDS:
            raise InvalidInput("entidade não aceita sincronização")
        response = await self._gateway.snapshot(campaign_id, entity_type, after_id, limit)
        return checked(response, lambda data: snapshot_page(data, campaign_id, entity_type), "snapshot")

    async def changes(self, campaign_id: UUID, cursor: int, limit: int) -> Row:
        response = await self._gateway.changes(campaign_id, cursor, limit)
        return checked(response, lambda data: changes_page(data, campaign_id), "changes")

    async def _role(self, campaign_id: UUID, user_id: str) -> str:
        campaigns = await self._gateway.campaign(campaign_id)
        if type(campaigns) is not list or len(campaigns) > 1:
            raise UnexpectedUpstreamResponse(INVALID_CAMPAIGNS)
        if not campaigns:
            raise Forbidden(NO_ACCESS)
        if _owner_of(campaigns[0], campaign_id) == UUID(user_id):
            return "owner"
        memberships = await self._gateway.membership(campaign_id, user_id)
        if type(memberships) is not list or len(memberships) > 1:
            raise UnexpectedUpstreamResponse(INVALID_MEMBERS)
        if not memberships:
            raise Forbidden(NO_ACCESS)
        member = memberships[0]
        if type(member) is not dict or set(member) != {"role"} or type(member["role"]) is not str or member["role"] not in MEMBER_ROLES:
            raise UnexpectedUpstreamResponse(INVALID_MEMBERS)
        return member["role"]


def _owner_of(campaign: Any, campaign_id: UUID) -> UUID:
    try:
        if type(campaign) is not dict or set(campaign) != {"id", "owner_id"} or UUID(campaign["id"]) != campaign_id:
            raise ValueError("campanha inválida")
        return UUID(campaign["owner_id"])
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise UnexpectedUpstreamResponse(INVALID_CAMPAIGNS) from error
