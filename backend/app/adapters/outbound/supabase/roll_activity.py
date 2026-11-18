"""Adaptador de ``RollActivityRecorder`` sobre o gancho DRA-05 da crônica."""

from __future__ import annotations

from app.services.session_roll_activity import RollActivityResult, RollChronicleContext, record_from_context


class ChronicleRollRecorder:
    def __init__(self, authorization: str | None) -> None:
        self._authorization = authorization

    async def record(self, context: RollChronicleContext | None) -> RollActivityResult | None:
        return await record_from_context(self._authorization, context)
