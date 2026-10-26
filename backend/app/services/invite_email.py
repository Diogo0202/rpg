"""Envio do e-mail de convite de campanha (SMTP com STARTTLS ou API HTTP do Resend).

Toda a configuração vem do ambiente. O destinatário, o código e os nomes vêm
da RPC ``reserve_campaign_invite_email`` executada com o token do usuário; o
corpo do pedido nunca escolhe o destinatário. O código do convite não é logado.
"""

from __future__ import annotations

import asyncio
import html
import logging
import os
import re
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Any

import httpx


logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
_EMAIL = re.compile(r"^[^@\s<>\"',;:\\]+@[^@\s<>\"',;:\\]+\.[^@\s<>\"',;:\\]+$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f  ]")
_CODE = re.compile(r"^[A-F0-9]{12}$")
_ROLE_LABELS = {"master": "mestre", "player": "jogador", "guest": "convidado"}


class EmailNotConfigured(Exception):
    """Nenhum provedor configurado; a interface mantém o fluxo do código."""


class EmailDeliveryError(Exception):
    """O provedor recusou ou não respondeu. A mensagem não contém segredos."""


@dataclass(frozen=True)
class EmailSettings:
    provider: str
    sender: str
    app_base_url: str
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    resend_api_key: str = ""


@dataclass(frozen=True)
class InviteEmail:
    to: str
    subject: str
    text: str
    html: str


def single_line(value: Any, limit: int = 120) -> str:
    """Remove quebras e controles (sem injeção de cabeçalho) e limita o tamanho."""
    text = _CONTROL.sub(" ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def valid_address(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= 320 and not _CONTROL.search(value) and bool(_EMAIL.fullmatch(value))


def email_settings() -> EmailSettings:
    provider = os.getenv("INVITE_EMAIL_PROVIDER", "").strip().lower()
    sender = os.getenv("INVITE_EMAIL_FROM", "").strip()
    base = os.getenv("APP_BASE_URL", "").strip().rstrip("/")
    if provider not in {"smtp", "resend"} or not sender or not base:
        raise EmailNotConfigured()
    _name, sender_address = parseaddr(sender)
    if _CONTROL.search(sender) or not valid_address(sender_address):
        raise EmailNotConfigured()
    if not re.fullmatch(r"https?://[^\s/?#]+(?:/[^\s?#]*)?", base):
        raise EmailNotConfigured()
    if provider == "smtp":
        host = os.getenv("SMTP_HOST", "").strip()
        try:
            port = int(os.getenv("SMTP_PORT", "587"))
        except ValueError as error:
            raise EmailNotConfigured() from error
        if not host or not 1 <= port <= 65535:
            raise EmailNotConfigured()
        return EmailSettings(
            provider, sender, base, smtp_host=host, smtp_port=port,
            smtp_username=os.getenv("SMTP_USERNAME", ""), smtp_password=os.getenv("SMTP_PASSWORD", ""),
        )
    key = os.getenv("RESEND_API_KEY", "").strip()
    if not key:
        raise EmailNotConfigured()
    return EmailSettings(provider, sender, base, resend_api_key=key)


def format_code(code: str) -> str:
    return "-".join(code[index:index + 4] for index in range(0, len(code), 4))


def build_invite_email(invite: dict[str, Any], app_base_url: str) -> InviteEmail:
    recipient = invite.get("email")
    code = invite.get("code")
    if not valid_address(recipient) or not isinstance(code, str) or not _CODE.fullmatch(code):
        raise EmailDeliveryError("convite sem destinatário ou código válido")
    campaign = single_line(invite.get("campaign_name"), 120) or "uma campanha"
    inviter = single_line(invite.get("inviter_name"), 80) or "Um mestre da campanha"
    role = _ROLE_LABELS.get(str(invite.get("role")), "participante")
    link = f"{app_base_url}/app"
    code_text = format_code(code)
    subject = single_line(f"Convite para a campanha {campaign}", 160)
    text = (
        f"{inviter} convidou você para a campanha \"{campaign}\" como {role}.\n\n"
        f"Entre com este endereço de e-mail em {link} e aceite o convite, "
        f"ou use o código {code_text} na mesma página.\n\n"
        "O código vale uma única vez e expira em 14 dias. Se não esperava este convite, ignore esta mensagem.\n"
    )
    e = html.escape
    body = (
        "<!doctype html><html lang=\"pt-BR\"><body style=\"font-family:sans-serif;line-height:1.5\">"
        f"<p><strong>{e(inviter)}</strong> convidou você para a campanha <strong>{e(campaign)}</strong> como {e(role)}.</p>"
        f"<p><a href=\"{e(link, quote=True)}\">Entrar e aceitar o convite</a></p>"
        f"<p>Ou use o código <code style=\"font-size:1.2em\">{e(code_text)}</code> na mesma página.</p>"
        "<p style=\"color:#666\">O código vale uma única vez e expira em 14 dias. "
        "Se não esperava este convite, ignore esta mensagem.</p></body></html>"
    )
    return InviteEmail(to=recipient, subject=subject, text=text, html=body)


def _send_smtp(settings: EmailSettings, message: InviteEmail) -> None:
    mail = EmailMessage()
    mail["From"] = settings.sender
    mail["To"] = formataddr(("", message.to))
    mail["Subject"] = message.subject
    mail.set_content(message.text)
    mail.add_alternative(message.html, subtype="html")
    context = ssl.create_default_context()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.ehlo()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(mail)


async def _send_resend(settings: EmailSettings, message: InviteEmail) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
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
