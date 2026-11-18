"""Ações de Vampiro V5 com dados gerados no servidor e ataque com a arma equipada (INV-06)."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from pydantic import ValidationError

from app.application.v5.ports import RollActivityRecorder, V5Store, WeaponReader
from app.application.v5.rolls import UNEXPECTED_RESPONSE
from app.domain.errors import InvalidInput, NotFound, UnexpectedUpstreamResponse
from app.services.v5_actions import (
    AttackContext,
    StoredAttackResponse,
    V5ActionRollRequest,
    V5ActionRollResponse,
    resolve_stored_attack,
    roll_v5_action,
)

INVALID_STORED_ROLL = "rolagem guardada inválida"


@dataclass(frozen=True)
class ActionOutcome:
    result: V5ActionRollResponse
    chronicle_status: str | None


class V5ActionService:
    def __init__(self, store: V5Store, weapons: WeaponReader, activity: RollActivityRecorder) -> None:
        self._store = store
        self._weapons = weapons
        self._activity = activity

    async def roll(self, request: V5ActionRollRequest) -> ActionOutcome:
        attack = request.attack
        weapon = await self._weapons.equipped_weapon(attack) if attack and attack.use_equipped_weapon else None
        try:
            result = roll_v5_action(request, weapon=weapon)
        except ValueError as error:
            raise InvalidInput(str(error)) from error
        activity = await self._activity.record(request.chronicle)
        return ActionOutcome(result, activity.status if activity else None)

    async def stored_attack(self, roll_id: UUID, use_equipped_weapon: bool) -> StoredAttackResponse:
        """Margem do resultado guardado mais a arma equipada.

        Depois de uma rerrolagem de Vontade, o cálculo usa o resultado atualizado.
        """
        rows = await self._store.attack_roll(roll_id)
        if not isinstance(rows, list):
            raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
        if not rows:
            raise NotFound("rolagem não encontrada")
        row = rows[0]
        weapon = None
        if use_equipped_weapon and isinstance(row, dict):
            try:
                context = AttackContext(sheet_id=row.get("sheet_id"), campaign_id=row.get("campaign_id"))
            except ValidationError as error:
                raise UnexpectedUpstreamResponse(INVALID_STORED_ROLL) from error
            weapon = await self._weapons.equipped_weapon(context)
        try:
            return resolve_stored_attack(row, weapon)
        except ValueError as error:
            raise UnexpectedUpstreamResponse(INVALID_STORED_ROLL) from error
