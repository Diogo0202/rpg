"""DRA-05: rolagens autenticadas viram atividade da crônica.

O contexto e o resultado ficam em ``app/domain/roll_activity.py``; este módulo define a porta.
A gravação fica em ``app/adapters/outbound/supabase/roll_activity.py``. O registro nunca derruba a
rolagem.
"""

from __future__ import annotations

from typing import Protocol

from app.domain.roll_activity import RollActivityResult, RollChronicleContext


class RollActivityRecorder(Protocol):
    """Registra a rolagem na crônica; nunca derruba a rolagem em caso de falha."""

    async def record(self, context: RollChronicleContext | None) -> RollActivityResult | None: ...

    async def record_field(self, context: RollChronicleContext | None, expression: str) -> RollActivityResult | None:
        """Rolagem de um campo da ficha, sem atribuir uso a traços que não participaram."""


async def chronicle_status(recorder: RollActivityRecorder, context: RollChronicleContext | None) -> str | None:
    """Status textual para o cabeçalho ``X-Chronicle-Activity``; ``None`` quando nada foi pedido."""
    activity = await recorder.record(context)
    return activity.status if activity else None
