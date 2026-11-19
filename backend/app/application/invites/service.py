"""Envio do e-mail de convite de campanha.

O pedido informa só o id do convite. A reserva confere que a sessão administra o convite,
que ele é por e-mail e está pendente, aplica o limite de reenvio e devolve destinatário,
código e nomes. O corpo do pedido nunca escolhe o destinatário.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol
from uuid import UUID

from app.domain.errors import ServiceUnavailable, UnexpectedUpstreamResponse
from app.domain.invite_email import EmailDeliveryError, EmailNotConfigured, InviteEmail, build_invite_email

logger = logging.getLogger(__name__)

Row = dict[str, Any]
NOT_CONFIGURED = "O envio de e-mail não está configurado neste servidor. Compartilhe o código do convite."
DELIVERY_REFUSED = "O provedor de e-mail não aceitou o envio. A tentativa foi contada; compartilhe o código se persistir."


class InviteReservations(Protocol):
    async def reserve_email(self, invite_id: UUID) -> Row:
        """Conta a tentativa de envio e devolve os dados do convite."""


class InviteMailer(Protocol):
    def settings(self) -> Any:
        """Configuração com ``provider`` e ``app_base_url``; levanta ``EmailNotConfigured`` quando falta algo."""

    async def deliver(self, settings: Any, message: InviteEmail) -> None: ...


class InviteEmailService:
    def __init__(self, reservations: InviteReservations, mailer: InviteMailer) -> None:
        self._reservations = reservations
        self._mailer = mailer

    async def send(self, invite_id: UUID) -> Row:
        # Sem provedor nada é reservado, e a interface segue com o código.
        try:
            settings = self._mailer.settings()
        except EmailNotConfigured as error:
            raise ServiceUnavailable(NOT_CONFIGURED) from error
        invite = await self._reservations.reserve_email(invite_id)
        try:
            await self._mailer.deliver(settings, build_invite_email(invite, settings.app_base_url))
        except EmailDeliveryError as error:
            # Nunca registrar o código nem o destinatário.
            logger.warning("invite e-mail delivery failed invite=%s provider=%s reason=%s", invite_id, settings.provider, error)
            raise UnexpectedUpstreamResponse(DELIVERY_REFUSED) from error
        logger.info("invite e-mail sent invite=%s provider=%s count=%s", invite_id, settings.provider, invite.get("email_sent_count"))
        return {
            "sent": True,
            "invite_id": str(invite_id),
            "email_sent_count": invite.get("email_sent_count"),
            "last_email_sent_at": invite.get("last_email_sent_at"),
        }
