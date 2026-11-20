"""Conta Spotify e controle de reprodução do usuário.

Tudo aqui é por usuário: a conexão é da pessoa, não da campanha. A configuração é conferida
antes da sessão e da validação de cada pedido, como a interface espera.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.application.identity import CurrentUser
from app.domain.errors import InvalidInput
from app.domain.spotify import DEVICE_ID, PlayCommand, checked_playlist_id, device_params

Row = dict[str, Any]
PLAYLIST_FORBIDDEN = "O Spotify não permitiu acessar a playlist. Reconecte a conta para conceder a permissão de playlists."
PLAYLIST_NOT_FOUND = "Playlist não encontrada no Spotify."
SEARCH_FORBIDDEN = "O Spotify não permitiu a busca agora. Reconecte a conta e tente de novo."


class SpotifyGateway(Protocol):
    def is_configured(self) -> bool: ...

    def ensure_configured(self) -> None:
        """Levanta ``ServiceUnavailable`` quando faltam credenciais do app ou a chave de serviço."""

    def disconnected(self) -> Row: ...

    async def connection(self, user_id: str) -> Row: ...

    async def disconnect(self, user_id: str) -> None: ...

    async def authorization_url(self, user_id: str, return_to: str) -> str: ...

    async def complete_authorization(self, user_id: str, code: str, state: str) -> Row: ...

    async def player(self, user_id: str) -> Row: ...

    async def devices(self, user_id: str) -> list[Row]: ...

    async def control(
        self, user_id: str, method: str, path: str, *, params: dict[str, str] | None = None, body: Any = None,
    ) -> None:
        """Comando sem resposta útil (tocar, pausar, pular, volume, fila, transferir)."""

    async def search_tracks(self, user_id: str, text: str, limit: int, *, forbidden: str) -> list[Row]: ...

    async def playlists(self, user_id: str, limit: int, offset: int, *, forbidden: str) -> Row: ...

    async def create_playlist(self, user_id: str, body: Row, *, forbidden: str) -> Row: ...

    async def update_playlist(self, user_id: str, playlist_id: str, body: Row, *, forbidden: str, not_found: str) -> None: ...

    async def playlist_tracks(self, user_id: str, playlist_id: str, limit: int, offset: int, *, forbidden: str, not_found: str) -> Row: ...

    async def change_tracks(
        self, user_id: str, playlist_id: str, method: str, body: Row, *, forbidden: str, not_found: str,
    ) -> str:
        """Acrescenta (POST) ou remove (DELETE) faixas e devolve o ``snapshot_id`` novo."""


class SpotifyService:
    def __init__(self, identity: CurrentUser, spotify: SpotifyGateway) -> None:
        self._identity = identity
        self._spotify = spotify

    def config(self) -> dict[str, bool]:
        return {"enabled": self._spotify.is_configured()}

    # Conexão ---------------------------------------------------------------------------

    async def connection(self) -> Row:
        if not self._spotify.is_configured():
            return {"enabled": False, **self._spotify.disconnected()}
        user_id = await self._configured_user()
        return {"enabled": True, **await self._spotify.connection(user_id)}

    async def disconnect(self) -> None:
        await self._spotify.disconnect(await self._configured_user())

    async def authorization_url(self, return_to: str) -> Row:
        user_id = await self._configured_user()
        return {"url": await self._spotify.authorization_url(user_id, return_to)}

    async def complete_authorization(self, code: str, state: str) -> Row:
        user_id = await self._configured_user()
        return await self._spotify.complete_authorization(user_id, code, state)

    # Reprodução ------------------------------------------------------------------------

    async def player(self) -> Row:
        return await self._spotify.player(await self._configured_user())

    async def devices(self) -> Row:
        return {"devices": await self._spotify.devices(await self._configured_user())}

    async def play(self, device_id: str | None, command: PlayCommand) -> None:
        self._spotify.ensure_configured()
        params = device_params(device_id)
        body = command.body()
        user_id = await self._identity.current_user_id()
        await self._spotify.control(user_id, "PUT", "/me/player/play", params=params, body=body)

    async def pause(self, device_id: str | None) -> None:
        await self._device_command("PUT", "/me/player/pause", device_id)

    async def skip(self, direction: str, device_id: str | None) -> None:
        await self._device_command("POST", f"/me/player/{direction}", device_id)

    async def set_volume(self, percent: int, device_id: str | None) -> None:
        self._spotify.ensure_configured()
        params = {"volume_percent": str(percent), **(device_params(device_id) or {})}
        user_id = await self._identity.current_user_id()
        await self._spotify.control(user_id, "PUT", "/me/player/volume", params=params)

    async def transfer(self, device_id: str, play: bool) -> None:
        self._spotify.ensure_configured()
        if not DEVICE_ID.fullmatch(device_id):
            raise InvalidInput("aparelho inválido")
        user_id = await self._identity.current_user_id()
        await self._spotify.control(user_id, "PUT", "/me/player", body={"device_ids": [device_id], "play": play})

    async def queue(self, uri: str, device_id: str | None) -> Row:
        self._spotify.ensure_configured()
        params = {"uri": uri, **(device_params(device_id) or {})}
        user_id = await self._identity.current_user_id()
        await self._spotify.control(user_id, "POST", "/me/player/queue", params=params)
        return {"ok": True}

    # Busca e playlists -------------------------------------------------------------------

    async def search(self, text: str, limit: int) -> Row:
        self._spotify.ensure_configured()
        if not text.strip():
            raise InvalidInput("busca vazia")
        user_id = await self._identity.current_user_id()
        return {"tracks": await self._spotify.search_tracks(user_id, text.strip(), limit, forbidden=SEARCH_FORBIDDEN)}

    async def playlists(self, limit: int, offset: int) -> Row:
        user_id = await self._configured_user()
        return await self._spotify.playlists(user_id, limit, offset, forbidden=PLAYLIST_FORBIDDEN)

    async def create_playlist(self, name: str, description: str | None, public: bool) -> Row:
        self._spotify.ensure_configured()
        body: Row = {"name": name.strip(), "public": public}
        if description is not None:
            body["description"] = description
        user_id = await self._identity.current_user_id()
        return await self._spotify.create_playlist(user_id, body, forbidden=PLAYLIST_FORBIDDEN)

    async def update_playlist(self, playlist_id: str, changes: Row) -> Row:
        user_id = await self._playlist_user(playlist_id)
        body = dict(changes)
        if "name" in body:
            body["name"] = body["name"].strip()
        await self._spotify.update_playlist(
            user_id, playlist_id, body, forbidden=PLAYLIST_FORBIDDEN, not_found=PLAYLIST_NOT_FOUND,
        )
        return {"ok": True}

    async def playlist_tracks(self, playlist_id: str, limit: int, offset: int) -> Row:
        user_id = await self._playlist_user(playlist_id)
        return await self._spotify.playlist_tracks(
            user_id, playlist_id, limit, offset, forbidden=PLAYLIST_FORBIDDEN, not_found=PLAYLIST_NOT_FOUND,
        )

    async def add_tracks(self, playlist_id: str, uris: list[str]) -> Row:
        user_id = await self._playlist_user(playlist_id)
        snapshot = await self._spotify.change_tracks(
            user_id, playlist_id, "POST", {"uris": uris}, forbidden=PLAYLIST_FORBIDDEN, not_found=PLAYLIST_NOT_FOUND,
        )
        return {"snapshot_id": snapshot}

    async def remove_tracks(self, playlist_id: str, uris: list[str]) -> Row:
        user_id = await self._playlist_user(playlist_id)
        snapshot = await self._spotify.change_tracks(
            user_id, playlist_id, "DELETE", {"items": [{"uri": uri} for uri in uris]},
            forbidden=PLAYLIST_FORBIDDEN, not_found=PLAYLIST_NOT_FOUND,
        )
        return {"snapshot_id": snapshot}

    # Apoio --------------------------------------------------------------------------------

    async def _configured_user(self) -> str:
        self._spotify.ensure_configured()
        return await self._identity.current_user_id()

    async def _playlist_user(self, playlist_id: str) -> str:
        self._spotify.ensure_configured()
        checked_playlist_id(playlist_id)
        return await self._identity.current_user_id()

    async def _device_command(self, method: str, path: str, device_id: str | None) -> None:
        self._spotify.ensure_configured()
        params = device_params(device_id)
        user_id = await self._identity.current_user_id()
        await self._spotify.control(user_id, method, path, params=params)
