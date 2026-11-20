"""Adaptador HTTP da conta Spotify e do controle de reprodução.

``POST /spotify/authorize`` devolve a URL de consentimento; ``POST /spotify/callback`` recebe
``code`` e ``state`` da página de callback do frontend, com a sessão de quem pediu.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from app.adapters.inbound.http.errors import DomainErrorRoute
from app.adapters.outbound.spotify.gateway import SpotifyWebApi
from app.application.spotify.service import SpotifyService
from app.domain.errors import ServiceUnavailable, Unauthenticated
from app.domain.spotify import CONTEXT_URI, TRACK_URI, PlayCommand
from app.security import AuthenticationError, verify_supabase_user

router = APIRouter(prefix="/api/v1/spotify", tags=["spotify"], route_class=DomainErrorRoute)


class VerifiedSession:
    """Usuário que o ``ApiSecurityMiddleware`` já validou; fora dele (testes do router) valida aqui."""

    def __init__(self, request: Request, authorization: str) -> None:
        self._request = request
        self._authorization = authorization

    async def current_user_id(self) -> str:
        user = getattr(self._request.state, "supabase_user", None)
        if not isinstance(user, dict):
            try:
                user = await verify_supabase_user(self._authorization)
            except AuthenticationError as error:
                if error.status == 401:
                    raise Unauthenticated("sessão inválida") from error
                raise ServiceUnavailable("autenticação indisponível") from error
        return str(user["id"])


def spotify_service(request: Request, authorization: str = Header(default="")) -> SpotifyService:
    return SpotifyService(VerifiedSession(request, authorization), SpotifyWebApi())


Spotify = Depends(spotify_service)


def _tracks(value: list[str] | None) -> list[str] | None:
    if value is not None and not all(TRACK_URI.fullmatch(uri) for uri in value):
        raise ValueError("faixa inválida")
    return value


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
        if value is not None and not CONTEXT_URI.fullmatch(value):
            raise ValueError("contexto inválido")
        return value

    @field_validator("uris")
    @classmethod
    def _uris(cls, value: list[str] | None) -> list[str] | None:
        return _tracks(value)

    @field_validator("offset_uri")
    @classmethod
    def _offset(cls, value: str | None) -> str | None:
        _tracks([value] if value is not None else None)
        return value

    def command(self) -> PlayCommand:
        return PlayCommand(self.playlist_id, self.context_uri, self.uris, self.offset_uri, self.position_ms)


class QueueRequest(BaseModel):
    uri: str = Field(max_length=64)
    device_id: str | None = Field(default=None, max_length=128)

    @field_validator("uri")
    @classmethod
    def _uri(cls, value: str) -> str:
        _tracks([value])
        return value


class TracksRequest(BaseModel):
    uris: list[str] = Field(min_length=1, max_length=100)

    @field_validator("uris")
    @classmethod
    def _uris(cls, value: list[str]) -> list[str]:
        _tracks(value)
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
    def _something(self) -> UpdatePlaylistRequest:
        if self.name is None and self.description is None:
            raise ValueError("informe nome ou descrição")
        if self.name is not None and not self.name.strip():
            raise ValueError("nome vazio")
        return self


class DeviceRequest(BaseModel):
    device_id: str | None = Field(default=None, max_length=128)


class VolumeRequest(BaseModel):
    percent: int = Field(ge=0, le=100)
    device_id: str | None = Field(default=None, max_length=128)


class TransferRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=128)
    play: bool = False


# Conexão ------------------------------------------------------------------------------------


@router.get("/config")
def spotify_config(service: SpotifyService = Spotify) -> dict[str, bool]:
    return service.config()


@router.get("/connection")
async def get_connection(service: SpotifyService = Spotify) -> dict[str, Any]:
    return await service.connection()


@router.delete("/connection", status_code=204)
async def delete_connection(service: SpotifyService = Spotify) -> Response:
    await service.disconnect()
    return Response(status_code=204)


@router.post("/authorize")
async def authorize(payload: AuthorizeRequest, service: SpotifyService = Spotify) -> dict[str, str]:
    return await service.authorization_url(payload.return_to)


@router.post("/callback")
async def callback(payload: CallbackRequest, service: SpotifyService = Spotify) -> dict[str, Any]:
    return await service.complete_authorization(payload.code, payload.state)


# Reprodução ------------------------------------------------------------------------------------


@router.get("/player")
async def player(service: SpotifyService = Spotify) -> dict[str, Any]:
    return await service.player()


@router.get("/devices")
async def devices(service: SpotifyService = Spotify) -> dict[str, Any]:
    return await service.devices()


@router.post("/player/play", status_code=204)
async def play(payload: PlayRequest, service: SpotifyService = Spotify) -> Response:
    await service.play(payload.device_id, payload.command())
    return Response(status_code=204)


@router.post("/player/pause", status_code=204)
async def pause(payload: DeviceRequest, service: SpotifyService = Spotify) -> Response:
    await service.pause(payload.device_id)
    return Response(status_code=204)


@router.post("/player/next", status_code=204)
async def next_track(payload: DeviceRequest, service: SpotifyService = Spotify) -> Response:
    await service.skip("next", payload.device_id)
    return Response(status_code=204)


@router.post("/player/previous", status_code=204)
async def previous_track(payload: DeviceRequest, service: SpotifyService = Spotify) -> Response:
    await service.skip("previous", payload.device_id)
    return Response(status_code=204)


@router.post("/player/volume", status_code=204)
async def volume(payload: VolumeRequest, service: SpotifyService = Spotify) -> Response:
    await service.set_volume(payload.percent, payload.device_id)
    return Response(status_code=204)


@router.post("/player/transfer", status_code=204)
async def transfer(payload: TransferRequest, service: SpotifyService = Spotify) -> Response:
    await service.transfer(payload.device_id, payload.play)
    return Response(status_code=204)


@router.post("/player/queue")
async def queue_track(payload: QueueRequest, service: SpotifyService = Spotify) -> dict[str, bool]:
    return await service.queue(payload.uri, payload.device_id)


# Busca e playlists ---------------------------------------------------------------------------------


@router.get("/search")
async def search(
    q: str = Query(min_length=1, max_length=200), limit: int = Query(default=10, ge=1, le=20), service: SpotifyService = Spotify,
) -> dict[str, Any]:
    return await service.search(q, limit)


@router.get("/playlists")
async def list_playlists(
    limit: int = Query(default=50, ge=1, le=50), offset: int = Query(default=0, ge=0, le=100_000), service: SpotifyService = Spotify,
) -> dict[str, Any]:
    return await service.playlists(limit, offset)


@router.post("/playlists")
async def create_playlist(payload: CreatePlaylistRequest, service: SpotifyService = Spotify) -> dict[str, Any]:
    return await service.create_playlist(payload.name, payload.description, payload.public)


@router.patch("/playlists/{playlist_id}")
async def update_playlist(playlist_id: str, payload: UpdatePlaylistRequest, service: SpotifyService = Spotify) -> dict[str, bool]:
    return await service.update_playlist(playlist_id, payload.model_dump(exclude_none=True))


@router.get("/playlists/{playlist_id}/tracks")
async def playlist_tracks(
    playlist_id: str,
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    service: SpotifyService = Spotify,
) -> dict[str, Any]:
    return await service.playlist_tracks(playlist_id, limit, offset)


@router.post("/playlists/{playlist_id}/tracks")
async def add_playlist_tracks(playlist_id: str, payload: TracksRequest, service: SpotifyService = Spotify) -> dict[str, str]:
    return await service.add_tracks(playlist_id, payload.uris)


@router.delete("/playlists/{playlist_id}/tracks")
async def remove_playlist_tracks(playlist_id: str, payload: TracksRequest, service: SpotifyService = Spotify) -> dict[str, str]:
    return await service.remove_tracks(playlist_id, payload.uris)
