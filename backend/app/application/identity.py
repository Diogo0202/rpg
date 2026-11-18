"""Porta comum a todos os casos de uso que exigem uma sessão válida."""

from __future__ import annotations

from typing import Protocol


class CurrentUser(Protocol):
    async def current_user_id(self) -> str: ...
