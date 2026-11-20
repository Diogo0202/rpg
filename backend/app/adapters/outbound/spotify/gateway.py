"""Implementação de ``SpotifyGateway`` sobre o cliente da Web API e do OAuth do Spotify."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx

from app.adapters.outbound.spotify import web_api
from app.domain.errors import (
    Conflict,
    DomainError,
    Forbidden,
    InvalidInput,
    MalformedRequest,
    NotFound,
    RateLimited,
    ServiceUnavailable,
    UnexpectedUpstreamResponse,
)

Row = dict[str, Any]
NOT_CONFIGURED = "A conexão com o Spotify não está configurada neste servidor."
STORAGE_TIMEOUT_SECONDS = 8
ERROR_BY_STATUS: dict[int, type[DomainError]] = {
    400: MalformedRequest,
    403: Forbidden,
    404: NotFound,
    409: Conflict,
    422: InvalidInput,
    502: UnexpectedUpstreamResponse,
    503: ServiceUnavailable,
}


@contextmanager
def _translated() -> Iterator[None]:
    """``SpotifyError`` já traz a mensagem para a interface; aqui só vira erro de domínio."""
    try:
        yield
    except web_api.SpotifyError as error:
        if error.status == 429:
            retry = str(error.retry_after) if error.retry_after else None
            raise RateLimited(error.detail, retry_after_seconds=retry) from error
        raise ERROR_BY_STATUS.get(error.status, ServiceUnavailable)(error.detail) from error


class SpotifyWebApi:
    def __init__(self) -> None:
        self._settings: web_api.SpotifySettings | None = None

    def is_configured(self) -> bool:
        return web_api.spotify_enabled()

    def ensure_configured(self) -> None:
        try:
            self._settings = web_api.spotify_settings()
        except web_api.SpotifyNotConfigured as error:
            raise ServiceUnavailable(NOT_CONFIGURED) from error

    def disconnected(self) -> Row:
        return web_api.public_connection(None)

    async def connection(self, user_id: str) -> Row:
        with _translated():
            async with httpx.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS) as client:
                row = await web_api.load_connection(client, self._loaded(), user_id)
        return web_api.public_connection(row)

    async def disconnect(self, user_id: str) -> None:
        with _translated():
            async with httpx.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS) as client:
                await web_api.delete_connection(client, self._loaded(), user_id)

    async def authorization_url(self, user_id: str, return_to: str) -> str:
        with _translated():
            return await web_api.start_authorization(self._loaded(), user_id, return_to)

    async def complete_authorization(self, user_id: str, code: str, state: str) -> Row:
        with _translated():
            return await web_api.finish_authorization(self._loaded(), user_id, code, state)

    async def player(self, user_id: str) -> Row:
        body = await self._call(user_id, "GET", "/me/player", params={"additional_types": "track,episode"})
        return web_api.shape_player(body)

    async def devices(self, user_id: str) -> list[Row]:
        return web_api.shape_devices(await self._call(user_id, "GET", "/me/player/devices"))

    async def control(
        self, user_id: str, method: str, path: str, *, params: dict[str, str] | None = None, body: Any = None,
    ) -> None:
        await self._call(user_id, method, path, params=params, json=body)

    async def search_tracks(self, user_id: str, text: str, limit: int, *, forbidden: str) -> list[Row]:
        body = await self._call(user_id, "GET", "/search", params={"q": text, "type": "track", "limit": str(limit)}, forbidden=forbidden)
        tracks = body.get("tracks") if isinstance(body, dict) else None
        return web_api.shape_tracks(tracks.get("items") if isinstance(tracks, dict) else None)

    async def playlists(self, user_id: str, limit: int, offset: int, *, forbidden: str) -> Row:
        body = await self._call(user_id, "GET", "/me/playlists", params={"limit": str(limit), "offset": str(offset)}, forbidden=forbidden)
        items = body.get("items") if isinstance(body, dict) and isinstance(body.get("items"), list) else []
        shaped = [playlist for playlist in (web_api.shape_playlist(item) for item in items) if playlist]
        return {"items": shaped, "total": _total(body) or len(shaped)}

    async def create_playlist(self, user_id: str, body: Row, *, forbidden: str) -> Row:
        created = await self._call(user_id, "POST", "/me/playlists", json=body, forbidden=forbidden)
        playlist = web_api.shape_playlist(created)
        if not playlist:
            raise UnexpectedUpstreamResponse("O Spotify não devolveu a playlist criada.")
        return playlist

    async def update_playlist(self, user_id: str, playlist_id: str, body: Row, *, forbidden: str, not_found: str) -> None:
        await self._call(user_id, "PUT", f"/playlists/{playlist_id}", json=body, forbidden=forbidden, not_found=(404, not_found))

    async def playlist_tracks(self, user_id: str, playlist_id: str, limit: int, offset: int, *, forbidden: str, not_found: str) -> Row:
        body = await self._call(
            user_id, "GET", f"/playlists/{playlist_id}/items",
            params={"limit": str(limit), "offset": str(offset), "additional_types": "track"},
            forbidden=forbidden, not_found=(404, not_found),
        )
        items = body.get("items") if isinstance(body, dict) else None
        shaped = web_api.shape_tracks(items, wrapped=True)
        return {"items": shaped, "total": _total(body) or len(shaped)}

    async def change_tracks(self, user_id: str, playlist_id: str, method: str, body: Row, *, forbidden: str, not_found: str) -> str:
        response = await self._call(
            user_id, method, f"/playlists/{playlist_id}/items", json=body, forbidden=forbidden, not_found=(404, not_found),
        )
        with _translated():
            return web_api.shape_snapshot(response)

    async def _call(self, user_id: str, method: str, path: str, **kwargs: Any) -> Any:
        with _translated():
            return await web_api.player_call(self._loaded(), user_id, method, path, **kwargs)

    def _loaded(self) -> web_api.SpotifySettings:
        if self._settings is None:
            self.ensure_configured()
        if self._settings is None:
            raise ServiceUnavailable(NOT_CONFIGURED)
        return self._settings


def _total(body: Any) -> int:
    return web_api.count(body.get("total")) if isinstance(body, dict) else 0
