"""Campaign-scoped AI drafts. Models suggest; authenticated managers apply."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from app.routes.sheets import _current_user_id, _get_template, _request
from app.services.sheet_creation import approved_template_draft, prepare_sheet_creation
from app.services import ai_provider

router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}/ai", tags=["ai-assistance"])
LOGGER = logging.getLogger(__name__)
Kind = Literal["sheet", "session", "npc"]


class ContextRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["session", "event", "entity", "sheet"]
    id: UUID


class ContextSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context_refs: list[ContextRef] = Field(default_factory=list, max_length=12)


class ProposalCreate(ContextSelection):
    kind: Kind
    brief: StrictStr = Field(min_length=3, max_length=6000)
    template_id: UUID | None = None
    target_id: UUID | None = None
    context_hash: StrictStr | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    idempotency_key: UUID


class ProposalRefine(ContextSelection):
    expected_version: StrictInt = Field(ge=1)
    instruction: StrictStr = Field(min_length=3, max_length=6000)
    context_hash: StrictStr | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    idempotency_key: UUID
    result: dict[str, Any] | None = None


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: StrictInt = Field(ge=1)


class Approval(Review):
    result: dict[str, Any]


class Publication(Review):
    fields: dict[str, Any]


@dataclass
class Actor:
    id: str
    authorization: str
    manager: bool
    player: bool


def _json(value: Any) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise HTTPException(422, "Conteúdo JSON inválido.") from error


def _bounded(value: Any) -> Any:
    if len(_json(value)) > 65_536:
        raise HTTPException(422, "O conteúdo excede 64 KiB. Selecione menos contexto.")
    return value


def _hash(value: Any) -> str:
    return hashlib.sha256(_json(value)).hexdigest()


def _template_snapshot(template: dict) -> dict:
    return {key: template.get(key) for key in ("id", "name", "version", "schema")}


def _template_hash(template: dict) -> str:
    return _hash(_template_snapshot(template))


def _check_template_snapshot(template: dict, context: dict) -> None:
    if context.get("template_hash") != _template_hash(template):
        raise HTTPException(409, "O modelo aprovado mudou. Crie uma nova proposta com a versão atual.")


async def _actor(campaign_id: UUID, request: Request, authorization: str | None) -> Actor:
    verified = getattr(request.state, "supabase_user", None)
    user_id = verified["id"] if verified else await _current_user_id(authorization)
    campaigns = await _request("GET", "campaigns", authorization, params={"select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1"})
    if not campaigns:
        raise HTTPException(404, "Campanha não encontrada.")
    owner = campaigns[0]["owner_id"] == user_id
    members = await _request("GET", "campaign_members", authorization, params={"select": "role", "campaign_id": f"eq.{campaign_id}", "user_id": f"eq.{user_id}", "limit": "1"})
    role = members[0]["role"] if members else None
    return Actor(user_id, authorization or "", owner or role in {"owner", "master"}, owner or role in {"owner", "master", "player"})


def _manager(actor: Actor) -> None:
    if not actor.manager:
        raise HTTPException(403, "Esta ação exige o narrador da campanha.")


async def _service(method: str, path: str, *, payload: dict | None = None, params: dict | None = None) -> Any:
    """Privileged transport used only after user-scoped authorization above."""
    base, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise HTTPException(503, "Armazenamento privado da IA indisponível.")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=representation"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.request(method, base.rstrip("/") + "/rest/v1/" + path, headers=headers, json=payload, params=params)
    except httpx.HTTPError as error:
        raise HTTPException(503, "Armazenamento privado da IA indisponível.") from error
    if response.status_code == 409:
        raise HTTPException(409, "A proposta mudou ou o pedido já existe. Atualize a lista.")
    if response.status_code >= 400 or len(response.content) > 2_097_152:
        raise HTTPException(503, "Armazenamento privado da IA indisponível.")
    try:
        return response.json() if response.content else None
    except ValueError as error:
        raise HTTPException(503, "Resposta inválida do armazenamento.") from error


async def _rpc(actor: Actor, name: str, payload: dict) -> Any:
    # Keep the caller JWT, not service_role, on any operation that applies content.
    return await _request("POST", "rpc/" + name, actor.authorization, payload=payload)


async def _proposal(campaign_id: UUID, proposal_id: UUID, actor: Actor) -> dict:
    rows = await _request("GET", "ai_requests", actor.authorization, params={"select": "*", "id": f"eq.{proposal_id}", "campaign_id": f"eq.{campaign_id}", "limit": "1"})
    if not rows:
        raise HTTPException(404, "Pedido não encontrado.")
    return rows[0]


CONTEXT_TABLES = {
    "session": ("campaign_sessions", "id,title,summary,status,updated_at,sync_version"),
    "event": ("campaign_events", "id,title,description,status,updated_at"),
    "entity": ("world_entities", "id,name,kind,body,version"),
    "sheet": ("character_sheets", "id,name,template_id,values,version"),
}


async def _selected_context(campaign_id: UUID, actor: Actor, refs: list[ContextRef]) -> dict:
    if refs:
        _manager(actor)
    seen: set[tuple[str, UUID]] = set()
    items = []
    for ref in refs:
        if (ref.kind, ref.id) in seen:
            raise HTTPException(422, "Contexto repetido.")
        seen.add((ref.kind, ref.id))
        table, columns = CONTEXT_TABLES[ref.kind]
        rows = await _request("GET", table, actor.authorization, params={"select": columns, "campaign_id": f"eq.{campaign_id}", "id": f"eq.{ref.id}", "limit": "1"})
        if not rows:
            raise HTTPException(404, "Registro de contexto indisponível nesta campanha.")
        row = rows[0]
        items.append({"kind": ref.kind, "id": str(ref.id), "title": row.get("title", row.get("name", "")), "content": row})
    return _bounded({"items": items})


async def _checked_context(campaign_id: UUID, actor: Actor, payload: ContextSelection) -> dict:
    context = await _selected_context(campaign_id, actor, payload.context_refs)
    if payload.context_refs and getattr(payload, "context_hash", None) != _hash(context):
        raise HTTPException(409, "O contexto mudou. Confira a prévia antes de enviar.")
    return context


@router.get("/config")
async def ai_config(campaign_id: UUID, request: Request, authorization: str | None = Header(None)) -> dict:
    await _actor(campaign_id, request, authorization)
    enabled = False
    try:
        ai_provider.provider_settings()
        enabled = bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    except ai_provider.AIUnavailable:
        pass
    return {"enabled": enabled, "model": "gpt-5.4-mini-2026-03-17", "budget_monthly_usd": 30}


@router.get("/context")
async def list_context(campaign_id: UUID, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    _manager(actor)
    items = []
    for kind, (table, _) in CONTEXT_TABLES.items():
        title = "title" if kind in {"session", "event"} else "name"
        columns = f"id,{title},kind" if kind == "entity" else f"id,{title}"
        rows = await _request("GET", table, actor.authorization, params={"select": columns, "campaign_id": f"eq.{campaign_id}", "limit": "100", "order": f"{title}.asc"})
        items.extend({"kind": kind, "id": row["id"], "title": row[title], **({"entity_kind": row["kind"]} if kind == "entity" else {})} for row in rows)
    return {"items": items}


@router.post("/context/preview")
async def preview_context(campaign_id: UUID, payload: ContextSelection, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    _manager(actor)
    context = await _selected_context(campaign_id, actor, payload.context_refs)
    return {"context": context, "context_hash": _hash(context)}


@router.get("/proposals")
async def list_proposals(campaign_id: UUID, request: Request, authorization: str | None = Header(None)) -> list:
    actor = await _actor(campaign_id, request, authorization)
    if os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        try:
            await _service("POST", "rpc/ai_recover_stale", payload={"p_campaign_id": str(campaign_id)})
        except HTTPException:
            # Browsing saved requests must remain possible during a coordinator outage.
            LOGGER.warning("ai_generation recovery=unavailable")
    return await _request("GET", "ai_requests", actor.authorization, params={"select": "*", "campaign_id": f"eq.{campaign_id}", "order": "created_at.desc", "limit": "100"})


@router.get("/proposals/{proposal_id}")
async def proposal_detail(campaign_id: UUID, proposal_id: UUID, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    row = await _proposal(campaign_id, proposal_id, actor)
    result = {"request": row, "result": None, "context": None, "original": None, "template": None}
    if actor.manager:
        contents = await _request("GET", "ai_proposal_contents", actor.authorization, params={"select": "context,result", "request_id": f"eq.{proposal_id}", "limit": "1"})
        if contents:
            result.update(contents[0])
            result["original"] = contents[0].get("context", {}).get("original")
        if row["kind"] == "sheet":
            stored = await _get_template(campaign_id, UUID(row["template_id"]), actor.authorization)
            result["template"] = approved_template_draft(stored).model_dump(mode="json")
    return result


async def _generation_inputs(campaign_id: UUID, actor: Actor, payload: ProposalCreate, context: dict) -> tuple[dict, dict | None, int | None]:
    template, version = None, None
    if payload.kind == "sheet":
        if not actor.player or payload.template_id is None:
            raise HTTPException(422, "Escolha um modelo aprovado para sua ficha.")
        template = await _get_template(campaign_id, payload.template_id, actor.authorization)
        try:
            approved_template_draft(template)
        except ValueError as error:
            raise HTTPException(422, "O modelo aprovado tem um schema inválido. Solicite revisão ao narrador.") from error
    else:
        _manager(actor)
        if payload.template_id:
            raise HTTPException(422, "Este pedido não recebe um modelo de ficha.")
    original = None
    if payload.target_id:
        table = "character_sheets" if payload.kind == "sheet" else "world_entities" if payload.kind == "npc" else "campaign_sessions"
        columns = "id,name,owner_id,template_id,values,version" if payload.kind == "sheet" else "id,name,kind,body,version" if payload.kind == "npc" else "id,title,summary,updated_at,sync_version"
        rows = await _request("GET", table, actor.authorization, params={"select": columns, "campaign_id": f"eq.{campaign_id}", "id": f"eq.{payload.target_id}", "limit": "1"})
        if not rows:
            raise HTTPException(404, "Destino não encontrado nesta campanha.")
        original = rows[0]
        if payload.kind == "sheet" and (original["owner_id"] != actor.id or original["template_id"] != str(payload.template_id)):
            raise HTTPException(403, "Solicite alterações somente para sua própria ficha e modelo.")
        if payload.kind == "npc" and original["kind"] != "npc":
            raise HTTPException(422, "Escolha um NPC como destino.")
        if payload.kind != "sheet":
            source_kind = "entity" if payload.kind == "npc" else "session"
            previewed = next((item["content"] for item in context["items"] if item["kind"] == source_kind and item["id"] == str(payload.target_id)), None)
            if not isinstance(previewed, dict) or any(previewed.get(key) != value for key, value in original.items()):
                raise HTTPException(409, "Inclua o destino na prévia do contexto antes de enviar.")
        version = original.get("version", original.get("sync_version"))
    data = {**context, "brief": payload.brief, "original": original, **({"template_hash": _template_hash(template)} if template else {})}
    return _bounded(data), template, version


async def _generate(row: dict, actor: Actor, context: dict, template: dict | None, operation_id: str) -> dict:
    try:
        settings = ai_provider.provider_settings()
        ai_provider.build_request(row["kind"], context, template, settings)
    except ai_provider.AIUnavailable as error:
        raise HTTPException(503, "IA desativada ou configuração incompleta.") from error
    except ai_provider.AIProviderError as error:
        raise HTTPException(422, "O pedido excede os limites da IA ou possui campos inválidos.") from error
    reserve = await _service("POST", "rpc/ai_budget_reserve", payload={"p_campaign_id": row["campaign_id"], "p_user_id": actor.id, "p_operation_id": operation_id, "p_reserve_micro": settings.reserve_micro})
    if not isinstance(reserve, dict) or not reserve.get("admitted"):
        reason = reserve.get("reason") if isinstance(reserve, dict) else None
        status = 429 if reason in {"budget", "busy", "rate"} else 503
        raise HTTPException(status, "Orçamento ou limite de geração indisponível. Aguarde antes de tentar novamente.", headers={"Retry-After": "60"} if status == 429 else None)
    dispatched = False
    try:
        if await _service("POST", "rpc/ai_budget_dispatch", payload={"p_operation_id": operation_id}) is not True:
            raise HTTPException(503, "A reserva da geração não pôde ser confirmada.")
        dispatched = True
        generated = await ai_provider.generate_proposal(row["kind"], context, template)
        result = ai_provider.validate_result(row["kind"], generated.result, template)
        if row["kind"] == "npc":
            allowed_ids = {item["id"] for item in context.get("items", []) if item.get("kind") == "entity"}
            if any(item.get("target_id") not in allowed_ids for item in result.get("relationships", [])):
                raise HTTPException(422, "A IA sugeriu uma relação fora do contexto selecionado.")
            await _validate_relationships(row["campaign_id"], actor, result.get("relationships", []))
        if await _service("POST", "rpc/ai_budget_settle", payload={"p_operation_id": operation_id, "p_actual_micro": settings.cost_micro(generated.input_tokens, generated.output_tokens), "p_input_tokens": generated.input_tokens, "p_output_tokens": generated.output_tokens}) is not True:
            raise HTTPException(503, "Não foi possível confirmar o consumo da geração.")
        await _service("PATCH", "ai_proposal_contents", params={"request_id": f"eq.{row['id']}"}, payload={"context": context, "result": _bounded(result)})
        rows = await _service("PATCH", "ai_requests", params={"id": f"eq.{row['id']}", "version": f"eq.{row['version']}", "status": "eq.generating"}, payload={"status": "pending"})
        if not rows:
            raise HTTPException(409, "A proposta mudou durante a geração.")
        LOGGER.info("ai_generation status=success kind=%s input_tokens=%d output_tokens=%d", row["kind"], generated.input_tokens, generated.output_tokens)
        return {"request": rows[0]}
    except (Exception, asyncio.CancelledError) as error:
        # A timed-out paid request is financially uncertain; never refund it blindly.
        try:
            usage = error.usage if isinstance(error, ai_provider.AIProviderError) else None
            if dispatched and usage:
                settled = await asyncio.shield(_service("POST", "rpc/ai_budget_settle", payload={"p_operation_id": operation_id, "p_actual_micro": settings.cost_micro(usage["input_tokens"], usage["output_tokens"]), "p_input_tokens": usage["input_tokens"], "p_output_tokens": usage["output_tokens"]}))
                if settled is not True:
                    await asyncio.shield(_service("POST", "rpc/ai_budget_uncertain", payload={"p_operation_id": operation_id}))
            else:
                await asyncio.shield(_service("POST", "rpc/" + ("ai_budget_uncertain" if dispatched else "ai_budget_cancel"), payload={"p_operation_id": operation_id}))
        except Exception:
            LOGGER.warning("ai_generation settlement=unavailable")
        raise


async def _validate_relationships(campaign_id: UUID | str, actor: Actor, relationships: list) -> None:
    for relationship in relationships:
        try:
            target = UUID(relationship["target_id"])
        except (KeyError, ValueError, TypeError) as error:
            raise HTTPException(422, "Relação sugerida tem destino inválido.") from error
        rows = await _request("GET", "world_entities", actor.authorization, params={"select": "id", "id": f"eq.{target}", "campaign_id": f"eq.{campaign_id}", "limit": "1"})
        if not rows:
            raise HTTPException(422, "Relação sugerida aponta para fora desta campanha.")


async def _fail(row: dict) -> None:
    try:
        await _service("PATCH", "ai_requests", params={"id": f"eq.{row['id']}", "version": f"eq.{row['version']}", "status": "eq.generating"}, payload={"status": "failed"})
    except HTTPException:
        LOGGER.warning("ai_generation status_update=unavailable")


@router.post("/proposals", status_code=201)
async def create_proposal(campaign_id: UUID, payload: ProposalCreate, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    if not actor.player:
        raise HTTPException(403, "Participação de jogador ou narrador necessária.")
    request_hash = _hash(payload.model_dump(mode="json"))
    existing = await _request("GET", "ai_requests", actor.authorization, params={"select": "*", "campaign_id": f"eq.{campaign_id}", "author_id": f"eq.{actor.id}", "idempotency_key": f"eq.{payload.idempotency_key}", "limit": "1"})
    if existing:
        if existing[0]["request_hash"] != request_hash:
            raise HTTPException(409, "O identificador já pertence a outro pedido.")
        return {"request": existing[0]}
    try:
        ai_provider.provider_settings()
    except ai_provider.AIUnavailable as error:
        raise HTTPException(503, "IA desativada ou configuração incompleta.") from error
    context = await _checked_context(campaign_id, actor, payload)
    data, template, target_version = await _generation_inputs(campaign_id, actor, payload, context)
    # All implicit inputs are shown to managers in the task form; selected source
    # revisions must match the preview hash before any paid request is admitted.
    proposal_id = str(uuid4())
    row = (await _service("POST", "ai_requests", payload={"id": proposal_id, "campaign_id": str(campaign_id), "author_id": actor.id, "kind": payload.kind, "status": "generating", "template_id": str(payload.template_id) if payload.template_id else None, "target_id": str(payload.target_id) if payload.target_id else None, "target_version": target_version, "brief": payload.brief, "idempotency_key": str(payload.idempotency_key), "request_hash": request_hash, "last_operation_id": str(payload.idempotency_key), "last_operation_hash": request_hash}))[0]
    try:
        await _service("POST", "ai_proposal_contents", payload={"request_id": proposal_id, "campaign_id": str(campaign_id), "context": data, "result": {}, "template_snapshot": _template_snapshot(template) if template else None})
        return await _generate(row, actor, data, template, str(payload.idempotency_key))
    except (Exception, asyncio.CancelledError) as error:
        await asyncio.shield(_fail(row))
        if isinstance(error, (HTTPException, asyncio.CancelledError)):
            raise
        raise HTTPException(502, "A IA não concluiu uma proposta válida. Seus dados foram preservados.") from error


@router.post("/proposals/{proposal_id}/refine")
async def refine_proposal(campaign_id: UUID, proposal_id: UUID, payload: ProposalRefine, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    _manager(actor)
    row = await _proposal(campaign_id, proposal_id, actor)
    refinement_hash = _hash(payload.model_dump(mode="json"))
    if row.get("last_operation_id") == str(payload.idempotency_key):
        if row.get("last_operation_hash") != refinement_hash:
            raise HTTPException(409, "O identificador já pertence a outro refinamento.")
        return {"request": row}
    if row["version"] != payload.expected_version or row["status"] not in {"pending", "failed"}:
        raise HTTPException(409, "Atualize a proposta antes de refinar.")
    context = await _checked_context(campaign_id, actor, payload)
    contents = await _request("GET", "ai_proposal_contents", actor.authorization, params={"select": "context,result", "request_id": f"eq.{proposal_id}", "limit": "1"})
    if not contents:
        raise HTTPException(404, "Conteúdo da proposta não encontrado.")
    template = await _get_template(campaign_id, UUID(row["template_id"]), actor.authorization) if row["kind"] == "sheet" else None
    if template:
        _check_template_snapshot(template, contents[0]["context"])
    previous = contents[0]["result"]
    if payload.result is not None:
        try:
            previous = ai_provider.validate_result(row["kind"], _bounded(payload.result), template)
        except ai_provider.AIProviderError as error:
            raise HTTPException(422, "Revise os campos editados antes de refinar.") from error
    data = _bounded({**context, "brief": row["brief"], "original": contents[0]["context"].get("original"), "previous_result": previous, "instruction": payload.instruction, **({"template_hash": _template_hash(template)} if template else {})})
    try:
        settings = ai_provider.provider_settings()
        ai_provider.build_request(row["kind"], data, template, settings)
    except ai_provider.AIUnavailable as error:
        raise HTTPException(503, "IA desativada ou configuração incompleta.") from error
    except ai_provider.AIProviderError as error:
        raise HTTPException(422, "O refinamento excede os limites da IA.") from error
    claimed = await _service("PATCH", "ai_requests", params={"id": f"eq.{proposal_id}", "campaign_id": f"eq.{campaign_id}", "version": f"eq.{payload.expected_version}", "status": f"eq.{row['status']}"}, payload={"status": "generating", "version": row["version"] + 1, "last_operation_id": str(payload.idempotency_key), "last_operation_hash": refinement_hash})
    if not claimed:
        raise HTTPException(409, "Outro pedido já está alterando esta proposta.")
    row = claimed[0]
    try:
        return await _generate(row, actor, data, template, str(payload.idempotency_key))
    except (Exception, asyncio.CancelledError) as error:
        await asyncio.shield(_fail(row))
        if isinstance(error, (HTTPException, asyncio.CancelledError)):
            raise
        raise HTTPException(502, "A IA não concluiu o refinamento. A proposta anterior foi preservada.") from error


@router.post("/proposals/{proposal_id}/approve")
async def approve_proposal(campaign_id: UUID, proposal_id: UUID, payload: Approval, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    _manager(actor)
    row = await _proposal(campaign_id, proposal_id, actor)
    if row["status"] == "approved":
        return {"request": row, "destination_id": row.get("destination_id")}
    if row["version"] != payload.expected_version or row["status"] != "pending":
        raise HTTPException(409, "Atualize a proposta antes de aprovar.")
    template = await _get_template(campaign_id, UUID(row["template_id"]), actor.authorization) if row["kind"] == "sheet" else None
    if template:
        contents = await _request("GET", "ai_proposal_contents", actor.authorization, params={"select": "context", "request_id": f"eq.{proposal_id}", "limit": "1"})
        if not contents:
            raise HTTPException(409, "O contexto da proposta não está disponível para conferência.")
        _check_template_snapshot(template, contents[0]["context"])
    try:
        result = ai_provider.validate_result(row["kind"], _bounded(payload.result), template)
        if row["kind"] == "sheet":
            _, name, values = prepare_sheet_creation(template, result["name"], result["values"])
            result.update(name=name, values=values)
        elif row["kind"] == "npc":
            await _validate_relationships(campaign_id, actor, result.get("relationships", []))
    except (ValueError, ai_provider.AIProviderError) as error:
        raise HTTPException(422, "Revise os campos e as escolhas obrigatórias da proposta.") from error
    return await _rpc(actor, "ai_approve_proposal", {"p_campaign_id": str(campaign_id), "p_request_id": str(proposal_id), "p_expected_version": payload.expected_version, "p_result": result})


@router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(campaign_id: UUID, proposal_id: UUID, payload: Review, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    _manager(actor)
    return await _rpc(actor, "ai_reject_proposal", {"p_campaign_id": str(campaign_id), "p_request_id": str(proposal_id), "p_expected_version": payload.expected_version})


@router.get("/preparations")
async def list_preparations(campaign_id: UUID, request: Request, authorization: str | None = Header(None)) -> list:
    actor = await _actor(campaign_id, request, authorization)
    _manager(actor)
    return await _request("GET", "ai_private_preparations", actor.authorization, params={"select": "*", "campaign_id": f"eq.{campaign_id}", "order": "created_at.desc", "limit": "100"})


@router.post("/preparations/{preparation_id}/publish")
async def publish_preparation(campaign_id: UUID, preparation_id: UUID, payload: Publication, request: Request, authorization: str | None = Header(None)) -> dict:
    actor = await _actor(campaign_id, request, authorization)
    _manager(actor)
    _bounded(payload.fields)
    return await _rpc(actor, "ai_publish_preparation", {"p_campaign_id": str(campaign_id), "p_preparation_id": str(preparation_id), "p_expected_version": payload.expected_version, "p_fields": payload.fields})
