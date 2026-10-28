"""SAN-01/02/03 do Vampiro V5: caçada, Vínculo de Sangue e ações contra o Regente.

As escritas passam pelas RPCs da migration 20261029110000_v5_feeding_bonds.sql, que conferem
permissão (dono da ficha ou narrador) e gravam de forma atômica; a API valida a forma do pedido,
traduz os erros e calcula o grau do Vínculo com a mesma regra do banco.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator

from app.routes.generators import require_signed_in_user
from app.routes.sheets import _request, _rpc
from app.services.v5_sanguine import bond_degree

router = APIRouter(prefix="/api/v1/v5", tags=["vampire-v5-sanguine"])

Resonance = Literal["Nenhuma", "Colérica", "Melancólica", "Fleumática", "Sanguínea", "Animal", "Vazia"]
Intensity = Literal["Nenhuma", "Fugaz", "Intensa", "Aguda"]  # same lists as RESONANCES / INTENSITIES (tested)


def _remap(error: HTTPException, details: dict[int, str]) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=details.get(error.status_code, error.detail))


def _rows(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise HTTPException(status_code=502, detail="resposta inesperada do Supabase")
    return value


def _object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="resposta inesperada do Supabase")
    return value


# --- SAN-01: caçada --------------------------------------------------------------

class HuntRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    prey: StrictStr = Field(min_length=1, max_length=120)
    resonance: Resonance
    intensity: Intensity
    dyscrasia: StrictStr | None = Field(default=None, max_length=160)
    slake: StrictInt = Field(default=1, ge=0, le=5)
    killed: StrictBool = False
    notes: StrictStr | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def coherent(self) -> HuntRequest:
        if not self.prey.strip():
            raise ValueError("informe a presa")
        if (self.resonance == "Nenhuma") != (self.intensity == "Nenhuma"):
            raise ValueError("Ressonância e intensidade andam juntas")
        if self.dyscrasia and self.dyscrasia.strip() and self.intensity != "Aguda":
            raise ValueError("Discrasia só com Ressonância aguda")
        return self


class HuntResponse(BaseModel):
    hunt: dict[str, Any]
    sheet_values: dict[str, Any] | None
    effects: list[dict[str, Any]] | None
    sheet_version: int | None
    replayed: bool


@router.post("/sheets/{sheet_id}/hunts", response_model=HuntResponse, status_code=201)
async def record_hunt(
    sheet_id: UUID,
    request: HuntRequest,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> HuntResponse:
    """Registra a caçada: reduz a Fome e troca o efeito de Ressonância na mesma escrita."""
    try:
        result = _object(await _rpc("record_v5_hunt", authorization, {
            "p_sheet_id": str(sheet_id), "p_operation_id": str(request.operation_id), "p_prey": request.prey,
            "p_resonance": request.resonance, "p_intensity": request.intensity, "p_dyscrasia": request.dyscrasia,
            "p_slake": request.slake, "p_killed": request.killed, "p_notes": request.notes,
        }))
    except HTTPException as error:
        raise _remap(error, {
            403: "só o dono da ficha ou o narrador registram a caçada",
            409: "este ID de operação já foi usado para outra caçada",
            422: "caçada inválida para esta ficha (Fome, Ressonância ou limite de efeitos)",
        }) from error
    sheet = result.get("sheet") if isinstance(result.get("sheet"), dict) else {}
    return HuntResponse(
        hunt=_object(result.get("hunt")),
        sheet_values=sheet.get("values") if isinstance(sheet.get("values"), dict) else None,
        effects=sheet.get("effects") if isinstance(sheet.get("effects"), list) else None,
        sheet_version=sheet.get("version") if type(sheet.get("version")) is int else None,
        replayed=result.get("replayed") is True,
    )


@router.get("/sheets/{sheet_id}/hunts")
async def list_hunts(
    sheet_id: UUID,
    limit: int = Query(default=20, ge=1, le=100),
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    return _rows(await _request("GET", "v5_hunts", authorization, params={
        "select": "*", "sheet_id": f"eq.{sheet_id}", "order": "created_at.desc,id.desc", "limit": str(limit),
    }))


# --- SAN-02: Vínculo de Sangue -----------------------------------------------------

class DrinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    regnant_sheet_id: UUID | None = None
    regnant_entity_id: UUID | None = None
    drank_at: datetime | None = None
    notes: StrictStr | None = Field(default=None, max_length=300)
    decay_days: StrictInt | None = Field(default=None, ge=1, le=3650)

    @model_validator(mode="after")
    def one_donor(self) -> DrinkRequest:
        if (self.regnant_sheet_id is None) == (self.regnant_entity_id is None):
            raise ValueError("escolha uma ficha ou um NPC como doador")
        if self.drank_at is not None and self.drank_at.tzinfo is None:
            raise ValueError("informe a data com fuso horário")
        return self


class BondSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decay_days: StrictInt = Field(ge=1, le=3650)
    notes: StrictStr | None = Field(default=None, max_length=1000)


def _with_degree(bond: dict[str, Any], drinks: list[dict[str, Any]], at: datetime | None = None) -> dict[str, Any]:
    history = sorted((drink for drink in drinks if drink.get("bond_id") == bond.get("id")), key=lambda drink: str(drink.get("drank_at")))
    decay = bond.get("decay_days")
    if type(decay) is not int or decay < 1:
        raise HTTPException(status_code=502, detail="vínculo guardado inválido")
    try:
        degree = bond_degree([str(drink["drank_at"]) for drink in history], decay, at)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=502, detail="ingestão guardada inválida") from error
    return {**bond, "degree": degree, "drinks": history}


@router.get("/sheets/{sheet_id}/blood-bonds")
async def list_blood_bonds(
    sheet_id: UUID,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    """Vínculos em que a ficha bebeu, com o grau atual e o histórico de ingestões."""
    bonds = _rows(await _request("GET", "v5_blood_bonds", authorization, params={
        "select": "*", "thrall_sheet_id": f"eq.{sheet_id}", "order": "created_at.asc",
    }))
    if not bonds:
        return []
    ids = ",".join(str(bond["id"]) for bond in bonds)
    drinks = _rows(await _request("GET", "v5_blood_bond_drinks", authorization, params={
        "select": "*", "bond_id": f"in.({ids})", "order": "drank_at.asc",
    }))
    return [_with_degree(bond, drinks) for bond in bonds]


@router.post("/sheets/{sheet_id}/blood-bonds/drinks", status_code=201)
async def record_bond_drink(
    sheet_id: UUID,
    request: DrinkRequest,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "p_thrall_sheet_id": str(sheet_id), "p_operation_id": str(request.operation_id),
        "p_regnant_sheet_id": str(request.regnant_sheet_id) if request.regnant_sheet_id else None,
        "p_regnant_entity_id": str(request.regnant_entity_id) if request.regnant_entity_id else None,
        "p_notes": request.notes, "p_decay_days": request.decay_days,
    }
    if request.drank_at is not None:
        payload["p_drank_at"] = request.drank_at.isoformat()
    try:
        return _object(await _rpc("record_v5_bond_drink", authorization, payload))
    except HTTPException as error:
        raise _remap(error, {
            403: "só o narrador registra ingestões do Vínculo",
            409: "este ID de operação já foi usado para outra ingestão",
            422: "doador inválido: escolha uma ficha ou NPC desta campanha e uma data passada",
        }) from error


@router.patch("/blood-bonds/{bond_id}")
async def configure_blood_bond(
    bond_id: UUID,
    request: BondSettings,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    try:
        return _object(await _rpc("configure_v5_blood_bond", authorization, {
            "p_bond_id": str(bond_id), "p_decay_days": request.decay_days, "p_notes": request.notes,
        }))
    except HTTPException as error:
        raise _remap(error, {403: "só o narrador configura o Vínculo"}) from error


# --- SAN-03: ações contra o Regente --------------------------------------------------

class RegnantActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: StrictStr = Field(min_length=1, max_length=300)
    roll_id: UUID | None = None

    @model_validator(mode="after")
    def described(self) -> RegnantActionRequest:
        if not self.action.strip():
            raise ValueError("descreva a ação contra o Regente")
        return self


class RegnantDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["permitida", "negada"]
    note: StrictStr | None = Field(default=None, max_length=500)


@router.get("/sheets/{sheet_id}/regnant-actions")
async def list_regnant_actions(
    sheet_id: UUID,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    return _rows(await _request("GET", "v5_regnant_actions", authorization, params={
        "select": "*", "thrall_sheet_id": f"eq.{sheet_id}", "order": "created_at.desc", "limit": "50",
    }))


@router.post("/blood-bonds/{bond_id}/regnant-actions", status_code=201)
async def request_regnant_action(
    bond_id: UUID,
    request: RegnantActionRequest,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Registra o teste de resistência; fica pendente até o narrador decidir."""
    try:
        return _object(await _rpc("request_v5_regnant_action", authorization, {
            "p_bond_id": str(bond_id), "p_action": request.action.strip(),
            "p_roll_id": str(request.roll_id) if request.roll_id else None,
        }))
    except HTTPException as error:
        raise _remap(error, {
            403: "só quem bebeu ou o narrador registram a ação",
            409: "esta rolagem já foi usada em outra ação",
            422: "a rolagem precisa ser da ficha vinculada",
        }) from error


@router.post("/regnant-actions/{action_id}/decision")
async def decide_regnant_action(
    action_id: UUID,
    request: RegnantDecision,
    _: None = Depends(require_signed_in_user),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    try:
        return _object(await _rpc("decide_v5_regnant_action", authorization, {
            "p_action_id": str(action_id), "p_decision": request.decision, "p_note": request.note,
        }))
    except HTTPException as error:
        raise _remap(error, {403: "só o narrador decide a ação contra o Regente", 409: "esta ação já foi decidida"}) from error
