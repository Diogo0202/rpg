"""Rolagens por sistema com dados do servidor e ações atômicas da ficha de Vampiro V3."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, Literal, Protocol, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.domain.roll_activity import RollChronicleContext
from app.application.roll_activity import RollActivityRecorder, chronicle_status
from app.domain.errors import Conflict, InvalidInput
from app.domain.system_rolls import V3RollRequest, V3RollResponse, roll_v3

Result = TypeVar("Result")
LIFE_ACTIONS = frozenset({"alimentar", "torpor", "despertar", "morte_final"})


class V3SheetAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    action: Literal["sangue", "cura", "dano", "sangue_inicial", "frenesi", "rotschreck", "degeneracao", "alimentar", "torpor", "despertar", "morte_final"]
    amount: StrictInt | None = Field(default=None, ge=0, le=50)
    kind: Literal["contundente", "letal", "agravado"] | None = None
    difficulty: StrictInt | None = Field(default=None, ge=2, le=10)
    turn: str | None = Field(default=None, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9:._-]+$")
    note: str | None = Field(default=None, min_length=12, max_length=240)


def check_v3_action(action: V3SheetAction) -> None:
    """Cada ação exige os números que a regra pede; o banco confere limites e permissão."""
    if action.action in LIFE_ACTIONS:
        if not action.note or (action.action == "alimentar" and not action.amount):
            raise InvalidInput("registre a decisão do narrador e a quantidade da alimentação")
    elif action.action in {"sangue", "cura"}:
        if not action.amount:
            raise InvalidInput("informe a quantidade")
    elif action.action == "dano":
        if not action.amount or not action.kind:
            raise InvalidInput("informe o tipo e os níveis de dano")
    elif action.action != "sangue_inicial" and action.difficulty is None:
        raise InvalidInput("informe a dificuldade")


class V3Sheets(Protocol):
    async def life_state(self, sheet_id: UUID | str) -> Any: ...

    async def spend_willpower(self, sheet_id: str, operation_id: str) -> Any: ...

    async def apply(self, sheet_id: UUID, action: V3SheetAction) -> Any: ...


@dataclass(frozen=True)
class RollOutcome(Generic[Result]):
    result: Result
    chronicle_status: str | None


class SystemRollService:
    def __init__(self, activity: RollActivityRecorder, v3_sheets: V3Sheets) -> None:
        self._activity = activity
        self._v3 = v3_sheets

    async def with_chronicle(self, result: Result, context: RollChronicleContext | None) -> RollOutcome[Result]:
        """DRA-05: a rolagem nunca muda; só um cabeçalho informa o registro na crônica."""
        return RollOutcome(result, await chronicle_status(self._activity, context))

    async def roll_v3(self, request: V3RollRequest) -> RollOutcome[V3RollResponse]:
        """Com Força de Vontade e ficha, 1 ponto é gasto de forma atômica antes de rolar."""
        if request.sheet_id:
            life = await self._v3.life_state(request.sheet_id)
            if not isinstance(life, dict) or life.get("state") != "active":
                raise Conflict("personagem em Torpor ou Morte Final nao pode agir")
        spends_willpower = bool(request.use_willpower and request.sheet_id)
        if spends_willpower:
            if not request.operation_id:
                raise InvalidInput("o gasto de Força de Vontade precisa de operation_id")
            await self._v3.spend_willpower(request.sheet_id, request.operation_id)
        try:
            result = roll_v3(request)
        except ValueError as error:
            raise InvalidInput(str(error)) from error
        result.willpower_spent = spends_willpower
        return await self.with_chronicle(result, request.chronicle)

    async def v3_action(self, sheet_id: UUID, action: V3SheetAction) -> Any:
        check_v3_action(action)
        return await self._v3.apply(sheet_id, action)

    async def v3_life_state(self, sheet_id: UUID) -> Any:
        return await self._v3.life_state(sheet_id)
