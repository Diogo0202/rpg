"""F1: ciclo do Sangue (Despertar, Remorso, Frenesi, Compulsão, Torpor, Remendo e Surto).

Os dados são rolados pelas funções do banco (20261029100000_v5_blood_cycle.sql).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.application.v5.models import BloodActionResult
from app.application.v5.ports import BloodAction, V5Store
from app.application.v5.rolls import UNEXPECTED_RESPONSE, reworded
from app.domain.errors import Conflict, DomainError, Forbidden, InvalidInput, NotFound, UnexpectedUpstreamResponse
from app.services.v5_blood import blood_state

BLOOD_MESSAGES: dict[type[DomainError], str] = {
    Forbidden: "só o dono da ficha ou o narrador age sobre o Sangue dela",
    Conflict: "este ID de operação já foi usado para outra ação de Sangue",
    InvalidInput: "ação de Sangue inválida para esta ficha",
}


def blood_action_result(result: Any) -> BloodActionResult:
    if not isinstance(result, dict) or not isinstance(result.get("outcome"), dict):
        raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
    sheet = result.get("sheet") if isinstance(result.get("sheet"), dict) else None
    event = result.get("event") if isinstance(result.get("event"), dict) else {}
    dice = result.get("dice") if isinstance(result.get("dice"), list) else []
    values = sheet.get("values") if sheet and isinstance(sheet.get("values"), dict) else None
    return BloodActionResult(
        replayed=result.get("replayed") is True,
        outcome=result["outcome"],
        dice=[face for face in dice if type(face) is int],
        event_id=event.get("id") if type(event.get("id")) is int else None,
        sheet=sheet,
        state=blood_state(values) if values is not None else None,
    )


class V5BloodService:
    def __init__(self, store: V5Store) -> None:
        self._store = store

    async def state(self, sheet_id: UUID) -> dict[str, Any]:
        sheet = await self._store.blood_sheet(sheet_id)
        if sheet is None:
            raise NotFound("ficha não encontrada")
        values = sheet.get("values")
        if not isinstance(values, dict):
            raise InvalidInput("dados da ficha inválidos")
        return blood_state(values)

    async def events(self, sheet_id: UUID, limit: int) -> list[dict[str, Any]]:
        rows = await self._store.blood_events(sheet_id, limit)
        if not isinstance(rows, list):
            raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
        return rows

    async def act(
        self, action: BloodAction, sheet_id: UUID, operation_id: UUID, params: dict[str, Any] | None = None,
    ) -> BloodActionResult:
        try:
            result = await self._store.blood_action(action, sheet_id, operation_id, params or {})
        except DomainError as error:
            raise reworded(error, BLOOD_MESSAGES) from error
        return blood_action_result(result)
