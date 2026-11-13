"""Conta Spotify e controle de reprodução do usuário.

``GET /api/v1/spotify/config`` diz se o app Spotify está configurado. ``POST /spotify/authorize``
devolve a URL de consentimento; ``POST /spotify/callback`` recebe ``code`` e ``state`` da página
de callback do frontend, com a sessão do mesmo usuário que pediu. As rotas ``/spotify/player/*``
falam com a Web API em nome dele. Tudo aqui é por usuário: a conexão é da pessoa, não da campanha.
"""

from __future__ import annotations

from typing import Any, NoReturn

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from app.security import AuthenticationError, verify_supabase_user
from app.services import spotify


router = APIRouter(prefix="/api/v1/spotify", tags=["spotify"])

_NOT_CONFIGURED = "A conexão com o Spotify não está configurada neste servidor."


class AuthorizeRequest(BaseModel):
    return_to: str = Field(default="/app", max_length=64)


class CallbackRequest(BaseModel):
    code: str = Field(min_length=1, max_length=1024)
    state: str = Field(min_length=43, max_length=43)


class PlayRequest(BaseModel):
    playlist_id: str | None = Field(default=None, max_length=22)
    device_id: str | None = Field(default=None, max_length=128)
    context_uri: str | None = Field(default=None, max_length=64)
    uris: list[str] | None = Field(default=None, min_length=1, max_length=50)
    offset_uri: str | None = Field(default=None, max_length=64)
    position_ms: int | None = Field(default=None, ge=0, le=86_400_000)

    @field_validator("context_uri")
    @classmethod
    def _context(cls, value: str | None) -> str | None:
        if value is not None and not spotify.CONTEXT_URI.fullmatch(value):
            raise ValueError("contexto inválido")
        return value

    @field_validator("uris")
    @classmethod
    def _uris(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and not all(spotify.TRACK_URI.fullmatch(uri) for uri in value):
            raise ValueError("faixa inválida")
        return value

    @field_validator("offset_uri")
    @classmethod
    def _offset(cls, value: str | None) -> str | None:
        if value is not None and not spotify.TRACK_URI.fullmatch(value):
            raise ValueError("faixa inválida")
        return value


class QueueRequest(BaseModel):
    uri: str = Field(max_length=64)
    device_id: str | None = Field(default=None, max_length=128)

    @field_validator("uri")
    @classmethod
    def _uri(cls, value: str) -> str:
        if not spotify.TRACK_URI.fullmatch(value):
            raise ValueError("faixa inválida")
        return value


class TracksRequest(BaseModel):
    uris: list[str] = Field(min_length=1, max_length=100)

    @field_validator("uris")
    @classmethod
    def _uris(cls, value: list[str]) -> list[str]:
        if not all(spotify.TRACK_URI.fullmatch(uri) for uri in value):
            raise ValueError("faixa inválida")
        return value


class CreatePlaylistRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    public: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("nome vazio")
        return value


class UpdatePlaylistRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _something(self) -> "UpdatePlaylistRequest":
        if self.name is None and self.description is None:
            raise ValueError("informe nome ou descrição")
        if self.name is not None and not self.name.strip():
            raise ValueError("nome vazio")
        return self


_PLAYLIST_FORBIDDEN = "O Spotify não permitiu acessar a playlist. Reconecte a conta para conceder a permissão de playlists."
_PLAYLIST_NOT_FOUND = (404, "Playlist não encontrada no Spotify.")
_SEARCH_FORBIDDEN = "O Spotify não permitiu a busca agora. Reconecte a conta e tente de novo."


class DeviceRequest(BaseModel):
    device_id: str | None = Field(default=None, max_length=128)


class VolumeRequest(BaseModel):
    percent: int = Field(ge=0, le=100)
    device_id: str | None = Field(default=None, max_length=128)


class TransferRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=128)
    play: bool = False


def _settings() -> spotify.SpotifySettings:
    try:
        return spotify.spotify_settings()
    except spotify.SpotifyNotConfigured as error:
        raise HTTPException(status_code=503, detail=_NOT_CONFIGURED) from error


async def _user_id(request: Request, authorization: str) -> str:
    # O middleware já validou a sessão; fora dele (testes do router) valida aqui.
    user = getattr(request.state, "supabase_user", None)
    if not isinstance(user, dict):
        try:
            user = await verify_supabase_user(authorization)
        except AuthenticationError as error:
            raise HTTPException(status_code=error.status, detail="sessão inválida" if error.status == 401 else "autenticação indisponível") from error
    return str(user["id"])


