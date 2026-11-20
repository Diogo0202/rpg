"""Regras dos comandos da Companhia em O Um Anel: cada comando aceita um conjunto fechado de campos."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.domain.errors import InvalidInput
from app.domain.one_ring_creation import catalog

MAX_NAME_LENGTH = 120
MAX_SAFE_HAVENS = 30
MAX_FELLOWSHIP_AMOUNT = 10_000
MAX_REASON_LENGTH = 200

COMMAND_FIELDS: dict[str, frozenset[str]] = {
    "create": frozenset({"name", "patron_id", "safe_havens"}),
    "configure": frozenset({"name", "patron_id", "safe_havens"}),
    "add_member": frozenset({"sheet_id"}),
    "remove_member": frozenset({"sheet_id"}),
    "set_focus": frozenset({"source_sheet_id", "target_sheet_id"}),
    "spend": frozenset({"amount", "reason"}),
    "restore": frozenset({"amount", "reason"}),
    "reset_session": frozenset({"session_id"}),
}


def _uuid(value: Any, message: str) -> str:
    try:
        return str(UUID(value))
    except (TypeError, ValueError, AttributeError) as error:
        raise InvalidInput(message) from error


def _text(value: Any, max_length: int) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= max_length


def _check_configuration(payload: dict[str, Any]) -> None:
    if not _text(payload["name"], MAX_NAME_LENGTH):
        raise InvalidInput("nome inválido")
    patron = payload["patron_id"]
    if patron is not None and (not isinstance(patron, str) or patron not in {item["id"] for item in catalog()["patrons"]}):
        raise InvalidInput("patrono inválido")
    havens = payload["safe_havens"]
    if not isinstance(havens, list) or len(havens) > MAX_SAFE_HAVENS or not all(_text(item, MAX_NAME_LENGTH) for item in havens):
        raise InvalidInput("refúgios inválidos")


def validated_command_payload(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Confere o formato do comando e devolve uma cópia com os ids normalizados."""
    if set(payload) != COMMAND_FIELDS[kind]:
        raise InvalidInput("payload incompatível com o comando")
    checked = dict(payload)
    if kind in {"create", "configure"}:
        _check_configuration(checked)
    elif kind in {"add_member", "remove_member"}:
        checked["sheet_id"] = _uuid(checked["sheet_id"], "ficha inválida")
    elif kind == "set_focus":
        checked["source_sheet_id"] = _uuid(checked["source_sheet_id"], "foco inválido")
        target = checked["target_sheet_id"]
        checked["target_sheet_id"] = _uuid(target, "foco inválido") if target is not None else None
    elif kind in {"spend", "restore"}:
        amount = checked["amount"]
        if type(amount) is not int or not 1 <= amount <= MAX_FELLOWSHIP_AMOUNT or not _text(checked["reason"], MAX_REASON_LENGTH):
            raise InvalidInput("gasto inválido")
    elif kind == "reset_session":
        checked["session_id"] = _uuid(checked["session_id"], "sessão inválida")
    return checked
