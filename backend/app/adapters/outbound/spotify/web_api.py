"""Conta Spotify do usuário: OAuth (Authorization Code com client secret) e controle de reprodução.

Fluxo: ``start_authorization`` grava o hash de um state aleatório em ``spotify_oauth_states`` e
devolve a URL de consentimento do Spotify. O Spotify volta para a página de callback do frontend,
que envia ``code`` e ``state`` à API com a sessão do usuário; ``finish_authorization`` consome o
state só se ele pertencer a esse usuário e ainda valer, troca o código por tokens e grava a conexão.

Os tokens ficam em ``spotify_connections``, que só a chave de serviço lê. Eles nunca entram em
logs, mensagens de erro ou respostas. O controle da reprodução (Web API ``/me/player``) exige
Spotify Premium; o Spotify responde 403 ``PREMIUM_REQUIRED`` para contas Free.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.domain.spotify import CONTEXT_URI, DEVICE_ID, PLAYLIST_ID, TRACK_URI

logger = logging.getLogger(__name__)

ACCOUNTS = "https://accounts.spotify.com"
API = "https://api.spotify.com/v1"
SCOPES = (
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-modify-private",
    "playlist-modify-public",
)
STATE_TTL_SECONDS = 600
REFRESH_MARGIN_SECONDS = 60

RETURN_TO = re.compile(r"^/app(/campaign/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$")
STATE = re.compile(r"^[A-Za-z0-9_-]{43}$")
CODE = re.compile(r"^[A-Za-z0-9._~-]{1,1024}$")
_SPOTIFY_USER = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_PRODUCT = re.compile(r"^[a-z_]{1,32}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

RECONNECT = "A conexão com o Spotify expirou ou foi revogada. Conecte a conta de novo."
NOT_CONNECTED = "Conecte sua conta Spotify para controlar a reprodução."


class SpotifyNotConfigured(Exception):
    """Faltam as credenciais do app Spotify ou a chave de serviço do Supabase."""


class SpotifyError(Exception):
    """Falha já traduzida para a interface, sem segredos."""

    def __init__(self, status: int, detail: str, *, retry_after: int | None = None, reconnect: bool = False):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.retry_after = retry_after
        self.reconnect = reconnect


@dataclass(frozen=True)
class SpotifySettings:
    client_id: str
    redirect_uri: str
    supabase_url: str
    client_secret: str = field(repr=False)
    service_key: str = field(repr=False)


def spotify_settings() -> SpotifySettings:
    client_id = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "").strip()
    app_base = os.getenv("APP_BASE_URL", "").strip().rstrip("/")
    redirect_uri = os.getenv("SPOTIFY_REDIRECT_URI", "").strip() or (f"{app_base}/app/spotify/callback" if app_base else "")
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not client_id or not client_secret or not redirect_uri or not url or not service_key:
        raise SpotifyNotConfigured()
    if not re.fullmatch(r"[0-9a-fA-F]{32}", client_id) or _CONTROL.search(client_secret):
        raise SpotifyNotConfigured()
    local = redirect_uri.startswith(("http://127.0.0.1:", "http://localhost:", "http://[::1]:"))
    if not (redirect_uri.startswith("https://") or local) or not redirect_uri.endswith("/app/spotify/callback"):
        raise SpotifyNotConfigured()
    return SpotifySettings(
        client_id=client_id, redirect_uri=redirect_uri, supabase_url=url,
        client_secret=client_secret, service_key=service_key,
    )


def spotify_enabled() -> bool:
    try:
        spotify_settings()
    except SpotifyNotConfigured:
        return False
    return True


def hash_state(state: str) -> str:
    return hashlib.sha256(state.encode("ascii")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", _CONTROL.sub(" ", value)).strip()[:limit]
    return cleaned or None


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# Supabase (chave de serviço)

def _service_headers(settings: SpotifySettings, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": settings.service_key,
        "Authorization": f"Bearer {settings.service_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


async def _rest(client: httpx.AsyncClient, settings: SpotifySettings, method: str, table: str, *,
                params: dict[str, str] | None = None, json: Any = None, prefer: str | None = None) -> Any:
    try:
        response = await client.request(
            method, f"{settings.supabase_url}/rest/v1/{table}", params=params, json=json,
            headers=_service_headers(settings, prefer),
        )
    except httpx.HTTPError as error:
        logger.warning("spotify storage failed table=%s reason=%s", table, type(error).__name__)
        raise SpotifyError(503, "Não foi possível guardar a conexão agora; tente de novo.") from error
    if response.status_code >= 400:
        logger.warning("spotify storage failed table=%s status=%s", table, response.status_code)
        raise SpotifyError(503, "Não foi possível guardar a conexão agora; tente de novo.")
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError as error:
        raise SpotifyError(503, "Resposta inválida do Supabase.") from error


async def load_connection(client: httpx.AsyncClient, settings: SpotifySettings, user_id: str) -> dict[str, Any] | None:
    rows = await _rest(client, settings, "GET", "spotify_connections", params={"user_id": f"eq.{user_id}", "select": "*"})
    return rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None


async def delete_connection(client: httpx.AsyncClient, settings: SpotifySettings, user_id: str) -> None:
    await _rest(client, settings, "DELETE", "spotify_connections", params={"user_id": f"eq.{user_id}"}, prefer="return=minimal")


def public_connection(row: dict[str, Any] | None) -> dict[str, Any]:
    """O que a interface pode saber da conexão: nunca os tokens."""
    if not row:
        return {"connected": False, "display_name": None, "product": None, "premium": False, "connected_at": None,
                "scopes": [], "needs_reconnect": False}
    product = row.get("product") if isinstance(row.get("product"), str) else None
    raw_scopes = row.get("scopes") if isinstance(row.get("scopes"), str) else ""
    scopes = [scope for scope in raw_scopes.split() if re.fullmatch(r"[a-z-]{1,64}", scope)][:32]
    return {
        "connected": True,
        "display_name": _text(row.get("display_name"), 120),
        "product": product,
        "premium": product == "premium",
        "connected_at": row.get("created_at"),
        "scopes": scopes,
        "needs_reconnect": not set(SCOPES).issubset(scopes),
    }


# OAuth

async def start_authorization(settings: SpotifySettings, user_id: str, return_to: str) -> str:
    if not RETURN_TO.fullmatch(return_to):
        raise SpotifyError(422, "Destino de retorno inválido.")
    state = secrets.token_urlsafe(32)
    now = _now()
    async with httpx.AsyncClient(timeout=8) as client:
        # Pedidos vencidos do mesmo usuário saem antes de entrar o novo.
        await _rest(client, settings, "DELETE", "spotify_oauth_states",
                    params={"user_id": f"eq.{user_id}", "expires_at": f"lt.{now.isoformat()}"}, prefer="return=minimal")
        await _rest(client, settings, "POST", "spotify_oauth_states", prefer="return=minimal", json={
            "state_hash": hash_state(state), "user_id": user_id, "return_to": return_to,
            "expires_at": (now + timedelta(seconds=STATE_TTL_SECONDS)).isoformat(), "created_at": now.isoformat(),
        })
    query = urlencode({
        "client_id": settings.client_id,
        "response_type": "code",
        "redirect_uri": settings.redirect_uri,
        "scope": " ".join(SCOPES),
        "state": state,
        "show_dialog": "true",
    })
    return f"{ACCOUNTS}/authorize?{query}"


async def _token_request(client: httpx.AsyncClient, settings: SpotifySettings, data: dict[str, str]) -> dict[str, Any]:
    try:
        response = await client.post(
            f"{ACCOUNTS}/api/token", data=data, auth=(settings.client_id, settings.client_secret),
            headers={"Accept": "application/json"},
        )
    except httpx.HTTPError as error:
        raise SpotifyError(503, "O Spotify não respondeu; tente de novo em instantes.") from error
    if response.status_code in (400, 401):
        raise SpotifyError(400, "O Spotify recusou a autorização. Conecte a conta de novo.", reconnect=True)
    if response.status_code >= 400:
        raise SpotifyError(503, f"O Spotify está indisponível ({response.status_code}).")
    try:
        body = response.json()
    except ValueError as error:
        raise SpotifyError(503, "Resposta inválida do Spotify.") from error
    access = body.get("access_token") if isinstance(body, dict) else None
    if not isinstance(access, str) or not 0 < len(access) <= 2048:
        raise SpotifyError(503, "O Spotify não devolveu um token válido.")
    refresh = body.get("refresh_token")
    if refresh is not None and (not isinstance(refresh, str) or not 0 < len(refresh) <= 2048):
        raise SpotifyError(503, "O Spotify não devolveu um token válido.")
    expires_in = body.get("expires_in")
    if not isinstance(expires_in, int) or isinstance(expires_in, bool) or not 60 <= expires_in <= 86400:
        expires_in = 3600
    scope = body.get("scope") if isinstance(body.get("scope"), str) else ""
    return {"access_token": access, "refresh_token": refresh, "expires_in": expires_in, "scope": scope[:512]}


async def finish_authorization(settings: SpotifySettings, user_id: str, code: str, state: str) -> dict[str, Any]:
    if not STATE.fullmatch(state) or not CODE.fullmatch(code):
        raise SpotifyError(400, "Pedido de conexão inválido. Conecte a conta de novo.")
    async with httpx.AsyncClient(timeout=10) as client:
        # Consome o state de uma vez: só o mesmo usuário, só uma vez.
        rows = await _rest(client, settings, "DELETE", "spotify_oauth_states",
                           params={"state_hash": f"eq.{hash_state(state)}", "user_id": f"eq.{user_id}"},
                           prefer="return=representation")
        row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
        expires_at = _parse_time(row.get("expires_at")) if row else None
        return_to = row.get("return_to") if row else None
        if not row or expires_at is None or expires_at <= _now() or not isinstance(return_to, str) or not RETURN_TO.fullmatch(return_to):
            raise SpotifyError(400, "O pedido de conexão expirou. Conecte a conta de novo.")

        tokens = await _token_request(client, settings, {
            "grant_type": "authorization_code", "code": code, "redirect_uri": settings.redirect_uri,
        })
        if not tokens["refresh_token"]:
            raise SpotifyError(503, "O Spotify não devolveu um token válido.")
        profile = await spotify_request(client, tokens["access_token"], "GET", "/me")
        spotify_id = profile.get("id") if isinstance(profile, dict) else None
        if not isinstance(spotify_id, str) or not _SPOTIFY_USER.fullmatch(spotify_id):
            raise SpotifyError(503, "O Spotify não devolveu o perfil da conta.")
        product = profile.get("product")
        product = product if isinstance(product, str) and _PRODUCT.fullmatch(product) else None
        display_name = _text(profile.get("display_name"), 120)

        now = _now()
        await _rest(client, settings, "POST", "spotify_connections",
                    params={"on_conflict": "user_id"}, prefer="resolution=merge-duplicates,return=minimal", json={
                        "user_id": user_id, "spotify_user_id": spotify_id, "display_name": display_name,
                        "product": product, "scopes": tokens["scope"],
                        "access_token": tokens["access_token"], "refresh_token": tokens["refresh_token"],
                        "expires_at": (now + timedelta(seconds=tokens["expires_in"])).isoformat(),
                        "created_at": now.isoformat(), "updated_at": now.isoformat(),
                    })
    logger.info("spotify connected user=%s product=%s", user_id, product)
    return {"return_to": return_to, **public_connection({"display_name": display_name, "product": product, "scopes": tokens["scope"], "created_at": now.isoformat()})}


async def fresh_access_token(client: httpx.AsyncClient, settings: SpotifySettings, user_id: str) -> str:
    row = await load_connection(client, settings, user_id)
    if not row:
        raise SpotifyError(409, NOT_CONNECTED, reconnect=True)
    expires_at = _parse_time(row.get("expires_at"))
    access = row.get("access_token")
    if isinstance(access, str) and expires_at and expires_at > _now() + timedelta(seconds=REFRESH_MARGIN_SECONDS):
        return access
    refresh = row.get("refresh_token")
    if not isinstance(refresh, str):
        raise SpotifyError(409, RECONNECT, reconnect=True)
    try:
        tokens = await _token_request(client, settings, {"grant_type": "refresh_token", "refresh_token": refresh})
    except SpotifyError as error:
        if error.reconnect:
            # Refresh token revogado: a conexão não serve mais.
            await delete_connection(client, settings, user_id)
            raise SpotifyError(409, RECONNECT, reconnect=True) from error
        raise
    values: dict[str, Any] = {
        "access_token": tokens["access_token"],
        "expires_at": (_now() + timedelta(seconds=tokens["expires_in"])).isoformat(),
        "updated_at": _now().isoformat(),
    }
    if tokens["refresh_token"]:
        values["refresh_token"] = tokens["refresh_token"]
    if tokens["scope"]:
        values["scopes"] = tokens["scope"]
    await _rest(client, settings, "PATCH", "spotify_connections", params={"user_id": f"eq.{user_id}"},
                json=values, prefer="return=minimal")
    return tokens["access_token"]


# Web API

async def spotify_request(client: httpx.AsyncClient, access_token: str, method: str, path: str, *,
                          params: dict[str, str] | None = None, json: Any = None,
                          forbidden: str | None = None, not_found: tuple[int, str] | None = None) -> Any:
    try:
        response = await client.request(
            method, f"{API}{path}", params=params, json=json,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    except httpx.HTTPError as error:
        raise SpotifyError(503, "O Spotify não respondeu; tente de novo em instantes.") from error
    status = response.status_code
    if status in (202, 204) or (status < 300 and not response.content):
        return None
    if status == 401:
        raise SpotifyError(409, RECONNECT, reconnect=True)
    if status == 403:
        reason = ""
        try:
            body = response.json()
            reason = str(body.get("error", {}).get("reason", "")) if isinstance(body, dict) else ""
        except (ValueError, AttributeError):
            pass
        if reason == "PREMIUM_REQUIRED":
            raise SpotifyError(403, "O Spotify só deixa controlar a reprodução com uma conta Premium.")
        raise SpotifyError(403, forbidden or "O Spotify não permitiu esta ação agora.")
    if status == 404 and not_found:
        raise SpotifyError(not_found[0], not_found[1])
    if status == 404:
        raise SpotifyError(409, "Nenhum aparelho ativo. Abra o Spotify num aparelho e tente de novo.")
    if status == 429:
        try:
            retry = max(1, min(60, int(float(response.headers.get("Retry-After", "5")))))
        except ValueError:
            retry = 5
        raise SpotifyError(429, "O Spotify pediu uma pausa; tente de novo em instantes.", retry_after=retry)
    if status >= 500:
        raise SpotifyError(503, f"O Spotify está indisponível ({status}).")
    if status >= 400:
        raise SpotifyError(502, f"O Spotify recusou o pedido ({status}).")
    try:
        return response.json()
    except ValueError as error:
        raise SpotifyError(503, "Resposta inválida do Spotify.") from error


async def player_call(settings: SpotifySettings, user_id: str, method: str, path: str, *,
                      params: dict[str, str] | None = None, json: Any = None,
                      forbidden: str | None = None, not_found: tuple[int, str] | None = None) -> Any:
    async with httpx.AsyncClient(timeout=8) as client:
        token = await fresh_access_token(client, settings, user_id)
        return await spotify_request(client, token, method, path, params=params, json=json,
                                     forbidden=forbidden, not_found=not_found)


def count(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def shape_track(value: Any) -> dict[str, Any] | None:
    """Faixa para a interface; episódios, faixas locais e itens nulos ficam de fora."""
    if not isinstance(value, dict):
        return None
    uri = value.get("uri")
    if not isinstance(uri, str) or not TRACK_URI.fullmatch(uri) or value.get("is_local") is True:
        return None
    artists = value.get("artists") if isinstance(value.get("artists"), list) else []
    album = value.get("album") if isinstance(value.get("album"), dict) else {}
    duration = value.get("duration_ms")
    return {
        "uri": uri,
        "id": uri.rsplit(":", 1)[1],
        "name": _text(value.get("name"), 200) or "Faixa sem nome",
        "artists": [name for name in (_text(artist.get("name"), 120) for artist in artists[:5] if isinstance(artist, dict)) if name],
        "album": _text(album.get("name"), 200) or "",
        "duration_ms": duration if isinstance(duration, int) and not isinstance(duration, bool) and duration >= 0 else 0,
    }


def shape_tracks(items: Any, *, wrapped: bool = False) -> list[dict[str, Any]]:
    shaped = []
    for entry in items if isinstance(items, list) else []:
        if wrapped:
            # Itens de playlist: a faixa vem em "item" (API atual) ou "track" (formato antigo).
            entry = (entry.get("item") or entry.get("track")) if isinstance(entry, dict) else None
        track = shape_track(entry)
        if track:
            shaped.append(track)
    return shaped


def shape_playlist(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    playlist_id = value.get("id")
    if not isinstance(playlist_id, str) or not PLAYLIST_ID.fullmatch(playlist_id):
        return None
    owner = value.get("owner") if isinstance(value.get("owner"), dict) else {}
    owner_id = owner.get("id")
    totals = value.get("items") if isinstance(value.get("items"), dict) else value.get("tracks")
    public = value.get("public")
    return {
        "id": playlist_id,
        "name": _text(value.get("name"), 100) or "Playlist sem nome",
        "description": _text(value.get("description"), 300),
        "public": public if isinstance(public, bool) else None,
        "owner_id": owner_id if isinstance(owner_id, str) and _SPOTIFY_USER.fullmatch(owner_id) else None,
        "tracks_total": count(totals.get("total")) if isinstance(totals, dict) else 0,
        "uri": f"spotify:playlist:{playlist_id}",
    }


def shape_snapshot(body: Any) -> str:
    snapshot = body.get("snapshot_id") if isinstance(body, dict) else None
    if not isinstance(snapshot, str) or not 0 < len(snapshot) <= 256 or _CONTROL.search(snapshot):
        raise SpotifyError(502, "O Spotify não confirmou a alteração da playlist.")
    return snapshot


def _https_url(value: Any) -> str | None:
    return value if isinstance(value, str) and value.startswith("https://") and len(value) <= 512 and not _CONTROL.search(value) else None


def shape_device(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    device_id = value.get("id")
    volume = value.get("volume_percent")
    return {
        "id": device_id if isinstance(device_id, str) and DEVICE_ID.fullmatch(device_id) else None,
        "name": _text(value.get("name"), 80) or "Aparelho sem nome",
        "type": _text(value.get("type"), 32) or "Unknown",
        "is_active": value.get("is_active") is True,
        "volume_percent": volume if isinstance(volume, int) and not isinstance(volume, bool) and 0 <= volume <= 100 else None,
        "supports_volume": value.get("supports_volume") is not False,
    }


def shape_devices(body: Any) -> list[dict[str, Any]]:
    devices = body.get("devices") if isinstance(body, dict) else None
    if not isinstance(devices, list):
        return []
    shaped = [shape_device(device) for device in devices[:20]]
    return [device for device in shaped if device and device["id"]]


def shape_player(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {"active": False, "is_playing": False, "progress_ms": None, "device": None, "item": None, "context_uri": None}
    item = body.get("item") if isinstance(body.get("item"), dict) else None
    shaped_item = None
    if item:
        artists = item.get("artists") if isinstance(item.get("artists"), list) else []
        album = item.get("album") if isinstance(item.get("album"), dict) else {}
        images = album.get("images") if isinstance(album.get("images"), list) else []
        duration = item.get("duration_ms")
        shaped_item = {
            "name": _text(item.get("name"), 200) or "Faixa sem nome",
            "artists": [name for name in (_text(artist.get("name"), 120) for artist in artists[:5] if isinstance(artist, dict)) if name],
            "album": _text(album.get("name"), 200),
            "image_url": next((url for url in (_https_url(image.get("url")) for image in images if isinstance(image, dict)) if url), None),
            "duration_ms": duration if isinstance(duration, int) and not isinstance(duration, bool) and duration >= 0 else None,
            "url": _https_url((item.get("external_urls") or {}).get("spotify") if isinstance(item.get("external_urls"), dict) else None),
        }
    context = body.get("context") if isinstance(body.get("context"), dict) else {}
    context_uri = context.get("uri")
    progress = body.get("progress_ms")
    return {
        "active": True,
        "is_playing": body.get("is_playing") is True,
        "progress_ms": progress if isinstance(progress, int) and not isinstance(progress, bool) and progress >= 0 else None,
        "device": shape_device(body.get("device")),
        "item": shaped_item,
        "context_uri": context_uri if isinstance(context_uri, str) and re.fullmatch(r"spotify:[a-z]+:[A-Za-z0-9]{1,64}", context_uri) else None,
    }
