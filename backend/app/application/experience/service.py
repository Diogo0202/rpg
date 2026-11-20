"""EXP-02: compra de avanço com XP.

O cliente nunca informa o valor a debitar; o custo é recalculado pelo repositório
(public.purchase_advance) a partir do modelo aprovado da ficha.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from uuid import UUID

from app.application.experience.ports import AdvanceOrder, AdvanceQuote, AdvanceRepository, ExperiencePolicy, Row
from app.application.identity import CurrentUser
from app.domain.errors import Forbidden

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ExperienceService:
    def __init__(self, identity: CurrentUser, advances: AdvanceRepository, clock: Clock = utc_now) -> None:
        self._identity = identity
        self._advances = advances
        self._clock = clock

    async def quote(self, sheet_id: UUID, quote: AdvanceQuote) -> Row:
        """Prévia do custo calculada no servidor, mostrada antes da confirmação."""
        await self._identity.current_user_id()
        return await self._advances.quote(sheet_id, quote)

    async def purchase(self, sheet_id: UUID, order: AdvanceOrder) -> Row:
        """Compra atômica: o banco recalcula o custo, debita o XP e sobe o traço."""
        await self._identity.current_user_id()
        return await self._advances.purchase(sheet_id, order)

    async def history(self, sheet_id: UUID, limit: int) -> list[Row]:
        await self._identity.current_user_id()
        return await self._advances.history(sheet_id, limit)

    async def review(self, advance_id: UUID, approve: bool, note: str | None) -> Row:
        """O narrador aprova ou recusa uma compra pendente; o jogador pode cancelar a própria."""
        await self._identity.current_user_id()
        return await self._advances.review(advance_id, approve, note)

    async def refund(self, advance_id: UUID, note: str | None) -> Row:
        await self._identity.current_user_id()
        return await self._advances.refund(advance_id, note)

    async def policy(self, campaign_id: UUID) -> Row:
        await self._identity.current_user_id()
        saved = await self._advances.policy(campaign_id)
        return saved or {"campaign_id": str(campaign_id), "requires_approval": False, "updated_at": None}

    async def change_policy(self, campaign_id: UUID, requires_approval: bool) -> Row:
        """Só o narrador grava; depois disso as compras dos jogadores esperam aprovação."""
        user_id = await self._identity.current_user_id()
        policy = ExperiencePolicy(requires_approval, updated_by=user_id, updated_at=self._clock())
        saved = await self._advances.save_policy(campaign_id, policy)
        if not saved:
            raise Forbidden("só o narrador altera a política de XP")
        return saved