def _raise(error: spotify.SpotifyError) -> NoReturn:
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    raise HTTPException(status_code=error.status, detail=error.detail, headers=headers) from error


def _device_params(device_id: str | None) -> dict[str, str] | None:
    if device_id is None:
        return None
    if not spotify.DEVICE_ID.fullmatch(device_id):
        raise HTTPException(status_code=422, detail="aparelho inválido")
    return {"device_id": device_id}


@router.get("/config")
def spotify_config() -> dict[str, bool]:
    return {"enabled": spotify.spotify_enabled()}


@router.get("/connection")
async def get_connection(request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    if not spotify.spotify_enabled():
        return {"enabled": False, **spotify.public_connection(None)}
    settings = _settings()
    user_id = await _user_id(request, authorization)
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            row = await spotify.load_connection(client, settings, user_id)
    except spotify.SpotifyError as error:
        _raise(error)
    return {"enabled": True, **spotify.public_connection(row)}


@router.delete("/connection", status_code=204)
async def delete_connection(request: Request, authorization: str = Header(default="")) -> Response:
    settings = _settings()
    user_id = await _user_id(request, authorization)
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await spotify.delete_connection(client, settings, user_id)
    except spotify.SpotifyError as error:
        _raise(error)
    return Response(status_code=204)


@router.post("/authorize")
async def authorize(payload: AuthorizeRequest, request: Request, authorization: str = Header(default="")) -> dict[str, str]:
    settings = _settings()
    user_id = await _user_id(request, authorization)
    try:
        url = await spotify.start_authorization(settings, user_id, payload.return_to)
    except spotify.SpotifyError as error:
        _raise(error)
    return {"url": url}


@router.post("/callback")
async def callback(payload: CallbackRequest, request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    settings = _settings()
    user_id = await _user_id(request, authorization)
    try:
        return await spotify.finish_authorization(settings, user_id, payload.code, payload.state)
    except spotify.SpotifyError as error:
        _raise(error)


@router.get("/player")
async def player(request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    settings = _settings()
    user_id = await _user_id(request, authorization)
    try:
        body = await spotify.player_call(settings, user_id, "GET", "/me/player", params={"additional_types": "track,episode"})
    except spotify.SpotifyError as error:
        _raise(error)
    return spotify.shape_player(body)


@router.get("/devices")
async def devices(request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    settings = _settings()
    user_id = await _user_id(request, authorization)
    try:
        body = await spotify.player_call(settings, user_id, "GET", "/me/player/devices")
    except spotify.SpotifyError as error:
        _raise(error)
    return {"devices": spotify.shape_devices(body)}


@router.post("/player/play", status_code=204)
async def play(payload: PlayRequest, request: Request, authorization: str = Header(default="")) -> Response:
    settings = _settings()
    params = _device_params(payload.device_id)
    body: dict[str, Any] | None = None
    context_uri = payload.context_uri
    if payload.playlist_id is not None:
        if not spotify.PLAYLIST_ID.fullmatch(payload.playlist_id):
            raise HTTPException(status_code=422, detail="playlist inválida")
        if context_uri is not None:
            raise HTTPException(status_code=422, detail="informe playlist_id ou context_uri, não os dois")
        context_uri = f"spotify:playlist:{payload.playlist_id}"
    if context_uri is not None and payload.uris is not None:
        raise HTTPException(status_code=422, detail="informe context_uri ou uris, não os dois")
    if payload.offset_uri is not None and context_uri is None and payload.uris is None:
        raise HTTPException(status_code=422, detail="offset_uri exige context_uri ou uris")
    if context_uri is not None or payload.uris is not None or payload.position_ms is not None:
        body = {}
        if context_uri is not None:
            body["context_uri"] = context_uri
        if payload.uris is not None:
            body["uris"] = payload.uris
        if payload.offset_uri is not None:
            body["offset"] = {"uri": payload.offset_uri}
        if payload.position_ms is not None:
            body["position_ms"] = payload.position_ms
    user_id = await _user_id(request, authorization)
    try:
        await spotify.player_call(settings, user_id, "PUT", "/me/player/play", params=params, json=body)
    except spotify.SpotifyError as error:
        _raise(error)
    return Response(status_code=204)


@router.post("/player/pause", status_code=204)
async def pause(payload: DeviceRequest, request: Request, authorization: str = Header(default="")) -> Response:
    settings = _settings()
    params = _device_params(payload.device_id)
    user_id = await _user_id(request, authorization)
    try:
        await spotify.player_call(settings, user_id, "PUT", "/me/player/pause", params=params)
    except spotify.SpotifyError as error:
        _raise(error)
    return Response(status_code=204)


async def _skip(direction: str, payload: DeviceRequest, request: Request, authorization: str) -> Response:
    settings = _settings()
    params = _device_params(payload.device_id)
    user_id = await _user_id(request, authorization)
    try:
        await spotify.player_call(settings, user_id, "POST", f"/me/player/{direction}", params=params)
    except spotify.SpotifyError as error:
        _raise(error)
    return Response(status_code=204)


@router.post("/player/next", status_code=204)
async def next_track(payload: DeviceRequest, request: Request, authorization: str = Header(default="")) -> Response:
    return await _skip("next", payload, request, authorization)


@router.post("/player/previous", status_code=204)
async def previous_track(payload: DeviceRequest, request: Request, authorization: str = Header(default="")) -> Response:
    return await _skip("previous", payload, request, authorization)


@router.post("/player/volume", status_code=204)
async def volume(payload: VolumeRequest, request: Request, authorization: str = Header(default="")) -> Response:
    settings = _settings()
    params = {"volume_percent": str(payload.percent), **(_device_params(payload.device_id) or {})}
    user_id = await _user_id(request, authorization)
    try:
        await spotify.player_call(settings, user_id, "PUT", "/me/player/volume", params=params)
    except spotify.SpotifyError as error:
        _raise(error)
    return Response(status_code=204)


@router.post("/player/transfer", status_code=204)
async def transfer(payload: TransferRequest, request: Request, authorization: str = Header(default="")) -> Response:
    settings = _settings()
    if not spotify.DEVICE_ID.fullmatch(payload.device_id):
        raise HTTPException(status_code=422, detail="aparelho inválido")
    user_id = await _user_id(request, authorization)
    try:
        await spotify.player_call(settings, user_id, "PUT", "/me/player", json={"device_ids": [payload.device_id], "play": payload.play})
    except spotify.SpotifyError as error:
        _raise(error)
    return Response(status_code=204)


@router.post("/player/queue")
async def queue_track(payload: QueueRequest, request: Request, authorization: str = Header(default="")) -> dict[str, bool]:
    settings = _settings()
    params = {"uri": payload.uri, **(_device_params(payload.device_id) or {})}
    user_id = await _user_id(request, authorization)
    try:
        await spotify.player_call(settings, user_id, "POST", "/me/player/queue", params=params)
    except spotify.SpotifyError as error:
        _raise(error)
    return {"ok": True}


@router.get("/search")
async def search(request: Request, q: str = Query(min_length=1, max_length=200), limit: int = Query(default=10, ge=1, le=20),
                 authorization: str = Header(default="")) -> dict[str, Any]:
    settings = _settings()
    if not q.strip():
        raise HTTPException(status_code=422, detail="busca vazia")
    user_id = await _user_id(request, authorization)
    try:
        body = await spotify.player_call(settings, user_id, "GET", "/search",
                                         params={"q": q.strip(), "type": "track", "limit": str(limit)},
                                         forbidden=_SEARCH_FORBIDDEN)
    except spotify.SpotifyError as error:
        _raise(error)
    tracks = body.get("tracks") if isinstance(body, dict) else None
    return {"tracks": spotify.shape_tracks(tracks.get("items") if isinstance(tracks, dict) else None)}


def _playlist_id(value: str) -> str:
    if not spotify.PLAYLIST_ID.fullmatch(value):
        raise HTTPException(status_code=422, detail="playlist inválida")
    return value


@router.get("/playlists")
async def list_playlists(request: Request, limit: int = Query(default=50, ge=1, le=50), offset: int = Query(default=0, ge=0, le=100_000),
                         authorization: str = Header(default="")) -> dict[str, Any]:
    settings = _settings()
    user_id = await _user_id(request, authorization)
    try:
        body = await spotify.player_call(settings, user_id, "GET", "/me/playlists",
                                         params={"limit": str(limit), "offset": str(offset)}, forbidden=_PLAYLIST_FORBIDDEN)
    except spotify.SpotifyError as error:
        _raise(error)
    items = body.get("items") if isinstance(body, dict) and isinstance(body.get("items"), list) else []
    shaped = [playlist for playlist in (spotify.shape_playlist(item) for item in items) if playlist]
    total = body.get("total") if isinstance(body, dict) else None
    return {"items": shaped, "total": spotify._count(total) or len(shaped)}


@router.post("/playlists")
async def create_playlist(payload: CreatePlaylistRequest, request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    settings = _settings()
    body: dict[str, Any] = {"name": payload.name.strip(), "public": payload.public}
    if payload.description is not None:
        body["description"] = payload.description
    user_id = await _user_id(request, authorization)
    try:
        created = await spotify.player_call(settings, user_id, "POST", "/me/playlists", json=body, forbidden=_PLAYLIST_FORBIDDEN)
    except spotify.SpotifyError as error:
        _raise(error)
    playlist = spotify.shape_playlist(created)
    if not playlist:
        raise HTTPException(status_code=502, detail="O Spotify não devolveu a playlist criada.")
    return playlist


@router.patch("/playlists/{playlist_id}")
async def update_playlist(playlist_id: str, payload: UpdatePlaylistRequest, request: Request,
                          authorization: str = Header(default="")) -> dict[str, bool]:
    settings = _settings()
    _playlist_id(playlist_id)
    body = payload.model_dump(exclude_none=True)
    if "name" in body:
        body["name"] = body["name"].strip()
    user_id = await _user_id(request, authorization)
    try:
        await spotify.player_call(settings, user_id, "PUT", f"/playlists/{playlist_id}", json=body,
                                  forbidden=_PLAYLIST_FORBIDDEN, not_found=_PLAYLIST_NOT_FOUND)
    except spotify.SpotifyError as error:
        _raise(error)
    return {"ok": True}


@router.get("/playlists/{playlist_id}/tracks")
async def playlist_tracks(playlist_id: str, request: Request, limit: int = Query(default=100, ge=1, le=100),
                          offset: int = Query(default=0, ge=0, le=100_000), authorization: str = Header(default="")) -> dict[str, Any]:
    settings = _settings()
    _playlist_id(playlist_id)
    user_id = await _user_id(request, authorization)
    try:
        body = await spotify.player_call(settings, user_id, "GET", f"/playlists/{playlist_id}/items",
                                         params={"limit": str(limit), "offset": str(offset), "additional_types": "track"},
                                         forbidden=_PLAYLIST_FORBIDDEN, not_found=_PLAYLIST_NOT_FOUND)
    except spotify.SpotifyError as error:
        _raise(error)
    items = body.get("items") if isinstance(body, dict) else None
    shaped = spotify.shape_tracks(items, wrapped=True)
    total = body.get("total") if isinstance(body, dict) else None
    return {"items": shaped, "total": spotify._count(total) or len(shaped)}


@router.post("/playlists/{playlist_id}/tracks")
async def add_playlist_tracks(playlist_id: str, payload: TracksRequest, request: Request,
                              authorization: str = Header(default="")) -> dict[str, str]:
    settings = _settings()
    _playlist_id(playlist_id)
    user_id = await _user_id(request, authorization)
    try:
        body = await spotify.player_call(settings, user_id, "POST", f"/playlists/{playlist_id}/items",
                                         json={"uris": payload.uris}, forbidden=_PLAYLIST_FORBIDDEN, not_found=_PLAYLIST_NOT_FOUND)
        return {"snapshot_id": spotify.shape_snapshot(body)}
    except spotify.SpotifyError as error:
        _raise(error)


@router.delete("/playlists/{playlist_id}/tracks")
async def remove_playlist_tracks(playlist_id: str, payload: TracksRequest, request: Request,
                                 authorization: str = Header(default="")) -> dict[str, str]:
    settings = _settings()
    _playlist_id(playlist_id)
    user_id = await _user_id(request, authorization)
    try:
        body = await spotify.player_call(settings, user_id, "DELETE", f"/playlists/{playlist_id}/items",
                                         json={"items": [{"uri": uri} for uri in payload.uris]},
                                         forbidden=_PLAYLIST_FORBIDDEN, not_found=_PLAYLIST_NOT_FOUND)
        return {"snapshot_id": spotify.shape_snapshot(body)}
    except spotify.SpotifyError as error:
        _raise(error)
