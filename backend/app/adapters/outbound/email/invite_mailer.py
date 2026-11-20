"""Envio do e-mail de convite por SMTP com STARTTLS ou pela API HTTP do Resend.

Toda a configuração vem do ambiente. O código do convite nunca entra em log.
"""

from __future__ import annotations

import asyncio
import os
import re
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

import httpx

from app.domain.invite_email import (
    EmailDeliveryError,
    EmailNotConfigured,
    InviteEmail,
    build_invite_email,
    has_control_characters,
    valid_address,
)

__all__ = [
    "EmailDeliveryError", "EmailNotConfigured", "EmailSettings", "EnvironmentInviteMailer", "InviteEmail",
    "build_invite_email", "deliver", "email_settings",
]

RESEND_ENDPOINT = "https://api.resend.com/emails"
DEFAULT_SMTP_PORT = 587
PROVIDER_TIMEOUT_SECONDS = 15
APP_BASE_URL = re.compile(r"https?://[^\s/?#]+(?:/[^\s?#]*)?")


@dataclass(frozen=True)
class EmailSettings:
    provider: str
    sender: str
    app_base_url: str
    smtp_host: str = ""
    smtp_port: int = DEFAULT_SMTP_PORT
    smtp_username: str = ""
    smtp_password: str = ""
    resend_api_key: str = ""


def email_settings() -> EmailSettings:
    provider = os.getenv("INVITE_EMAIL_PROVIDER", "").strip().lower()
    sender = os.getenv("INVITE_EMAIL_FROM", "").strip()
    base = os.getenv("APP_BASE_URL", "").strip().rstrip("/")
    if provider not in {"smtp", "resend"} or not sender or not base:
        raise EmailNotConfigured()
    _name, sender_address = parseaddr(sender)
    if has_control_characters(sender) or not valid_address(sender_address) or not APP_BASE_URL.fullmatch(base):
        raise EmailNotConfigured()
    if provider == "smtp":
        return _smtp_settings(sender, base)
    key = os.getenv("RESEND_API_KEY", "").strip()
    if not key:
        raise EmailNotConfigured()
    return EmailSettings(provider, sender, base, resend_api_key=key)


def _smtp_settings(sender: str, base: str) -> EmailSettings:
    host = os.getenv("SMTP_HOST", "").strip()
    try:
        port = int(os.getenv("SMTP_PORT", str(DEFAULT_SMTP_PORT)))
    except ValueError as error:
        raise EmailNotConfigured() from error
    if not host or not 1 <= port <= 65535:
        raise EmailNotConfigured()
    return EmailSettings(
        "smtp", sender, base, smtp_host=host, smtp_port=port,
        smtp_username=os.getenv("SMTP_USERNAME", ""), smtp_password=os.getenv("SMTP_PASSWORD", ""),
    )


def _send_smtp(settings: EmailSettings, message: InviteEmail) -> None:
    mail = EmailMessage()
    mail["From"] = settings.sender
    mail["To"] = formataddr(("", message.to))
    mail["Subject"] = message.subject
    mail.set_content(message.text)
    mail.add_alternative(message.html, subtype="html")
    context = ssl.create_default_context()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=PROVIDER_TIMEOUT_SECONDS) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.ehlo()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(mail)


async def _send_resend(settings: EmailSettings, message: InviteEmail) -> None:
    async with httpx.AsyncClient(timeout=PROVIDER_TIMEOUT_SECONDS) as client:
        response = await client.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"},
            json={"from": settings.sender, "to": [message.to], "subject": message.subject, "html": message.html, "text": message.text},
        )
    if response.status_code >= 400:
        raise EmailDeliveryError(f"Resend respondeu {response.status_code}")


async def deliver(settings: EmailSettings, message: InviteEmail) -> None:
    try:
        if settings.provider == "smtp":
            await asyncio.to_thread(_send_smtp, settings, message)
        else:
            await _send_resend(settings, message)
    except EmailDeliveryError:
        raise
    except (smtplib.SMTPException, OSError, ssl.SSLError, httpx.HTTPError) as error:
        raise EmailDeliveryError(type(error).__name__) from error


class EnvironmentInviteMailer:
    """Implementação de ``InviteMailer``; lê a configuração do ambiente a cada envio."""

    def settings(self) -> EmailSettings:
        return email_settings()

    async def deliver(self, settings: EmailSettings, message: InviteEmail) -> None:
        await deliver(settings, message)
