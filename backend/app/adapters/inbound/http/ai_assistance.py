"""Adaptador HTTP da assistência por IA da campanha: tutor matemático, rascunhos e propostas."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr

from app.adapters.inbound.http.dependencies import supabase_session
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.ai.provider import OpenAiProvider
from app.adapters.outbound.supabase.ai_store import SupabaseAiCampaignStore, SupabaseAiPrivateStore, SupabaseCampaignActors
from app.adapters.outbound.supabase.rest_client import SupabaseRest
from app.application.ai.paid_generation import PaidGeneration
from app.application.ai.ports import Actor, AiPrivateStore, AiProvider
from app.application.ai.service import (
    AiAssistanceService,
    ContextRef as ContextReference,
    DraftOrder,
    ProposalOrder,
    RefinementOrder,
    TutorQuestion,
    content_hash,
)

router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}/ai", tags=["ai-assistance"], route_class=DomainErrorRoute)
Kind = Literal["sheet", "session", "npc"]
HASH_PATTERN = r"^[a-f0-9]{64}$"
TRAIT_PATTERN = r"^[a-z][a-z0-9_]{1,63}$"


# Composição ------------------------------------------------------------------------------------


async def campaign_actor(campaign_id: UUID, request: Request, supabase: SupabaseRest = Depends(supabase_session)) -> Actor:
    verified = getattr(request.state, "supabase_user", None)
    verified_id = verified["id"] if verified else None
    return await SupabaseCampaignActors(supabase, verified_id).actor(campaign_id)


def ai_private_store() -> AiPrivateStore:
    return SupabaseAiPrivateStore()


def ai_provider() -> AiProvider:
    return OpenAiProvider()


def paid_generation(
    private: AiPrivateStore = Depends(ai_private_store), provider: AiProvider = Depends(ai_provider),
) -> PaidGeneration:
    return PaidGeneration(private, provider)


def ai_service(
    supabase: SupabaseRest = Depends(supabase_session),
    private: AiPrivateStore = Depends(ai_private_store),
    provider: AiProvider = Depends(ai_provider),
    paid: PaidGeneration = Depends(paid_generation),
) -> AiAssistanceService:
    return AiAssistanceService(SupabaseAiCampaignStore(supabase), private, provider, paid)


CurrentActor = Depends(campaign_actor)
Service = Depends(ai_service)


# Formatos de entrada ---------------------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContextRef(_Strict):
    kind: Literal["session", "event", "entity", "sheet"]
    id: UUID


class ContextSelection(_Strict):
    context_refs: list[ContextRef] = Field(default_factory=list, max_length=12)

    def references(self) -> list[ContextReference]:
        return [ContextReference(ref.kind, ref.id) for ref in self.context_refs]


class ProposalCreate(ContextSelection):
    kind: Kind
    brief: StrictStr = Field(min_length=3, max_length=6000)
    template_id: UUID | None = None
    target_id: UUID | None = None
    context_hash: StrictStr | None = Field(default=None, pattern=HASH_PATTERN)
    idempotency_key: UUID

    def order(self) -> ProposalOrder:
        return ProposalOrder(
            self.kind, self.brief, self.template_id, self.target_id, self.references(), self.context_hash,
            self.idempotency_key, content_hash(self.model_dump(mode="json")),
        )


class ProposalRefine(ContextSelection):
    expected_version: StrictInt = Field(ge=1)
    instruction: StrictStr = Field(min_length=3, max_length=6000)
    context_hash: StrictStr | None = Field(default=None, pattern=HASH_PATTERN)
    idempotency_key: UUID
    result: dict[str, Any] | None = None

    def order(self) -> RefinementOrder:
        return RefinementOrder(
            self.expected_version, self.instruction, self.references(), self.context_hash,
            self.idempotency_key, self.result, content_hash(self.model_dump(mode="json")),
        )


class Review(_Strict):
    expected_version: StrictInt = Field(ge=1)


class Approval(Review):
    result: dict[str, Any]


class Publication(Review):
    fields: dict[str, Any]


class DraftCreate(_Strict):
    kind: Literal["npc", "enemy", "item"]
    brief: str = Field(min_length=3, max_length=1000)
    system_key: str | None = Field(default=None, pattern=r"^[a-z0-9-]{1,80}$")
    threat: Literal["baixa", "média", "alta", "chefe"] | None = None
    idempotency_key: UUID


TutorValue = Annotated[StrictInt | StrictFloat, Field(ge=-1_000_000, le=1_000_000)]


class TutorRequest(_Strict):
    expression: StrictStr = Field(min_length=1, max_length=120)
    values: dict[Annotated[str, Field(pattern=TRAIT_PATTERN)], TutorValue] = Field(default_factory=dict, max_length=20)
    explain: StrictBool = False
    question: StrictStr | None = Field(default=None, min_length=3, max_length=280)
    idempotency_key: UUID | None = None


# Rotas -------------------------------------------------------------------------------------------


@router.get("/config")
async def ai_config(_: Actor = CurrentActor, service: AiAssistanceService = Service) -> dict[str, Any]:
    return service.config()


@router.get("/context")
async def list_context(campaign_id: UUID, actor: Actor = CurrentActor, service: AiAssistanceService = Service) -> dict[str, Any]:
    return await service.context_options(campaign_id, actor)


@router.post("/context/preview")
async def preview_context(
    campaign_id: UUID, payload: ContextSelection, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> dict[str, Any]:
    return await service.preview_context(campaign_id, actor, payload.references())


@router.get("/proposals")
async def list_proposals(campaign_id: UUID, _: Actor = CurrentActor, service: AiAssistanceService = Service) -> Any:
    return await service.proposals(campaign_id)


@router.get("/proposals/{proposal_id}")
async def proposal_detail(
    campaign_id: UUID, proposal_id: UUID, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> dict[str, Any]:
    return await service.proposal_detail(campaign_id, proposal_id, actor)


@router.post("/tutor")
async def math_tutor(
    campaign_id: UUID, payload: TutorRequest, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> dict[str, Any]:
    question = TutorQuestion(payload.expression, payload.values, payload.explain, payload.question, payload.idempotency_key)
    return await service.tutor(campaign_id, actor, question)


@router.post("/drafts")
async def create_draft(
    campaign_id: UUID, payload: DraftCreate, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> dict[str, Any]:
    order = DraftOrder(payload.kind, payload.brief, payload.system_key, payload.threat, payload.idempotency_key)
    return await service.draft(campaign_id, actor, order)


@router.post("/proposals", status_code=201)
async def create_proposal(
    campaign_id: UUID, payload: ProposalCreate, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> dict[str, Any]:
    return await service.create_proposal(campaign_id, actor, payload.order())


@router.post("/proposals/{proposal_id}/refine")
async def refine_proposal(
    campaign_id: UUID, proposal_id: UUID, payload: ProposalRefine, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> dict[str, Any]:
    return await service.refine_proposal(campaign_id, proposal_id, actor, payload.order())


@router.post("/proposals/{proposal_id}/approve")
async def approve_proposal(
    campaign_id: UUID, proposal_id: UUID, payload: Approval, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> Any:
    return await service.approve(campaign_id, proposal_id, actor, payload.expected_version, payload.result)


@router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(
    campaign_id: UUID, proposal_id: UUID, payload: Review, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> Any:
    return await service.reject(campaign_id, proposal_id, actor, payload.expected_version)


@router.get("/preparations")
async def list_preparations(campaign_id: UUID, actor: Actor = CurrentActor, service: AiAssistanceService = Service) -> Any:
    return await service.preparations(campaign_id, actor)


@router.post("/preparations/{preparation_id}/publish")
async def publish_preparation(
    campaign_id: UUID, preparation_id: UUID, payload: Publication, actor: Actor = CurrentActor, service: AiAssistanceService = Service,
) -> Any:
    return await service.publish_preparation(campaign_id, preparation_id, actor, payload.expected_version, payload.fields)
