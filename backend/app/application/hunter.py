"""F4: Caçador: A Revanche jogado na mesa.

Dados, Desesperação da célula e cada consequência ficam no banco
(supabase/migrations/20261029130000_hunter_desperation_edges.sql); o caso de uso só apresenta o
resultado e o registro na crônica.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

from app.domain.roll_activity import RollChronicleContext
from app.application.roll_activity import RollActivityRecorder, chronicle_status
from app.domain.errors import InvalidInput
from app.domain.hunter_traits import desperation_choices

Row = dict[str, Any]


class HunterTable(Protocol):
    async def roll(self, sheet_id: UUID, base_pool: int, difficulty: int, use_desperation: bool, details: Row) -> Row: ...

    async def reroll(self, roll_id: UUID, indices: list[int]) -> Row: ...

    async def resolve(self, roll_id: UUID, choice: str) -> Row: ...

    async def sheet_state(self, sheet_id: UUID) -> Row: ...

    async def adjust_cell(self, cell_id: UUID, operation_id: UUID, danger_delta: int, desperation_delta: int, reason: str | None) -> Row: ...

    async def request_redemption(self, sheet_id: UUID, note: str) -> Row: ...

    async def decide_redemption(self, redemption_id: UUID, approve: bool, note: str) -> Row: ...


def present_roll(payload: Row) -> Row:
    """Resultado da RPC no formato do rolador: dados, célula e o que a mesa pode escolher."""
    roll = payload.get("roll") or {}
    outcome = roll.get("outcome") or {}
    success = bool(outcome.get("success"))
    final_success = outcome.get("final_success", success)
    critical = bool(outcome.get("critical")) and bool(final_success)
    return {
        **payload,
        "roll_id": roll.get("id"),
        "normal_dice": roll.get("normal_dice", []),
        "desperation_dice": roll.get("desperation_dice", []),
        "desperation_ones": outcome.get("desperation_ones", 0),
        "successes": outcome.get("successes", 0),
        "difficulty": roll.get("difficulty"),
        "success": success,
        "critical_pairs": outcome.get("critical_pairs", 0),
        "critical": critical,
        "desperation_consequence": outcome.get("desperation_consequence"),
        "resolution": roll.get("resolution"),
        "choices": [] if roll.get("resolution") else desperation_choices(outcome),
        "can_reroll": roll.get("rerolled_at") is None and roll.get("resolution") is None,
        "verdict": "Crítico" if critical else "Êxito" if final_success else "Falha",
    }


@dataclass(frozen=True)
class HunterRollOrder:
    sheet_id: UUID
    base_pool: int
    difficulty: int
    use_desperation: bool
    edge: str | None
    chronicle: RollChronicleContext | None


@dataclass(frozen=True)
class HunterRollOutcome:
    result: Row
    chronicle_status: str | None


class HunterService:
    def __init__(self, table: HunterTable, activity: RollActivityRecorder) -> None:
        self._table = table
        self._activity = activity

    async def roll(self, order: HunterRollOrder) -> HunterRollOutcome:
        details = {"edge": order.edge} if order.edge else {}
        result = await self._table.roll(order.sheet_id, order.base_pool, order.difficulty, order.use_desperation, details)
        status = await chronicle_status(self._activity, order.chronicle)
        return HunterRollOutcome(present_roll(result), status)

    async def reroll(self, roll_id: UUID, indices: list[int]) -> Row:
        return present_roll(await self._table.reroll(roll_id, indices))

    async def resolve(self, roll_id: UUID, choice: str) -> Row:
        return present_roll(await self._table.resolve(roll_id, choice))

    async def sheet_state(self, sheet_id: UUID) -> Row:
        return await self._table.sheet_state(sheet_id)

    async def adjust_cell(self, cell_id: UUID, operation_id: UUID, danger_delta: int, desperation_delta: int, reason: str | None) -> Row:
        if danger_delta == 0 and desperation_delta == 0:
            raise InvalidInput("informe uma mudança de Perigo ou Desesperação")
        return await self._table.adjust_cell(cell_id, operation_id, danger_delta, desperation_delta, reason)

    async def request_redemption(self, sheet_id: UUID, note: str) -> Row:
        return await self._table.request_redemption(sheet_id, note)

    async def decide_redemption(self, redemption_id: UUID, approve: bool, note: str) -> Row:
        return await self._table.decide_redemption(redemption_id, approve, note)
