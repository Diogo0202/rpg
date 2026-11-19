"""Adaptador HTTP de Vampiro V5: probabilidades, rolagens guardadas e ciclo do Sangue."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator, model_validator

from app.adapters.inbound.http.dependencies import v5_blood_service, v5_roll_service
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.v5.blood import V5BloodService
from app.application.v5.models import BloodActionResult, Curve, ProbabilityComparison, StoredRoll, WillpowerReroll
from app.application.v5.ports import BloodAction
from app.application.v5.rolls import RollOrder, V5RollService, free_probabilities, probability_curve
from app.adapters.inbound.http.auth import require_signed_in_user
from app.services.modifiers import Tag
from app.application.roll_activity import RollChronicleContext
from app.services.v5_actions import V5ActionRollRequest
from app.services.v5_blood import (
    BLOOD_POTENCY_TABLE,
    CLAN_COMPULSIONS,
    COMPULSION_OPTIONS,
    GENERAL_COMPULSIONS,
    REVIEW_RULES as BLOOD_REVIEW_RULES,
)
from app.services.v5_probability import MAX_CURVE_DIFFICULTIES, MAX_CURVE_POOLS

router = APIRouter(
    prefix="/api/v1/v5", tags=["vampire-v5"], route_class=DomainErrorRoute,
    dependencies=[Depends(require_signed_in_user)],
)

MAX_POOL = 30
MAX_DIFFICULTY = 100
MAX_WILLPOWER_DICE = 3
ROLL_HISTORY_LIMIT = 50
CHRONICLE_ACTIVITY_HEADER = "X-Chronicle-Activity"

Rolls = Depends(v5_roll_service)
Blood = Depends(v5_blood_service)


# Probabilidades --------------------------------------------------------------------------


class ProbabilityRequest(V5ActionRollRequest):
    willpower_dice: StrictInt = Field(default=MAX_WILLPOWER_DICE, ge=0, le=MAX_WILLPOWER_DICE)


class SheetProbabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pool: StrictInt = Field(ge=0, le=MAX_POOL)
    difficulty: StrictInt = Field(ge=1, le=MAX_DIFFICULTY)
    willpower_dice: StrictInt = Field(default=MAX_WILLPOWER_DICE, ge=0, le=MAX_WILLPOWER_DICE)
    context_tags: list[Tag] = Field(default_factory=list, max_length=20)


class CurveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pools: list[StrictInt] = Field(min_length=1, max_length=MAX_CURVE_POOLS)
    difficulties: list[StrictInt] = Field(min_length=1, max_length=MAX_CURVE_DIFFICULTIES)
    hunger: StrictInt = Field(ge=0, le=5)
    willpower_dice: StrictInt = Field(default=MAX_WILLPOWER_DICE, ge=0, le=MAX_WILLPOWER_DICE)

    @field_validator("pools")
    @classmethod
    def pools_in_range(cls, value: list[int]) -> list[int]:
        if any(not 0 <= pool <= MAX_POOL for pool in value) or len(set(value)) != len(value):
            raise ValueError("paradas devem ser distintas e estar entre 0 e 30")
        return value

    @field_validator("difficulties")
    @classmethod
    def difficulties_in_range(cls, value: list[int]) -> list[int]:
        if any(not 1 <= difficulty <= MAX_DIFFICULTY for difficulty in value) or len(set(value)) != len(value):
            raise ValueError("dificuldades devem ser distintas e estar entre 1 e 100")
        return value


@router.post("/probabilities", response_model=ProbabilityComparison)
def get_probabilities(payload: ProbabilityRequest) -> ProbabilityComparison:
    return free_probabilities(payload, payload.willpower_dice)


@router.post("/sheets/{sheet_id}/probabilities", response_model=ProbabilityComparison)
async def get_sheet_probabilities(
    sheet_id: UUID, request: SheetProbabilityRequest, service: V5RollService = Rolls,
) -> ProbabilityComparison:
    return await service.sheet_probabilities(
        sheet_id, request.pool, request.difficulty, request.willpower_dice, request.context_tags,
    )


@router.post("/probability-curve", response_model=Curve)
def get_probability_curve(payload: CurveRequest) -> Curve:
    return probability_curve(payload.pools, payload.hunger, payload.difficulties, payload.willpower_dice)


# V5-07: rolagem guardada e rerrolagem de Vontade ------------------------------------------


class StoredRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pool: StrictInt = Field(ge=0, le=MAX_POOL)
    difficulty: StrictInt = Field(ge=1, le=MAX_DIFFICULTY)
    context_tags: list[Tag] = Field(default_factory=list, max_length=20)
    surge_turn_key: StrictStr | None = Field(default=None, min_length=1, max_length=120)
    surge_operation_id: UUID | None = None
    # DRA-05: atividade opcional da crônica, mesmo contrato de POST /api/v1/v5/roll.
    chronicle: RollChronicleContext | None = None

    @model_validator(mode="after")
    def surge_fields_match(self) -> Self:
        if (self.surge_turn_key is None) != (self.surge_operation_id is None):
            raise ValueError("Surto de Sangue precisa de chave de turno e ID de operação")
        return self


class WillpowerRerollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    normal_indices: list[StrictInt] = Field(min_length=1, max_length=MAX_WILLPOWER_DICE)

    @field_validator("normal_indices")
    @classmethod
    def distinct_indices(cls, value: list[int]) -> list[int]:
        if any(index < 0 or index >= MAX_POOL for index in value) or len(set(value)) != len(value):
            raise ValueError("escolha de 1 a 3 dados comuns distintos")
        return value


@router.post("/sheets/{sheet_id}/rolls", response_model=StoredRoll, status_code=201)
async def create_stored_roll(
    sheet_id: UUID, request: StoredRollRequest, response: Response, service: V5RollService = Rolls,
) -> StoredRoll:
    outcome = await service.roll(RollOrder(
        sheet_id=sheet_id, pool=request.pool, difficulty=request.difficulty, context_tags=request.context_tags,
        surge_turn_key=request.surge_turn_key, surge_operation_id=request.surge_operation_id,
        chronicle=request.chronicle,
    ))
    if outcome.chronicle_status is not None:
        response.headers[CHRONICLE_ACTIVITY_HEADER] = outcome.chronicle_status
    return outcome.roll


@router.get("/sheets/{sheet_id}/rolls", response_model=list[StoredRoll])
async def list_stored_rolls(
    sheet_id: UUID, limit: int = Query(default=20, ge=1, le=ROLL_HISTORY_LIMIT), service: V5RollService = Rolls,
) -> list[StoredRoll]:
    return await service.history(sheet_id, limit)


@router.post("/rolls/{roll_id}/willpower-reroll", response_model=WillpowerReroll)
async def willpower_reroll(roll_id: UUID, request: WillpowerRerollRequest, service: V5RollService = Rolls) -> WillpowerReroll:
    return await service.willpower_reroll(roll_id, request.normal_indices)


# F1: ciclo do Sangue ------------------------------------------------------------------------


class BloodOperationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID

    def params(self) -> dict[str, Any]:
        return self.model_dump(exclude={"operation_id"})


class RouseRequest(BloodOperationRequest):
    discipline_level: StrictInt | None = Field(default=None, ge=1, le=10)
    reason: str | None = Field(default=None, max_length=120)


class FrenzyRequest(BloodOperationRequest):
    difficulty: StrictInt = Field(ge=1, le=10)
    kind: Literal["fury", "hunger", "terror"] = "fury"


class CompulsionRequest(BloodOperationRequest):
    compulsion: Literal[COMPULSION_OPTIONS] | None = None  # type: ignore[valid-type]


class TorporRequest(BloodOperationRequest):
    in_torpor: bool


class BloodSurgeRequest(BloodOperationRequest):
    turn_key: str = Field(min_length=1, max_length=120)
    base_pool: StrictInt = Field(ge=0, le=MAX_POOL)


@router.get("/blood-potency")
def get_blood_potency_table() -> dict[str, Any]:
    return {
        "rows": [asdict(row) for row in BLOOD_POTENCY_TABLE],
        "compulsions": [asdict(item) for item in GENERAL_COMPULSIONS],
        "clan_compulsions": {clan: asdict(item) for clan, item in CLAN_COMPULSIONS.items()},
        "review": list(BLOOD_REVIEW_RULES),
    }


@router.get("/sheets/{sheet_id}/blood")
async def get_sheet_blood(sheet_id: UUID, service: V5BloodService = Blood) -> dict[str, Any]:
    return await service.state(sheet_id)


@router.get("/sheets/{sheet_id}/blood-events")
async def list_blood_events(
    sheet_id: UUID, limit: int = Query(default=20, ge=1, le=50), service: V5BloodService = Blood,
) -> list[dict[str, Any]]:
    return await service.events(sheet_id, limit)


async def _act(service: V5BloodService, action: BloodAction, sheet_id: UUID, request: BloodOperationRequest) -> BloodActionResult:
    return await service.act(action, sheet_id, request.operation_id, request.params())


@router.post("/sheets/{sheet_id}/rouse", response_model=BloodActionResult)
async def rouse_check(sheet_id: UUID, request: RouseRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.ROUSE, sheet_id, request)


@router.post("/sheets/{sheet_id}/awaken", response_model=BloodActionResult)
async def awaken(sheet_id: UUID, request: BloodOperationRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.AWAKEN, sheet_id, request)


@router.post("/sheets/{sheet_id}/remorse", response_model=BloodActionResult)
async def remorse_check(sheet_id: UUID, request: BloodOperationRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.REMORSE, sheet_id, request)


@router.post("/sheets/{sheet_id}/frenzy", response_model=BloodActionResult)
async def frenzy_check(sheet_id: UUID, request: FrenzyRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.FRENZY, sheet_id, request)


@router.post("/sheets/{sheet_id}/compulsion", response_model=BloodActionResult)
async def set_compulsion(sheet_id: UUID, request: CompulsionRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.COMPULSION, sheet_id, request)


@router.post("/sheets/{sheet_id}/torpor", response_model=BloodActionResult)
async def set_torpor(sheet_id: UUID, request: TorporRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.TORPOR, sheet_id, request)


@router.post("/sheets/{sheet_id}/mend", response_model=BloodActionResult)
async def mend(sheet_id: UUID, request: BloodOperationRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.MEND, sheet_id, request)


@router.post("/sheets/{sheet_id}/surge", response_model=BloodActionResult)
async def blood_surge(sheet_id: UUID, request: BloodSurgeRequest, service: V5BloodService = Blood) -> BloodActionResult:
    return await _act(service, BloodAction.SURGE, sheet_id, request)
