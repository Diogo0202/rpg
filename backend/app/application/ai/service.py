"""Rascunhos de IA por campanha: o modelo sugere, o narrador revisa e aplica."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4, uuid5

from app.application.ai.paid_generation import PaidGeneration
from app.application.ai.ports import (
    AIProviderError,
    AIUnavailable,
    Actor,
    AiCampaignStore,
    AiPrivateStore,
    AiProvider,
    ContextKind,
    Row,
)
from app.domain.errors import Conflict, DomainError, Forbidden, InvalidInput, NotFound, ServiceUnavailable, UnexpectedUpstreamResponse
from app.domain.models import TemplateDraft
from app.domain import tutor_policy
from app.domain.prompt_security import UntrustedDataError, normalize_untrusted_text
from app.domain.sheet_calculations import calculate_sheet
from app.domain.sheet_creation import approved_template_draft, prepare_sheet_creation

LOGGER = logging.getLogger(__name__)

MAX_CONTENT_BYTES = 65_536
TUTOR_MODEL = "gpt-5.4-mini-2026-03-17"
TUTOR_MONTHLY_BUDGET_USD = 30
TUTOR_RESULT_FIELD = "nexus_result"
MAX_QUESTION_CHARS = 280
CONTEXT_KINDS: tuple[ContextKind, ...] = ("session", "event", "entity", "sheet")
REFINABLE_STATUSES = frozenset({"pending", "failed"})
MANAGER_ONLY = "Esta ação exige o narrador da campanha."
MEMBER_ONLY = "Participação de jogador ou narrador necessária."


# Regras puras -------------------------------------------------------------------------------


def canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise InvalidInput("Conteúdo JSON inválido.") from error


def bounded(value: Any) -> Any:
    if len(canonical_json(value)) > MAX_CONTENT_BYTES:
        raise InvalidInput("O conteúdo excede 64 KiB. Selecione menos contexto.")
    return value


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def template_snapshot(template: Row) -> Row:
    return {key: template.get(key) for key in ("id", "name", "version", "schema")}


def template_hash(template: Row) -> str:
    return content_hash(template_snapshot(template))


def check_template_snapshot(template: Row, context: Row) -> None:
    if context.get("template_hash") != template_hash(template):
        raise Conflict("O modelo aprovado mudou. Crie uma nova proposta com a versão atual.")


def require_manager(actor: Actor) -> None:
    if not actor.manager:
        raise Forbidden(MANAGER_ONLY)


def require_member(actor: Actor) -> None:
    if not actor.player:
        raise Forbidden(MEMBER_ONLY)


# Pedidos ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ContextRef:
    kind: ContextKind
    id: UUID


@dataclass(frozen=True)
class ProposalOrder:
    kind: str
    brief: str
    template_id: UUID | None
    target_id: UUID | None
    context_refs: list[ContextRef]
    context_hash: str | None
    idempotency_key: UUID
    request_hash: str


@dataclass(frozen=True)
class RefinementOrder:
    expected_version: int
    instruction: str
    context_refs: list[ContextRef]
    context_hash: str | None
    idempotency_key: UUID
    result: Row | None
    request_hash: str


@dataclass(frozen=True)
class TutorQuestion:
    expression: str
    values: dict[str, int | float]
    explain: bool
    question: str | None
    idempotency_key: UUID | None


@dataclass(frozen=True)
class DraftOrder:
    kind: str
    brief: str
    system_key: str | None
    threat: str | None
    idempotency_key: UUID


class AiAssistanceService:
    def __init__(
        self, store: AiCampaignStore, private: AiPrivateStore, provider: AiProvider, paid: PaidGeneration,
    ) -> None:
        self._store = store
        self._private = private
        self._provider = provider
        self._paid = paid

    # Configuração e contexto ------------------------------------------------------------

    def config(self) -> Row:
        tutor_enabled = False
        try:
            self._provider.settings()
            tutor_enabled = self._private.is_configured()
        except AIUnavailable:
            pass
        return {"enabled": False, "tutor_enabled": tutor_enabled, "mode": "math_tutor",
                "model": TUTOR_MODEL, "budget_monthly_usd": TUTOR_MONTHLY_BUDGET_USD}

    async def context_options(self, campaign_id: UUID, actor: Actor) -> Row:
        require_manager(actor)
        items: list[Row] = []
        for kind in CONTEXT_KINDS:
            items.extend(await self._store.context_options(kind, campaign_id))
        return {"items": items}

    async def preview_context(self, campaign_id: UUID, actor: Actor, refs: list[ContextRef]) -> Row:
        require_manager(actor)
        context = await self._selected_context(campaign_id, actor, refs)
        return {"context": context, "context_hash": content_hash(context)}

    # Propostas --------------------------------------------------------------------------

    async def proposals(self, campaign_id: UUID) -> Any:
        if self._private.is_configured():
            try:
                await self._private.recover_stale(campaign_id)
            except DomainError:
                # A lista de pedidos salvos continua disponível durante uma falha do coordenador.
                LOGGER.warning("ai_generation recovery=unavailable")
        return await self._store.proposals(campaign_id)

    async def proposal_detail(self, campaign_id: UUID, proposal_id: UUID, actor: Actor) -> Row:
        row = await self._proposal(campaign_id, proposal_id)
        detail: Row = {"request": row, "result": None, "context": None, "original": None, "template": None}
        if not actor.manager:
            return detail
        contents = await self._store.proposal_contents(proposal_id, with_result=True)
        if contents:
            detail.update(contents)
            detail["original"] = contents.get("context", {}).get("original")
        if row["kind"] == "sheet":
            stored = await self._store.approved_template(campaign_id, UUID(row["template_id"]))
            detail["template"] = approved_template_draft(stored).model_dump(mode="json")
        return detail

    async def create_proposal(self, campaign_id: UUID, actor: Actor, order: ProposalOrder) -> Row:
        require_member(actor)
        existing = await self._store.proposal_by_key(campaign_id, actor.id, order.idempotency_key)
        if existing:
            if existing["request_hash"] != order.request_hash:
                raise Conflict("O identificador já pertence a outro pedido.")
            return {"request": existing}
        try:
            self._provider.settings()
        except AIUnavailable as error:
            raise ServiceUnavailable("IA desativada ou configuração incompleta.") from error
        context = await self._checked_context(campaign_id, actor, order.context_refs, order.context_hash)
        data, template, target_version = await self._generation_inputs(campaign_id, actor, order, context)
        try:
            self._provider.check_request(order.kind, data, template)
        except AIProviderError as error:
            raise InvalidInput("A IA atua somente como tutor matemático. As propostas anteriores continuam disponíveis para revisão.") from error
        # O narrador vê todas as entradas implícitas no formulário; o contexto escolhido precisa
        # bater com a prévia antes de qualquer pedido pago.
        proposal_id = str(uuid4())
        row = (await self._private.create_request({
            "id": proposal_id, "campaign_id": str(campaign_id), "author_id": actor.id, "kind": order.kind,
            "status": "generating", "template_id": str(order.template_id) if order.template_id else None,
            "target_id": str(order.target_id) if order.target_id else None, "target_version": target_version,
            "brief": order.brief, "idempotency_key": str(order.idempotency_key), "request_hash": order.request_hash,
            "last_operation_id": str(order.idempotency_key), "last_operation_hash": order.request_hash,
        }))[0]
        try:
            await self._private.create_contents({
                "request_id": proposal_id, "campaign_id": str(campaign_id), "context": data, "result": {},
                "template_snapshot": template_snapshot(template) if template else None,
            })
            return await self._generate(row, actor, data, template, str(order.idempotency_key))
        except (Exception, asyncio.CancelledError) as error:
            await asyncio.shield(self._fail(row))
            if isinstance(error, (DomainError, asyncio.CancelledError)):
                raise
            raise UnexpectedUpstreamResponse("A IA não concluiu uma proposta válida. Seus dados foram preservados.") from error

    async def refine_proposal(self, campaign_id: UUID, proposal_id: UUID, actor: Actor, order: RefinementOrder) -> Row:
        require_manager(actor)
        row = await self._proposal(campaign_id, proposal_id)
        if row.get("last_operation_id") == str(order.idempotency_key):
            if row.get("last_operation_hash") != order.request_hash:
                raise Conflict("O identificador já pertence a outro refinamento.")
            return {"request": row}
        if row["version"] != order.expected_version or row["status"] not in REFINABLE_STATUSES:
            raise Conflict("Atualize a proposta antes de refinar.")
        context = await self._checked_context(campaign_id, actor, order.context_refs, order.context_hash)
        contents = await self._store.proposal_contents(proposal_id, with_result=True)
        if not contents:
            raise NotFound("Conteúdo da proposta não encontrado.")
        template = await self._sheet_template(campaign_id, row)
        if template:
            check_template_snapshot(template, contents["context"])
        previous = contents["result"]
        if order.result is not None:
            try:
                previous = self._provider.validate(row["kind"], bounded(order.result), template)
            except AIProviderError as error:
                raise InvalidInput("Revise os campos editados antes de refinar.") from error
        data = bounded({
            **context, "brief": row["brief"], "original": contents["context"].get("original"),
            "previous_result": previous, "instruction": order.instruction,
            **({"template_hash": template_hash(template)} if template else {}),
        })
        try:
            settings = self._provider.settings()
            self._provider.check_request(row["kind"], data, template, settings)
        except AIUnavailable as error:
            raise ServiceUnavailable("IA desativada ou configuração incompleta.") from error
        except AIProviderError as error:
            raise InvalidInput("O refinamento excede os limites da IA.") from error
        claimed = await self._private.transition_request(
            {"id": f"eq.{proposal_id}", "campaign_id": f"eq.{campaign_id}",
             "version": f"eq.{order.expected_version}", "status": f"eq.{row['status']}"},
            {"status": "generating", "version": row["version"] + 1,
             "last_operation_id": str(order.idempotency_key), "last_operation_hash": order.request_hash},
        )
        if not claimed:
            raise Conflict("Outro pedido já está alterando esta proposta.")
        row = claimed[0]
        try:
            return await self._generate(row, actor, data, template, str(order.idempotency_key))
        except (Exception, asyncio.CancelledError) as error:
            await asyncio.shield(self._fail(row))
            if isinstance(error, (DomainError, asyncio.CancelledError)):
                raise
            raise UnexpectedUpstreamResponse("A IA não concluiu o refinamento. A proposta anterior foi preservada.") from error

    async def approve(self, campaign_id: UUID, proposal_id: UUID, actor: Actor, expected_version: int, result: Row) -> Any:
        require_manager(actor)
        row = await self._proposal(campaign_id, proposal_id)
        if row["status"] == "approved":
            return {"request": row, "destination_id": row.get("destination_id")}
        if row["version"] != expected_version or row["status"] != "pending":
            raise Conflict("Atualize a proposta antes de aprovar.")
        template = await self._sheet_template(campaign_id, row)
        if template:
            contents = await self._store.proposal_contents(proposal_id, with_result=False)
            if not contents:
                raise Conflict("O contexto da proposta não está disponível para conferência.")
            check_template_snapshot(template, contents["context"])
        try:
            checked = self._provider.validate(row["kind"], bounded(result), template)
            if row["kind"] == "sheet":
                _, name, values = prepare_sheet_creation(template, checked["name"], checked["values"])
                checked.update(name=name, values=values)
            elif row["kind"] == "npc":
                await self._validate_relationships(campaign_id, checked.get("relationships", []))
        except (ValueError, AIProviderError) as error:
            raise InvalidInput("Revise os campos e as escolhas obrigatórias da proposta.") from error
        return await self._store.approve(campaign_id, proposal_id, expected_version, checked)

    async def reject(self, campaign_id: UUID, proposal_id: UUID, actor: Actor, expected_version: int) -> Any:
        require_manager(actor)
        return await self._store.reject(campaign_id, proposal_id, expected_version)

    # Preparações privadas ------------------------------------------------------------------

    async def preparations(self, campaign_id: UUID, actor: Actor) -> Any:
        require_manager(actor)
        return await self._store.preparations(campaign_id)

    async def publish_preparation(self, campaign_id: UUID, preparation_id: UUID, actor: Actor, expected_version: int, fields: Row) -> Any:
        require_manager(actor)
        bounded(fields)
        return await self._store.publish_preparation(campaign_id, preparation_id, expected_version, fields)

    # Tutor e rascunhos -------------------------------------------------------------------------

    async def tutor(self, campaign_id: UUID, actor: Actor, request: TutorQuestion) -> Row:
        require_member(actor)
        question = self._clean_question(request.question)
        # Uso justo: só mecânica. Pedidos de lore ou narrativa param antes de qualquer chamada paga.
        try:
            tutor_policy.check_tutor_request([request.expression, *request.values, *([question] if question else [])])
        except tutor_policy.TutorPolicyError as error:
            raise InvalidInput(tutor_policy.REFUSAL_MESSAGE) from error
        answer = _calculate(request.expression, request.values)
        result: Row = {"expression": request.expression, "values": request.values, "result": answer, "explanation": None, "bullets": []}
        if not request.explain:
            return result
        if request.idempotency_key is None:
            raise InvalidInput("A explicação exige um identificador de operação.")
        operation_id = str(uuid5(campaign_id, f"math_tutor:{actor.id}:{request.idempotency_key}"))
        context: Row = {"expression": request.expression, "values": request.values, "server_result": answer}
        if question:
            context["question"] = question
        try:
            explanation = await self._paid.run(str(campaign_id), actor, "math_tutor", context, None, operation_id)
        except AIProviderError as error:
            raise UnexpectedUpstreamResponse("Não foi possível obter a explicação. O cálculo continua disponível sem IA.") from error
        # Confere de novo o formato na borda da API: tópicos só de regras mecânicas.
        try:
            bullets = tutor_policy.mechanics_bullets(explanation["explanation"])
        except tutor_policy.TutorPolicyError as error:
            raise UnexpectedUpstreamResponse(
                "A explicação fugiu do formato de regras mecânicas em tópicos e foi descartada. O cálculo continua disponível."
            ) from error
        result["bullets"] = bullets
        result["explanation"] = tutor_policy.format_bullets(bullets)
        return result

    async def draft(self, campaign_id: UUID, actor: Actor, order: DraftOrder) -> Row:
        """NPC, inimigo ou item instantâneo para o narrador revisar; nada é gravado até ele salvar."""
        require_manager(actor)
        context = bounded({"brief": order.brief, "system": order.system_key, "threat": order.threat, "items": []})
        operation_id = str(uuid5(campaign_id, f"draft:{actor.id}:{order.idempotency_key}"))
        try:
            result = await self._paid.run(str(campaign_id), actor, order.kind, context, None, operation_id)
        except AIProviderError as error:
            message = ("A IA recusou o pedido." if error.code == "refusal"
                       else "A IA devolveu um resultado inválido. Tente de novo ou use o gerador procedural.")
            raise UnexpectedUpstreamResponse(message) from error
        if order.kind == "npc":
            result["relationships"] = []  # rascunhos não têm contexto, então não citam entidades
        return {"kind": order.kind, "result": result}

    # Apoio ----------------------------------------------------------------------------------

    async def _proposal(self, campaign_id: UUID, proposal_id: UUID) -> Row:
        row = await self._store.proposal(campaign_id, proposal_id)
        if not row:
            raise NotFound("Pedido não encontrado.")
        return row

    async def _sheet_template(self, campaign_id: UUID, row: Row) -> Row | None:
        return await self._store.approved_template(campaign_id, UUID(row["template_id"])) if row["kind"] == "sheet" else None

    async def _selected_context(self, campaign_id: UUID, actor: Actor, refs: list[ContextRef]) -> Row:
        if refs:
            require_manager(actor)
        seen: set[tuple[str, UUID]] = set()
        items = []
        for ref in refs:
            if (ref.kind, ref.id) in seen:
                raise InvalidInput("Contexto repetido.")
            seen.add((ref.kind, ref.id))
            record = await self._store.context_record(ref.kind, campaign_id, ref.id)
            if not record:
                raise NotFound("Registro de contexto indisponível nesta campanha.")
            items.append({"kind": ref.kind, "id": str(ref.id), "title": record.get("title", record.get("name", "")), "content": record})
        return bounded({"items": items})

    async def _checked_context(self, campaign_id: UUID, actor: Actor, refs: list[ContextRef], expected_hash: str | None) -> Row:
        context = await self._selected_context(campaign_id, actor, refs)
        if refs and expected_hash != content_hash(context):
            raise Conflict("O contexto mudou. Confira a prévia antes de enviar.")
        return context

    async def _generation_inputs(self, campaign_id: UUID, actor: Actor, order: ProposalOrder, context: Row) -> tuple[Row, Row | None, int | None]:
        template = None
        if order.kind == "sheet":
            if not actor.player or order.template_id is None:
                raise InvalidInput("Escolha um modelo aprovado para sua ficha.")
            template = await self._store.approved_template(campaign_id, order.template_id)
            try:
                approved_template_draft(template)
            except ValueError as error:
                raise InvalidInput("O modelo aprovado tem um schema inválido. Solicite revisão ao narrador.") from error
        else:
            require_manager(actor)
            if order.template_id:
                raise InvalidInput("Este pedido não recebe um modelo de ficha.")
        original, version = await self._target(campaign_id, actor, order, context)
        data = {**context, "brief": order.brief, "original": original, **({"template_hash": template_hash(template)} if template else {})}
        return bounded(data), template, version

    async def _target(self, campaign_id: UUID, actor: Actor, order: ProposalOrder, context: Row) -> tuple[Row | None, int | None]:
        if not order.target_id:
            return None, None
        original = await self._store.target(order.kind, campaign_id, order.target_id)  # type: ignore[arg-type]
        if not original:
            raise NotFound("Destino não encontrado nesta campanha.")
        if order.kind == "sheet" and (original["owner_id"] != actor.id or original["template_id"] != str(order.template_id)):
            raise Forbidden("Solicite alterações somente para sua própria ficha e modelo.")
        if order.kind == "npc" and original["kind"] != "npc":
            raise InvalidInput("Escolha um NPC como destino.")
        if order.kind != "sheet":
            source_kind = "entity" if order.kind == "npc" else "session"
            previewed = next((item["content"] for item in context["items"]
                              if item["kind"] == source_kind and item["id"] == str(order.target_id)), None)
            if not isinstance(previewed, dict) or any(previewed.get(key) != value for key, value in original.items()):
                raise Conflict("Inclua o destino na prévia do contexto antes de enviar.")
        return original, original.get("version", original.get("sync_version"))

    async def _generate(self, row: Row, actor: Actor, context: Row, template: Row | None, client_operation: str) -> Row:
        # Chaves do cliente valem por proposta; o livro do orçamento é global.
        operation_id = str(uuid5(UUID(row["id"]), client_operation))

        async def check_relationships(result: Row) -> None:
            if row["kind"] != "npc":
                return
            allowed = {item["id"] for item in context.get("items", []) if item.get("kind") == "entity"}
            if any(item.get("target_id") not in allowed for item in result.get("relationships", [])):
                raise InvalidInput("A IA sugeriu uma relação fora do contexto selecionado.")
            await self._validate_relationships(row["campaign_id"], result.get("relationships", []))

        result = await self._paid.run(row["campaign_id"], actor, row["kind"], context, template, operation_id, check_relationships)
        await self._private.save_contents(row["id"], context, bounded(result))
        rows = await self._private.transition_request(
            {"id": f"eq.{row['id']}", "version": f"eq.{row['version']}", "status": "eq.generating"}, {"status": "pending"},
        )
        if not rows:
            raise Conflict("A proposta mudou durante a geração.")
        return {"request": rows[0]}

    async def _validate_relationships(self, campaign_id: UUID | str, relationships: list[Any]) -> None:
        for relationship in relationships:
            try:
                target = UUID(relationship["target_id"])
            except (KeyError, ValueError, TypeError) as error:
                raise InvalidInput("Relação sugerida tem destino inválido.") from error
            if not await self._store.entity_in_campaign(campaign_id, target):
                raise InvalidInput("Relação sugerida aponta para fora desta campanha.")

    async def _fail(self, row: Row) -> None:
        try:
            await self._private.transition_request(
                {"id": f"eq.{row['id']}", "version": f"eq.{row['version']}", "status": "eq.generating"}, {"status": "failed"},
            )
        except DomainError:
            LOGGER.warning("ai_generation status_update=unavailable")

    @staticmethod
    def _clean_question(question: str | None) -> str | None:
        if question is None:
            return None
        try:
            return normalize_untrusted_text(question, field="pergunta", max_chars=MAX_QUESTION_CHARS, max_bytes=MAX_QUESTION_CHARS * 4).strip()
        except UntrustedDataError as error:
            raise InvalidInput(str(error)) from error


def _calculate(expression: str, values: dict[str, int | float]) -> Any:
    if TUTOR_RESULT_FIELD in values:
        raise InvalidInput("O nome nexus_result é reservado ao cálculo.")
    try:
        template = TemplateDraft(name="Tutor matemático", fields=[
            *[{"id": key, "label": key, "kind": "number"} for key in values],
            {"id": TUTOR_RESULT_FIELD, "label": "Resultado", "kind": "formula", "expression": expression},
        ])
        return calculate_sheet(template, values)[TUTOR_RESULT_FIELD]
    except ValueError as error:
        raise InvalidInput(str(error)) from error
