"""Texto do e-mail de convite de campanha.

O destinatário, o código e os nomes vêm da reserva feita no banco com o token do usuário; o corpo
do pedido nunca escolhe o destinatário. Nada aqui grava log do código do convite.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any

_EMAIL = re.compile(r"^[^@\s<>\"',;:\\]+@[^@\s<>\"',;:\\]+\.[^@\s<>\"',;:\\]+$")
_CONTROL = re.compile("[\x00-\x1f\x7f\u2028\u2029]")
_CODE = re.compile(r"^[A-F0-9]{12}$")
_ROLE_LABELS = {"master": "mestre", "player": "jogador", "guest": "convidado"}
MAX_ADDRESS_LENGTH = 320
CODE_GROUP = 4


class EmailNotConfigured(Exception):
    """Nenhum provedor configurado; a interface mantém o fluxo do código."""


class EmailDeliveryError(Exception):
    """O provedor recusou ou não respondeu. A mensagem não contém segredos."""


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
    return isinstance(value, str) and len(value) <= MAX_ADDRESS_LENGTH and not _CONTROL.search(value) and bool(_EMAIL.fullmatch(value))


def has_control_characters(value: str) -> bool:
    return bool(_CONTROL.search(value))


def format_code(code: str) -> str:
    return "-".join(code[index:index + CODE_GROUP] for index in range(0, len(code), CODE_GROUP))


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
    escape = html.escape
    body = (
        "<!doctype html><html lang=\"pt-BR\"><body style=\"font-family:sans-serif;line-height:1.5\">"
        f"<p><strong>{escape(inviter)}</strong> convidou você para a campanha <strong>{escape(campaign)}</strong> como {escape(role)}.</p>"
        f"<p><a href=\"{escape(link, quote=True)}\">Entrar e aceitar o convite</a></p>"
        f"<p>Ou use o código <code style=\"font-size:1.2em\">{escape(code_text)}</code> na mesma página.</p>"
        "<p style=\"color:#666\">O código vale uma única vez e expira em 14 dias. "
        "Se não esperava este convite, ignore esta mensagem.</p></body></html>"
    )
    return InviteEmail(to=recipient, subject=subject, text=text, html=body)
