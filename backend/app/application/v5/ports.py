"""Portas de saída das rolagens e do ciclo do Sangue de Vampiro V5.

Os dados são sempre gerados pelo armazenamento (funções do Postgres), nunca pelo cliente.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Protocol
from uuid import UUID

from app.services.session_roll_activity import RollActivityResult, RollChronicleContext
from app.services.v5_actions import AttackContext, EquippedWeapon

Row = dict[str, Any]


class BloodAction(str, Enum):
    ROUSE = "rouse"
    AWAKEN = "awaken"
    REMORSE = "remorse"
    FRENZY = "frenzy"
    COMPULSION = "compulsion"
    TORPOR = "torpor"
    MEND = "mend"
    SURGE = "surge"


class V5Store(Protocol):
    async def roll_sheet(self, sheet_id: UUID) -> Row | None:
        """Valores e efeitos ativos da ficha."""

    async def blood_sheet(self, sheet_id: UUID) -> Row | None:
        """Somente os valores da ficha."""

    async def surge_receipt(
        self, sheet_id: UUID, operation_id: UUID, base_pool: int, difficulty: int, turn_key: str, context_tags: list[str],
    ) -> Any:
        """Rolagem já gravada para este Surto, ou ``None`` na primeira tentativa."""

    async def blood_action(self, action: BloodAction, sheet_id: UUID, operation_id: UUID, params: dict[str, Any]) -> Any: ...

    async def record_roll(self, sheet_id: UUID, pool: int, hunger: int, difficulty: int, details: dict[str, Any]) -> Any: ...

    async def roll_history(self, sheet_id: UUID, limit: int) -> Any: ...

    async def willpower_reroll(self, roll_id: UUID, normal_indices: list[int]) -> Any: ...

    async def blood_events(self, sheet_id: UUID, limit: int) -> Any: ...

    async def attack_roll(self, roll_id: UUID) -> Any:
        """Margem e dificuldade de uma rolagem guardada, para calcular o dano de ataque."""


class WeaponReader(Protocol):
    """Lê a arma equipada com a sessão de quem pede, para que o RLS da ficha decida o acesso."""

    async def equipped_weapon(self, attack: AttackContext) -> EquippedWeapon | None: ...


class RollActivityRecorder(Protocol):
    """Registra a rolagem na crônica; nunca derruba a rolagem em caso de falha."""

    async def record(self, context: RollChronicleContext | None) -> RollActivityResult | None: ...
