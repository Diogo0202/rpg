"""Uma chamada paga à IA: reserva, despacho, geração, validação e liquidação no livro do orçamento.

Propostas, rascunhos e o tutor seguem as mesmas regras: um pedido pago que estourou o tempo fica
marcado como incerto, nunca é devolvido às cegas.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.application.ai.ports import AIProviderError, AIUnavailable, Actor, AiPrivateStore, AiProvider, Row
from app.domain.errors import Conflict, InvalidInput, RateLimited, ServiceUnavailable

LOGGER = logging.getLogger(__name__)
RETRY_AFTER_SECONDS = "60"
BUSY_REASONS = frozenset({"budget", "busy", "rate"})
ResultCheck = Callable[[Row], Awaitable[None]]


class PaidGeneration:
    def __init__(self, ledger: AiPrivateStore, provider: AiProvider) -> None:
        self._ledger = ledger
        self._provider = provider

    async def run(
        self, campaign_id: str, actor: Actor, kind: str, context: Row, template: Row | None,
        operation_id: str, check: ResultCheck | None = None,
    ) -> Row:
        settings = self._checked_settings(kind, context, template)
        await self._reserve(campaign_id, actor, operation_id, settings)
        dispatched = settled = False
        known_usage: dict[str, int] | None = None
        try:
            if await self._ledger.dispatch(operation_id) is not True:
                raise ServiceUnavailable("A reserva da geração não pôde ser confirmada.")
            dispatched = True
            generated = await self._provider.generate(kind, context, template)
            known_usage = {"input_tokens": generated.input_tokens, "output_tokens": generated.output_tokens}
            result = self._provider.validate(kind, generated.result, template)
            if check is not None:
                await check(result)
            if await self._settle(operation_id, settings, known_usage) is not True:
                raise ServiceUnavailable("Não foi possível confirmar o consumo da geração.")
            settled = True
            LOGGER.info("ai_generation status=success kind=%s input_tokens=%d output_tokens=%d",
                        kind, generated.input_tokens, generated.output_tokens)
            return result
        except (Exception, asyncio.CancelledError) as error:
            usage = known_usage or (error.usage if isinstance(error, AIProviderError) else None)
            await self._close_after_failure(operation_id, settings, usage, dispatched=dispatched, settled=settled)
            raise

    def _checked_settings(self, kind: str, context: Row, template: Row | None) -> Any:
        try:
            settings = self._provider.settings()
            self._provider.check_request(kind, context, template, settings)
        except AIUnavailable as error:
            raise ServiceUnavailable("IA desativada ou configuração incompleta.") from error
        except AIProviderError as error:
            raise InvalidInput("O pedido excede os limites da IA ou possui campos inválidos.") from error
        return settings

    async def _reserve(self, campaign_id: str, actor: Actor, operation_id: str, settings: Any) -> None:
        reserve = await self._ledger.reserve(campaign_id, actor.id, operation_id, settings.reserve_micro)
        if isinstance(reserve, dict) and reserve.get("admitted"):
            return
        reason = reserve.get("reason") if isinstance(reserve, dict) else None
        if reason == "duplicate":
            raise Conflict("Esta operação já foi enviada. Nenhuma nova chamada foi feita. O cálculo sem IA continua disponível.")
        message = "Orçamento ou limite de geração indisponível. Aguarde antes de tentar novamente."
        if reason in BUSY_REASONS:
            raise RateLimited(message, retry_after_seconds=RETRY_AFTER_SECONDS)
        raise ServiceUnavailable(message)

    async def _settle(self, operation_id: str, settings: Any, usage: dict[str, int]) -> Any:
        return await self._ledger.settle(
            operation_id, settings.cost_micro(usage["input_tokens"], usage["output_tokens"]),
            usage["input_tokens"], usage["output_tokens"],
        )

    async def _close_after_failure(
        self, operation_id: str, settings: Any, usage: dict[str, int] | None, *, dispatched: bool, settled: bool,
    ) -> None:
        """Consumo conhecido é liquidado; sem ele, pedido despachado fica incerto e não despachado é cancelado."""
        if settled:
            return
        try:
            if dispatched and usage:
                if await asyncio.shield(self._settle(operation_id, settings, usage)) is not True:
                    await asyncio.shield(self._ledger.mark_uncertain(operation_id))
            elif dispatched:
                await asyncio.shield(self._ledger.mark_uncertain(operation_id))
            else:
                await asyncio.shield(self._ledger.cancel(operation_id))
        except Exception:
            LOGGER.warning("ai_generation settlement=unavailable")
