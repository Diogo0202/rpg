"""Implementação de ``InviteMailer`` sobre SMTP com STARTTLS ou a API HTTP do Resend."""

from __future__ import annotations

from app.services import invite_email
from app.services.invite_email import EmailSettings, InviteEmail


class EnvironmentInviteMailer:
    """Lê a configuração do ambiente a cada envio, para refletir mudanças sem reiniciar."""

    def settings(self) -> EmailSettings:
        return invite_email.email_settings()

    async def deliver(self, settings: EmailSettings, message: InviteEmail) -> None:
        await invite_email.deliver(settings, message)
