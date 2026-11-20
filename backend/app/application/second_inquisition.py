"""Segunda Inquisição: eventos confirmados pelo narrador, avaliação da ameaça e respostas aplicadas."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

from app.application.generated_content import ContentApplication, ContentApplications, apply_content
from app.application.identity import CurrentUser
from app.domain.errors import Conflict, Forbidden, InvalidInput, LimitExceeded, NotFound, UnexpectedUpstreamResponse
from app.domain.combat_blocks import deterministic_seed, second_inquisition_block
from app.domain.second_inquisition import EventKind, ResponseKind, ThreatAssessment, VerificationBasis, VerifiedEvent, assess_threat

Row = dict[str, Any]
MAX_EVENTS = 1000
PAGE_SIZE = 500
MANAGER_ROLES = frozenset({"master", "owner"})

# Jogadores leem o mundo: só a descrição narrativa vai para a entidade.
RESPONSE_ENTITIES = {
    ResponseKind.CONTAINMENT: ("npc", "Equipe de contenção da Segunda Inquisição", "Agentes treinados enviados para conter a ameaça."),
    ResponseKind.WIRETAP: ("event", "Monitoramento de comunicações da SI", "A Segunda Inquisição passou a vigiar comunicações ligadas à coterie."),
    ResponseKind.FINANCIAL_BLOCK: ("event", "Restrição financeira da SI", "Contas e recursos ligados à coterie foram congelados."),
}


class InquisitionStore(Protocol):
    async def campaign_owner(self, campaign_id: UUID) -> str | None:
        """Dono da campanha; ``None`` quando ela não existe ou não é visível."""

    async def member_role(self, campaign_id: UUID, user_id: str) -> str | None: ...

    async def events_page(self, campaign_id: UUID, limit: int, offset: int) -> Any: ...

    async def confirm(self, campaign_id: UUID, event_kind: str, area_id: str, occurred_at: datetime) -> Any: ...

    async def revoke(self, campaign_id: UUID, event_id: UUID, expected_version: int) -> Any: ...


@dataclass(frozen=True)
class ResponseOrder:
    """SI-06: o narrador escolhe aplicar uma resposta já acionada pela avaliação."""

    save_entity: bool
    combat_id: UUID | None
    idempotency_key: UUID


def _parse_timestamp(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp de evento inválido")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp de evento sem fuso horário")
    return parsed


def verified_event(row: Row, campaign_id: UUID) -> VerifiedEvent:
    if row.get("campaign_id") != str(campaign_id):
        raise ValueError("evento retornado fora da campanha solicitada")
    return VerifiedEvent(
        event_id=str(row["id"]),
        campaign_id=str(campaign_id),
        event_kind=EventKind(row["event_kind"]),
        occurred_at=_parse_timestamp(row["occurred_at"]),
        area_id=row["area_id"],
        verification_basis=VerificationBasis.NARRATOR_CONFIRMATION,
        verified_at=_parse_timestamp(row["verified_at"]),
    )


class SecondInquisitionService:
    def __init__(self, identity: CurrentUser, store: InquisitionStore, applications: ContentApplications) -> None:
        self._identity = identity
        self._store = store
        self._applications = applications

    async def assessment(self, campaign_id: UUID) -> Row:
        await self._require_manager(campaign_id)
        rows = await self._all_events(campaign_id)
        _, assessment = self._assess(campaign_id, rows, "avaliação")
        return {"events": rows, "assessment": assessment.model_dump(mode="json")}

    async def confirm(self, campaign_id: UUID, event_kind: EventKind, area_id: str, occurred_at: datetime) -> Row:
        await self._require_manager(campaign_id)
        if len(await self._all_events(campaign_id)) >= MAX_EVENTS:
            raise LimitExceeded("limite de 1000 eventos alcançado; retire uma confirmação antes de registrar outra")
        rows = await self._store.confirm(campaign_id, event_kind.value, area_id, occurred_at)
        if not isinstance(rows, list) or not rows:
            raise UnexpectedUpstreamResponse("Supabase não retornou a confirmação criada")
        return rows[0]

    async def revoke(self, campaign_id: UUID, event_id: UUID, expected_version: int) -> None:
        await self._require_manager(campaign_id)
        rows = await self._store.revoke(campaign_id, event_id, expected_version)
        if not isinstance(rows, list) or not rows:
            raise Conflict("evento alterado ou indisponível; atualize antes de retirar a confirmação")

    async def apply_response(self, campaign_id: UUID, response_kind: ResponseKind, order: ResponseOrder) -> Row:
        await self._require_manager(campaign_id)
        events, assessment = self._assess(campaign_id, await self._all_events(campaign_id), "aplicação")
        response = next((item for item in assessment.responses if item.kind == response_kind), None)
        if response is None:
            raise Conflict("esta resposta não está acionada no nível atual da SI")
        entity_kind, name, description = RESPONSE_ENTITIES[response_kind]
        block = None
        if response_kind == ResponseKind.CONTAINMENT:
            block = self._containment_block(campaign_id, response, assessment, events)
            name = f"{name} (nível {assessment.level})"
        elif order.combat_id is not None:
            raise InvalidInput("somente a equipe de contenção entra no combate")
        result = await apply_content(self._applications, ContentApplication(
            campaign_id=campaign_id,
            idempotency_key=order.idempotency_key,
            source_kind="second_inquisition",
            source_ref={
                "response_kind": response_kind.value, "title": response.title, "level": assessment.level,
                "level_name": assessment.level_name, "score": assessment.score,
                "verified_event_count": assessment.verified_event_count,
                "triggered_at_level": response.triggered_at_level, "stats": dict(response.stats),
            },
            name=name,
            entity_kind=entity_kind,
            entity_body={"description": description, "role": "antagonist", "source": "Segunda Inquisição (aplicada pelo narrador)"},
            save_entity=order.save_entity,
            combat_id=order.combat_id,
            combat_block=block,
        ))
        return {"application": result, "response": response.model_dump(mode="json"), "combat_block": block}

    # Apoio --------------------------------------------------------------------------------

    async def _require_manager(self, campaign_id: UUID) -> None:
        user_id = await self._identity.current_user_id()
        owner = await self._store.campaign_owner(campaign_id)
        if owner is None:
            raise NotFound("campanha não encontrada")
        if owner == user_id or await self._store.member_role(campaign_id, user_id) in MANAGER_ROLES:
            return
        raise Forbidden("somente mestre ou proprietário pode consultar confirmações")

    async def _all_events(self, campaign_id: UUID) -> list[Row]:
        """Lê todas as páginas; acima do limite recusa em vez de avaliar uma lista truncada."""
        events: list[Row] = []
        while True:
            page = await self._store.events_page(campaign_id, PAGE_SIZE, len(events))
            if not isinstance(page, list):
                raise UnexpectedUpstreamResponse("resposta inválida ao ler eventos")
            events.extend(page)
            if len(events) > MAX_EVENTS:
                raise LimitExceeded("esta campanha excede 1000 eventos; avaliação cancelada sem truncar dados")
            if len(page) < PAGE_SIZE:
                return events

    @staticmethod
    def _assess(campaign_id: UUID, rows: list[Row], action: str) -> tuple[list[VerifiedEvent], ThreatAssessment]:
        try:
            events = [verified_event(row, campaign_id) for row in rows]
            return events, assess_threat(str(campaign_id), events)
        except (KeyError, TypeError, ValueError) as error:
            raise Conflict(f"eventos confirmados inválidos; {action} cancelada") from error

    @staticmethod
    def _containment_block(campaign_id: UUID, response: Any, assessment: ThreatAssessment, events: list[VerifiedEvent]) -> Row:
        latest = max((event.verified_at.isoformat() for event in events), default="")
        seed = deterministic_seed(str(campaign_id), ResponseKind.CONTAINMENT.value, str(assessment.level), str(len(events)), latest)
        try:
            return second_inquisition_block(dict(response.stats), assessment.level, seed).model_dump(mode="json")
        except ValueError as error:
            raise Conflict(str(error)) from error
