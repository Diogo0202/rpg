"""Regras de entrada para controlar o Spotify: formato dos identificadores e comando de tocar."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.domain.errors import InvalidInput

PLAYLIST_ID = re.compile(r"^[A-Za-z0-9]{22}$")
TRACK_URI = re.compile(r"^spotify:track:[0-9A-Za-z]{22}$")
CONTEXT_URI = re.compile(r"^spotify:(playlist|album):[0-9A-Za-z]{22}$")
DEVICE_ID = re.compile(r"^[A-Za-z0-9]{1,128}$")


def device_params(device_id: str | None) -> dict[str, str] | None:
    if device_id is None:
        return None
    if not DEVICE_ID.fullmatch(device_id):
        raise InvalidInput("aparelho inválido")
    return {"device_id": device_id}


def checked_playlist_id(value: str) -> str:
    if not PLAYLIST_ID.fullmatch(value):
        raise InvalidInput("playlist inválida")
    return value


@dataclass(frozen=True)
class PlayCommand:
    playlist_id: str | None = None
    context_uri: str | None = None
    uris: list[str] | None = None
    offset_uri: str | None = None
    position_ms: int | None = None

    def body(self) -> dict[str, Any] | None:
        """Corpo do pedido ``/me/player/play``; ``None`` só retoma a reprodução atual."""
        context_uri = self.context_uri
        if self.playlist_id is not None:
            checked_playlist_id(self.playlist_id)
            if context_uri is not None:
                raise InvalidInput("informe playlist_id ou context_uri, não os dois")
            context_uri = f"spotify:playlist:{self.playlist_id}"
        if context_uri is not None and self.uris is not None:
            raise InvalidInput("informe context_uri ou uris, não os dois")
        if self.offset_uri is not None and context_uri is None and self.uris is None:
            raise InvalidInput("offset_uri exige context_uri ou uris")
        if context_uri is None and self.uris is None and self.position_ms is None:
            return None
        body: dict[str, Any] = {}
        if context_uri is not None:
            body["context_uri"] = context_uri
        if self.uris is not None:
            body["uris"] = self.uris
        if self.offset_uri is not None:
            body["offset"] = {"uri": self.offset_uri}
        if self.position_ms is not None:
            body["position_ms"] = self.position_ms
        return body
