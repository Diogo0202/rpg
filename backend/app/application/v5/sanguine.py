"""SAN-01/02/03 do Vampiro V5: caçada, Vínculo de Sangue e ações contra o Regente.

As escritas são atômicas no armazenamento, que confere a permissão (dono da ficha ou narrador).
O caso de uso traduz os erros e calcula o grau do Vínculo com a mesma regra do banco.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

from app.application.v5.rolls import UNEXPECTED_RESPONSE, reworded
from app.domain.errors import Conflict, DomainError, Forbidden, InvalidInput, UnexpectedUpstreamResponse
from app.domain.v5_sanguine import bond_degree

Row = dict[str, Any]

HUNT_MESSAGES: dict[type[DomainError], str] = {
    Forbidden: "só o dono da ficha ou o narrador registram a caçada",
    Conflict: "este ID de operação já foi usado para outra caçada",
    InvalidInput: "caçada inválida para esta ficha (Fome, Ressonância ou limite de efeitos)",
}
DRINK_MESSAGES: dict[type[DomainError], str] = {
    Forbidden: "só o narrador registra ingestões do Vínculo",
    Conflict: "este ID de operação já foi usado para outra ingestão",
    InvalidInput: "doador inválido: escolha uma ficha ou NPC desta campanha e uma data passada",
}
BOND_SETTINGS_MESSAGES: dict[type[DomainError], str] = {Forbidden: "só o narrador configura o Vínculo"}
REGNANT_ACTION_MESSAGES: dict[type[DomainError], str] = {
    Forbidden: "só quem bebeu ou o narrador registram a ação",
    Conflict: "esta rolagem já foi usada em outra ação",
    InvalidInput: "a rolagem precisa ser da ficha vinculada",
}
REGNANT_DECISION_MESSAGES: dict[type[DomainError], str] = {
    Forbidden: "só o narrador decide a ação contra o Regente",
    Conflict: "esta ação já foi decidida",
}


@dataclass(frozen=True)
class Hunt:
    operation_id: UUID
    prey: str
    resonance: str
    intensity: str
    dyscrasia: str | None
    slake: int
    killed: bool
    notes: str | None


@dataclass(frozen=True)
class HuntResult:
    hunt: Row
    sheet_values: Row | None
    effects: list[Row] | None
    sheet_version: int | None
    replayed: bool


@dataclass(frozen=True)
class Drink:
    operation_id: UUID
    regnant_sheet_id: UUID | None
    regnant_entity_id: UUID | None
    drank_at: datetime | None
    notes: str | None
    decay_days: int | None


class SanguineStore(Protocol):
    async def record_hunt(self, sheet_id: UUID, hunt: Hunt) -> Any: ...

    async def hunts(self, sheet_id: UUID, limit: int) -> Any: ...

    async def bonds_of_thrall(self, sheet_id: UUID) -> Any: ...

    async def drinks_of_bonds(self, bond_ids: list[str]) -> Any: ...

    async def record_drink(self, thrall_sheet_id: UUID, drink: Drink) -> Any: ...

    async def configure_bond(self, bond_id: UUID, decay_days: int, notes: str | None) -> Any: ...

    async def regnant_actions(self, sheet_id: UUID) -> Any: ...

    async def request_regnant_action(self, bond_id: UUID, action: str, roll_id: UUID | None) -> Any: ...

    async def decide_regnant_action(self, action_id: UUID, decision: str, note: str | None) -> Any: ...


def rows(value: Any) -> list[Row]:
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
    return value


def single(value: Any) -> Row:
    if not isinstance(value, dict):
        raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
    return value


def bond_with_degree(bond: Row, drinks: list[Row], at: datetime | None = None) -> Row:
    history = sorted((drink for drink in drinks if drink.get("bond_id") == bond.get("id")), key=lambda drink: str(drink.get("drank_at")))
    decay_days = bond.get("decay_days")
    if type(decay_days) is not int or decay_days < 1:
        raise UnexpectedUpstreamResponse("vínculo guardado inválido")
    try:
        degree = bond_degree([str(drink["drank_at"]) for drink in history], decay_days, at)
    except (KeyError, ValueError) as error:
        raise UnexpectedUpstreamResponse("ingestão guardada inválida") from error
    return {**bond, "degree": degree, "drinks": history}


class V5SanguineService:
    def __init__(self, store: SanguineStore) -> None:
        self._store = store

    async def record_hunt(self, sheet_id: UUID, hunt: Hunt) -> HuntResult:
        """Reduz a Fome e troca o efeito de Ressonância na mesma escrita."""
        result = single(await _translated(self._store.record_hunt(sheet_id, hunt), HUNT_MESSAGES))
        sheet = result.get("sheet") if isinstance(result.get("sheet"), dict) else {}
        return HuntResult(
            hunt=single(result.get("hunt")),
            sheet_values=sheet.get("values") if isinstance(sheet.get("values"), dict) else None,
            effects=sheet.get("effects") if isinstance(sheet.get("effects"), list) else None,
            sheet_version=sheet.get("version") if type(sheet.get("version")) is int else None,
            replayed=result.get("replayed") is True,
        )

    async def hunts(self, sheet_id: UUID, limit: int) -> list[Row]:
        return rows(await self._store.hunts(sheet_id, limit))

    async def blood_bonds(self, sheet_id: UUID) -> list[Row]:
        """Vínculos em que a ficha bebeu, com o grau atual e o histórico de ingestões."""
        bonds = rows(await self._store.bonds_of_thrall(sheet_id))
        if not bonds:
            return []
        drinks = rows(await self._store.drinks_of_bonds([str(bond["id"]) for bond in bonds]))
        return [bond_with_degree(bond, drinks) for bond in bonds]

    async def record_drink(self, thrall_sheet_id: UUID, drink: Drink) -> Row:
        return single(await _translated(self._store.record_drink(thrall_sheet_id, drink), DRINK_MESSAGES))

    async def configure_bond(self, bond_id: UUID, decay_days: int, notes: str | None) -> Row:
        return single(await _translated(self._store.configure_bond(bond_id, decay_days, notes), BOND_SETTINGS_MESSAGES))

    async def regnant_actions(self, sheet_id: UUID) -> list[Row]:
        return rows(await self._store.regnant_actions(sheet_id))

    async def request_regnant_action(self, bond_id: UUID, action: str, roll_id: UUID | None) -> Row:
        """Registra o teste de resistência; fica pendente até o narrador decidir."""
        request = self._store.request_regnant_action(bond_id, action.strip(), roll_id)
        return single(await _translated(request, REGNANT_ACTION_MESSAGES))

    async def decide_regnant_action(self, action_id: UUID, decision: str, note: str | None) -> Row:
        decide = self._store.decide_regnant_action(action_id, decision, note)
        return single(await _translated(decide, REGNANT_DECISION_MESSAGES))


async def _translated(call: Any, messages: dict[type[DomainError], str]) -> Any:
    try:
        return await call
    except DomainError as error:
        raise reworded(error, messages) from error
