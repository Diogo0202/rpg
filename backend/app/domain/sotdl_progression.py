"""Milestones that can be checked without copying path benefits from a rulebook."""

from __future__ import annotations

from typing import Any


PATH_MILESTONES = {1: "trilha_novato", 3: "trilha_especialista", 7: "trilha_mestre"}
MAX_LEVEL = 10


def validate_sotdl_creation(values: dict[str, Any]) -> None:
    """The starter represents a new level-zero character."""
    if values.get("nivel", 0) != 0 or isinstance(values.get("nivel", 0), bool):
        raise ValueError("a criação de SotDL começa no nível 0")
    if any(values.get(field) for field in PATH_MILESTONES.values()):
        raise ValueError("trilhas são escolhidas durante a progressão")


def validate_sotdl_advance(before: dict[str, Any], after: dict[str, Any]) -> None:
    """Require consecutive levels and the path unlocked at each milestone."""
    previous = before.get("nivel", 0)
    next_level = after.get("nivel", 0)
    if any(type(level) is not int or level < 0 or level > MAX_LEVEL for level in (previous, next_level)):
        raise ValueError("nível de SotDL precisa estar entre 0 e 10")
    if next_level not in (previous, previous + 1):
        raise ValueError("avance SotDL um nível por vez")
    for milestone, field in PATH_MILESTONES.items():
        chosen = after.get(field)
        if next_level >= milestone:
            if not isinstance(chosen, str) or not chosen.strip() or len(chosen.strip()) > 120:
                raise ValueError(f"{field} é obrigatória a partir do nível {milestone}")
            if previous >= milestone and chosen != before.get(field):
                raise ValueError(f"{field} não pode mudar durante o avanço")
        elif chosen:
            raise ValueError(f"{field} só pode ser escolhida no nível {milestone}")
