from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import spotify as route
from app.services import spotify


USER = "3f000000-0000-4000-8000-000000000001"
TOKEN = "Bearer spotify-user-session"
CLIENT_ID = "0123456789abcdef0123456789abcdef"
CLIENT_SECRET = "spotify-client-secret-value"
SERVICE_KEY = "service-role-secret"
SUPABASE = "https://example.supabase.co"
REDIRECT = "http://localhost:3000/app/spotify/callback"
CAMPAIGN_PATH = "/app/campaign/2e000000-0000-4000-8000-000000000001"
PLAYLIST = "37i9dQZF1DXcBWIGoYBM5M"
DEVICE = "a1b2c3d4e5f60718293a4b5c6d7e8f9001122334"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(route.router)
    return TestClient(app)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", SUPABASE)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    monkeypatch.setenv("SPOTIFY_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("SPOTIFY_CLIENT_SECRET", CLIENT_SECRET)
    monkeypatch.setenv("SPOTIFY_REDIRECT_URI", REDIRECT)

    async def fake_verify(authorization: str) -> dict:
        assert authorization == TOKEN
        return {"id": USER}

    monkeypatch.setattr(route, "verify_supabase_user", fake_verify)


def _iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def _connection(**overrides) -> dict:
    row = {
        "user_id": USER, "spotify_user_id": "mesa.user", "display_name": "Mesa", "product": "premium",
        "scopes": " ".join(spotify.SCOPES), "access_token": "old-access", "refresh_token": "the-refresh",
        "expires_at": _iso(timedelta(hours=1)), "created_at": _iso(timedelta(days=-1)),
    }
    row.update(overrides)
    return row


class FakeBackend:
    """Supabase REST (chave de serviço), contas e Web API do Spotify atrás de um MockTransport."""

    def __init__(self, *, connection: dict | None = None, state_row: dict | None = None, token=None, api=None):
        self.connection = connection
        self.state_row = state_row
        self.token = token or (lambda request: httpx.Response(200, json={
            "access_token": "new-access", "token_type": "Bearer", "expires_in": 3600,
            "refresh_token": "new-refresh", "scope": " ".join(spotify.SCOPES),
        }))
        self.api = api or self.default_api
        self.requests: list[httpx.Request] = []
        self.rest: list[tuple[str, str, dict, object]] = []
        self.token_calls: list[httpx.Request] = []
        self.api_calls: list[httpx.Request] = []

    @staticmethod
    def default_api(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/me":
            return httpx.Response(200, json={"id": "mesa.user", "display_name": "Mesa\nda Noite", "product": "premium"})
        if request.url.path == "/v1/me/player" and request.method == "GET":
            return httpx.Response(200, json={
                "is_playing": True, "progress_ms": 61000,
                "device": {"id": DEVICE, "name": "Notebook", "type": "Computer", "is_active": True, "volume_percent": 40},
                "context": {"uri": f"spotify:playlist:{PLAYLIST}"},
                "item": {"name": "Noite", "duration_ms": 200000, "artists": [{"name": "Banda"}],
                         "album": {"name": "Disco", "images": [{"url": "https://i.scdn.co/image/abc"}]},
                         "external_urls": {"spotify": "https://open.spotify.com/track/xyz"}},
            })
        return httpx.Response(204)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "accounts.spotify.com":
            self.token_calls.append(request)
            return self.token(request)
        if request.url.host == "api.spotify.com":
            self.api_calls.append(request)
            return self.api(request)
        assert request.headers["authorization"] == f"Bearer {SERVICE_KEY}"
        table = request.url.path.removeprefix("/rest/v1/")
        params = dict(request.url.params)
        body = json.loads(request.content) if request.content else None
        self.rest.append((request.method, table, params, body))
        if table == "spotify_oauth_states" and request.method == "DELETE" and "state_hash" in params:
            row = self.state_row
            if row and params == {"state_hash": f"eq.{row['state_hash']}", "user_id": f"eq.{row['user_id']}"}:
                self.state_row = None
                return httpx.Response(200, json=[row])
            return httpx.Response(200, json=[])
        if table == "spotify_connections" and request.method == "GET":
            return httpx.Response(200, json=[self.connection] if self.connection else [])
        if table == "spotify_connections" and request.method == "DELETE":
            self.connection = None
        return httpx.Response(204)

    def install(self, monkeypatch) -> None:
        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(self.handler)
        monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: real_client(*a, transport=transport, **k))

    def writes(self, table: str, method: str) -> list:
        return [body for verb, name, _, body in self.rest if name == table and verb == method]


def _headers() -> dict[str, str]:
    return {"Authorization": TOKEN}


def _state_row(state: str, **overrides) -> dict:
    row = {"state_hash": spotify.hash_state(state), "user_id": USER, "return_to": CAMPAIGN_PATH,
           "expires_at": _iso(timedelta(minutes=5))}
    row.update(overrides)
    return row


STATE = "s" * 43


def test_config_reports_enabled_and_disabled(monkeypatch, configured) -> None:
    assert _client().get("/api/v1/spotify/config").json() == {"enabled": True}
    monkeypatch.delenv("SPOTIFY_CLIENT_SECRET")
    assert _client().get("/api/v1/spotify/config").json() == {"enabled": False}


def test_without_configuration_returns_503_and_touches_nothing(monkeypatch, configured) -> None:
    monkeypatch.delenv("SPOTIFY_CLIENT_ID")
    backend = FakeBackend()
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/authorize", headers=_headers(), json={"return_to": "/app"})
    assert response.status_code == 503 and "não está configurada" in response.json()["detail"]
    assert backend.requests == []


@pytest.mark.parametrize("uri", ["https://evil.example/app/spotify/callback", "http://example.com/app/spotify/callback", "https://app.example/other"])
def test_redirect_uri_must_be_https_callback(monkeypatch, configured, uri) -> None:
    monkeypatch.setenv("SPOTIFY_REDIRECT_URI", uri)
    expected = uri == "https://evil.example/app/spotify/callback"  # HTTPS e caminho certos: aceito
    assert spotify.spotify_enabled() is expected


def test_authorize_stores_only_the_state_hash(monkeypatch, configured) -> None:
    backend = FakeBackend()
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/authorize", headers=_headers(), json={"return_to": CAMPAIGN_PATH})
    assert response.status_code == 200
    url = urlsplit(response.json()["url"])
    query = {key: values[0] for key, values in parse_qs(url.query).items()}
    assert url.netloc == "accounts.spotify.com" and url.path == "/authorize"
    assert query["client_id"] == CLIENT_ID and query["redirect_uri"] == REDIRECT and query["response_type"] == "code"
    assert set(query["scope"].split()) == set(spotify.SCOPES)
    state = query["state"]
    assert spotify.STATE.fullmatch(state)

    stored = backend.writes("spotify_oauth_states", "POST")[0]
    assert stored["state_hash"] == spotify.hash_state(state) and state not in json.dumps(stored)
    assert stored["user_id"] == USER and stored["return_to"] == CAMPAIGN_PATH
    deleted = [params for verb, name, params, _ in backend.rest if name == "spotify_oauth_states" and verb == "DELETE"]
    assert deleted and deleted[0]["user_id"] == f"eq.{USER}" and deleted[0]["expires_at"].startswith("lt.")


@pytest.mark.parametrize("return_to", ["https://evil.example", "//evil.example", "/app/campaign/x", "/login"])
def test_authorize_rejects_foreign_return_paths(monkeypatch, configured, return_to) -> None:
    backend = FakeBackend()
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/authorize", headers=_headers(), json={"return_to": return_to})
    assert response.status_code == 422
    assert backend.writes("spotify_oauth_states", "POST") == []


def test_callback_exchanges_code_and_never_returns_tokens(monkeypatch, configured, caplog) -> None:
    backend = FakeBackend(state_row=_state_row(STATE))
    backend.install(monkeypatch)
    with caplog.at_level(logging.DEBUG):
        response = _client().post("/api/v1/spotify/callback", headers=_headers(), json={"code": "the-code", "state": STATE})
    assert response.status_code == 200
    body = response.json()
    assert body["return_to"] == CAMPAIGN_PATH and body["connected"] is True and body["premium"] is True
    assert body["display_name"] == "Mesa da Noite"
    assert "new-access" not in response.text and "new-refresh" not in response.text

    exchange = backend.token_calls[0]
    expected_auth = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    assert exchange.headers["authorization"] == f"Basic {expected_auth}"
    assert parse_qs(exchange.content.decode()) == {"grant_type": ["authorization_code"], "code": ["the-code"], "redirect_uri": [REDIRECT]}
    assert backend.api_calls[0].headers["authorization"] == "Bearer new-access"

    saved = backend.writes("spotify_connections", "POST")[0]
    assert saved["user_id"] == USER and saved["access_token"] == "new-access" and saved["refresh_token"] == "new-refresh"
    assert saved["product"] == "premium" and saved["spotify_user_id"] == "mesa.user"
    for secret in (CLIENT_SECRET, SERVICE_KEY, "new-access", "new-refresh", "the-code"):
        assert secret not in caplog.text


def test_callback_state_of_another_user_is_refused(monkeypatch, configured) -> None:
    backend = FakeBackend(state_row=_state_row(STATE, user_id="3f000000-0000-4000-8000-000000000099"))
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/callback", headers=_headers(), json={"code": "the-code", "state": STATE})
    assert response.status_code == 400 and "expirou" in response.json()["detail"]
    assert backend.token_calls == [] and backend.writes("spotify_connections", "POST") == []


def test_callback_expired_state_is_refused(monkeypatch, configured) -> None:
    backend = FakeBackend(state_row=_state_row(STATE, expires_at=_iso(timedelta(minutes=-1))))
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/callback", headers=_headers(), json={"code": "the-code", "state": STATE})
    assert response.status_code == 400
    assert backend.token_calls == []


def test_callback_state_is_single_use(monkeypatch, configured) -> None:
    backend = FakeBackend(state_row=_state_row(STATE))
    backend.install(monkeypatch)
    payload = {"code": "the-code", "state": STATE}
    assert _client().post("/api/v1/spotify/callback", headers=_headers(), json=payload).status_code == 200
    assert _client().post("/api/v1/spotify/callback", headers=_headers(), json=payload).status_code == 400
    assert len(backend.token_calls) == 1


def test_callback_refused_code_asks_to_reconnect(monkeypatch, configured) -> None:
    backend = FakeBackend(state_row=_state_row(STATE), token=lambda request: httpx.Response(400, json={"error": "invalid_grant"}))
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/callback", headers=_headers(), json={"code": "the-code", "state": STATE})
    assert response.status_code == 400 and "recusou" in response.json()["detail"]
    assert backend.writes("spotify_connections", "POST") == []


def test_connection_status_hides_tokens(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(product="free"))
    backend.install(monkeypatch)
    response = _client().get("/api/v1/spotify/connection", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True and body["connected"] is True and body["premium"] is False and body["product"] == "free"
    assert "old-access" not in response.text and "the-refresh" not in response.text


def test_disconnect_deletes_own_row(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().delete("/api/v1/spotify/connection", headers=_headers()).status_code == 204
    deleted = [params for verb, name, params, _ in backend.rest if name == "spotify_connections" and verb == "DELETE"]
    assert deleted == [{"user_id": f"eq.{USER}"}]


def test_player_state_is_shaped(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    response = _client().get("/api/v1/spotify/player", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["is_playing"] is True and body["device"]["name"] == "Notebook" and body["device"]["volume_percent"] == 40
    assert body["item"] == {"name": "Noite", "artists": ["Banda"], "album": "Disco", "image_url": "https://i.scdn.co/image/abc",
                            "duration_ms": 200000, "url": "https://open.spotify.com/track/xyz"}
    assert body["context_uri"] == f"spotify:playlist:{PLAYLIST}"
    assert backend.token_calls == []  # token ainda válido: sem refresh


def test_no_playback_reports_inactive(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(204))
    backend.install(monkeypatch)
    assert _client().get("/api/v1/spotify/player", headers=_headers()).json()["active"] is False


def test_expired_token_is_refreshed_and_saved(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(expires_at=_iso(timedelta(seconds=10))))
    backend.install(monkeypatch)
    assert _client().get("/api/v1/spotify/player", headers=_headers()).status_code == 200
    assert parse_qs(backend.token_calls[0].content.decode()) == {"grant_type": ["refresh_token"], "refresh_token": ["the-refresh"]}
    patch = backend.writes("spotify_connections", "PATCH")[0]
    assert patch["access_token"] == "new-access" and patch["refresh_token"] == "new-refresh"
    assert backend.api_calls[0].headers["authorization"] == "Bearer new-access"


def test_revoked_refresh_token_drops_connection(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(expires_at=_iso(timedelta(seconds=-5))),
                          token=lambda request: httpx.Response(400, json={"error": "invalid_grant"}))
    backend.install(monkeypatch)
    response = _client().get("/api/v1/spotify/player", headers=_headers())
    assert response.status_code == 409 and "Conecte a conta de novo" in response.json()["detail"]
    assert backend.connection is None and backend.api_calls == []


def test_play_playlist_on_device(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/player/play", headers=_headers(), json={"playlist_id": PLAYLIST, "device_id": DEVICE})
    assert response.status_code == 204
    call = backend.api_calls[0]
    assert call.method == "PUT" and call.url.path == "/v1/me/player/play" and call.url.params["device_id"] == DEVICE
    assert json.loads(call.content) == {"context_uri": f"spotify:playlist:{PLAYLIST}"}


@pytest.mark.parametrize("path,payload", [
    ("/api/v1/spotify/player/play", {"playlist_id": "not-a-playlist"}),
    ("/api/v1/spotify/player/pause", {"device_id": "bad device"}),
    ("/api/v1/spotify/player/volume", {"percent": 101}),
])
def test_invalid_input_calls_nothing(monkeypatch, configured, path, payload) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().post(path, headers=_headers(), json=payload).status_code == 422
    assert backend.api_calls == []


def test_volume_and_transfer_and_skip(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    client = _client()
    assert client.post("/api/v1/spotify/player/volume", headers=_headers(), json={"percent": 35}).status_code == 204
    assert client.post("/api/v1/spotify/player/transfer", headers=_headers(), json={"device_id": DEVICE, "play": True}).status_code == 204
    assert client.post("/api/v1/spotify/player/next", headers=_headers(), json={}).status_code == 204
    assert client.post("/api/v1/spotify/player/previous", headers=_headers(), json={}).status_code == 204
    volume, transfer, next_call, previous = backend.api_calls
    assert volume.url.path == "/v1/me/player/volume" and volume.url.params["volume_percent"] == "35"
    assert transfer.method == "PUT" and json.loads(transfer.content) == {"device_ids": [DEVICE], "play": True}
    assert next_call.method == "POST" and next_call.url.path == "/v1/me/player/next"
    assert previous.url.path == "/v1/me/player/previous"


def test_premium_required_is_explained(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(product="free"), api=lambda request: httpx.Response(
        403, json={"error": {"status": 403, "message": "Player command failed: Premium required", "reason": "PREMIUM_REQUIRED"}}))
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/player/pause", headers=_headers(), json={})
    assert response.status_code == 403 and "Premium" in response.json()["detail"]


def test_no_active_device_is_explained(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(
        404, json={"error": {"status": 404, "message": "Player command failed: No active device found", "reason": "NO_ACTIVE_DEVICE"}}))
    backend.install(monkeypatch)
    response = _client().post("/api/v1/spotify/player/play", headers=_headers(), json={})
    assert response.status_code == 409 and "Nenhum aparelho ativo" in response.json()["detail"]


def test_rate_limit_passes_retry_after(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(429, headers={"Retry-After": "7"}))
    backend.install(monkeypatch)
    response = _client().get("/api/v1/spotify/devices", headers=_headers())
    assert response.status_code == 429 and response.headers["retry-after"] == "7"


def test_devices_are_filtered(monkeypatch, configured) -> None:
    devices = {"devices": [
        {"id": DEVICE, "name": "Notebook", "type": "Computer", "is_active": False, "volume_percent": 55},
        {"id": None, "name": "Restrito", "type": "Speaker"},
    ]}
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(200, json=devices))
    backend.install(monkeypatch)
    body = _client().get("/api/v1/spotify/devices", headers=_headers()).json()
    assert [device["name"] for device in body["devices"]] == ["Notebook"]


def test_not_connected_asks_to_connect(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=None)
    backend.install(monkeypatch)
    response = _client().get("/api/v1/spotify/player", headers=_headers())
    assert response.status_code == 409 and "Conecte sua conta" in response.json()["detail"]
    assert backend.api_calls == []


def test_missing_session_is_refused(configured, monkeypatch) -> None:
    from app.security import AuthenticationError

    async def refuse(authorization: str) -> dict:
        raise AuthenticationError(401)

    monkeypatch.setattr(route, "verify_supabase_user", refuse)
    assert _client().get("/api/v1/spotify/player").status_code == 401


def test_settings_repr_hides_secrets(configured) -> None:
    text = repr(spotify.spotify_settings())
    assert CLIENT_SECRET not in text and SERVICE_KEY not in text


TRACK_A = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"
TRACK_B = "spotify:track:1301WleyT98MSxVHPZCA6M"
BASE = "/api/v1/spotify"


def _track_json(uri: str = TRACK_A, **overrides) -> dict:
    row = {"uri": uri, "id": uri.rsplit(":", 1)[1], "name": "Noite", "duration_ms": 180000,
           "artists": [{"name": "Banda"}, {"name": "Coro"}], "album": {"name": "Disco"}}
    row.update(overrides)
    return row


def _playlist_json(**overrides) -> dict:
    row = {"id": PLAYLIST, "name": "Taverna", "description": "Mesa de jogo", "public": False,
           "owner": {"id": "mesa.user"}, "tracks": {"total": 12}}
    row.update(overrides)
    return row


def _forbidden(request: httpx.Request) -> httpx.Response:
    return httpx.Response(403, json={"error": {"status": 403, "message": "Insufficient client scope"}})


def test_connection_reports_scopes_and_no_reconnect(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    body = _client().get(f"{BASE}/connection", headers=_headers()).json()
    assert set(body["scopes"]) == set(spotify.SCOPES) and body["needs_reconnect"] is False


@pytest.mark.parametrize("scopes", ["user-read-private user-read-playback-state", "", None])
def test_connection_with_missing_scopes_needs_reconnect(monkeypatch, configured, scopes) -> None:
    backend = FakeBackend(connection=_connection(scopes=scopes))
    backend.install(monkeypatch)
    body = _client().get(f"{BASE}/connection", headers=_headers()).json()
    assert body["connected"] is True and body["needs_reconnect"] is True
    assert body["scopes"] == (scopes or "").split()


def test_disconnected_has_no_scopes_and_no_reconnect(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=None)
    backend.install(monkeypatch)
    body = _client().get(f"{BASE}/connection", headers=_headers()).json()
    assert body["connected"] is False and body["scopes"] == [] and body["needs_reconnect"] is False


def test_search_tracks(monkeypatch, configured) -> None:
    payload = {"tracks": {"items": [_track_json(), {"uri": "spotify:local:x:y:z:1", "name": "Local"}, None,
                                    _track_json(TRACK_B, name="Dia", album=None)]}}
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(200, json=payload))
    backend.install(monkeypatch)
    response = _client().get(f"{BASE}/search", headers=_headers(), params={"q": "noite", "limit": 5})
    assert response.status_code == 200
    assert response.json() == {"tracks": [
        {"uri": TRACK_A, "id": "4uLU6hMCjMI75M1A2tKUQC", "name": "Noite", "artists": ["Banda", "Coro"], "album": "Disco", "duration_ms": 180000},
        {"uri": TRACK_B, "id": "1301WleyT98MSxVHPZCA6M", "name": "Dia", "artists": ["Banda", "Coro"], "album": "", "duration_ms": 180000},
    ]}
    call = backend.api_calls[0]
    assert call.url.path == "/v1/search" and dict(call.url.params) == {"q": "noite", "type": "track", "limit": "5"}


@pytest.mark.parametrize("params", [{"q": ""}, {"q": "x" * 201}, {"q": "a", "limit": 0}, {"q": "a", "limit": 21}, {}])
def test_search_validation(monkeypatch, configured, params) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().get(f"{BASE}/search", headers=_headers(), params=params).status_code == 422
    assert backend.api_calls == []


def test_search_forbidden_is_mapped(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=_forbidden)
    backend.install(monkeypatch)
    response = _client().get(f"{BASE}/search", headers=_headers(), params={"q": "a"})
    assert response.status_code == 403 and "Reconecte" in response.json()["detail"]


def test_queue_track(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    response = _client().post(f"{BASE}/player/queue", headers=_headers(), json={"uri": TRACK_A, "device_id": DEVICE})
    assert response.status_code == 200 and response.json() == {"ok": True}
    call = backend.api_calls[0]
    assert call.method == "POST" and call.url.path == "/v1/me/player/queue"
    assert dict(call.url.params) == {"uri": TRACK_A, "device_id": DEVICE}


@pytest.mark.parametrize("payload", [{"uri": "spotify:track:short"}, {"uri": f"spotify:album:{PLAYLIST}"}, {}, {"uri": TRACK_A, "device_id": "bad device"}])
def test_queue_validation(monkeypatch, configured, payload) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().post(f"{BASE}/player/queue", headers=_headers(), json=payload).status_code == 422
    assert backend.api_calls == []


def test_queue_premium_required_is_mapped(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(product="free"), api=lambda request: httpx.Response(
        403, json={"error": {"status": 403, "reason": "PREMIUM_REQUIRED"}}))
    backend.install(monkeypatch)
    response = _client().post(f"{BASE}/player/queue", headers=_headers(), json={"uri": TRACK_A})
    assert response.status_code == 403 and "Premium" in response.json()["detail"]


def test_play_context_offset_and_position(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    client = _client()
    album = "spotify:album:4aawyAB9vmqN3uQ7FjRGTy"
    assert client.post(f"{BASE}/player/play", headers=_headers(),
                       json={"context_uri": album, "offset_uri": TRACK_A, "position_ms": 1500}).status_code == 204
    assert client.post(f"{BASE}/player/play", headers=_headers(), json={"uris": [TRACK_A, TRACK_B]}).status_code == 204
    first, second = backend.api_calls
    assert json.loads(first.content) == {"context_uri": album, "offset": {"uri": TRACK_A}, "position_ms": 1500}
    assert json.loads(second.content) == {"uris": [TRACK_A, TRACK_B]}


@pytest.mark.parametrize("payload", [
    {"context_uri": "spotify:artist:" + PLAYLIST},
    {"uris": ["spotify:track:bad"]},
    {"uris": [TRACK_A] * 51},
    {"uris": []},
    {"position_ms": 86_400_001},
    {"position_ms": -1},
    {"offset_uri": "spotify:track:bad", "context_uri": f"spotify:playlist:{PLAYLIST}"},
    {"offset_uri": TRACK_A},
    {"context_uri": f"spotify:playlist:{PLAYLIST}", "uris": [TRACK_A]},
    {"context_uri": f"spotify:playlist:{PLAYLIST}", "playlist_id": PLAYLIST},
])
def test_play_extended_validation(monkeypatch, configured, payload) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().post(f"{BASE}/player/play", headers=_headers(), json=payload).status_code == 422
    assert backend.api_calls == []


def test_list_playlists(monkeypatch, configured) -> None:
    payload = {"items": [_playlist_json(), None, {"id": "bad"}, _playlist_json(id="1" * 22, public=None, description="", tracks=None, items={"total": 3})], "total": 40}
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(200, json=payload))
    backend.install(monkeypatch)
    response = _client().get(f"{BASE}/playlists", headers=_headers(), params={"limit": 20, "offset": 20})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 40
    assert body["items"][0] == {"id": PLAYLIST, "name": "Taverna", "description": "Mesa de jogo", "public": False,
                                "owner_id": "mesa.user", "tracks_total": 12, "uri": f"spotify:playlist:{PLAYLIST}"}
    assert body["items"][1]["public"] is None and body["items"][1]["tracks_total"] == 3 and len(body["items"]) == 2
    assert dict(backend.api_calls[0].url.params) == {"limit": "20", "offset": "20"}


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 51}, {"offset": -1}])
def test_list_playlists_validation(monkeypatch, configured, params) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().get(f"{BASE}/playlists", headers=_headers(), params=params).status_code == 422
    assert backend.api_calls == []


def test_list_playlists_forbidden_is_mapped(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=_forbidden)
    backend.install(monkeypatch)
    response = _client().get(f"{BASE}/playlists", headers=_headers())
    assert response.status_code == 403 and "permissão de playlists" in response.json()["detail"]


def test_create_playlist(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(201, json=_playlist_json(name="Nova", tracks={"total": 0})))
    backend.install(monkeypatch)
    response = _client().post(f"{BASE}/playlists", headers=_headers(), json={"name": " Nova ", "description": "Sessão 1"})
    assert response.status_code == 200
    assert response.json() == {"id": PLAYLIST, "name": "Nova", "description": "Mesa de jogo", "public": False,
                               "owner_id": "mesa.user", "tracks_total": 0, "uri": f"spotify:playlist:{PLAYLIST}"}
    call = backend.api_calls[0]
    assert call.method == "POST" and call.url.path == "/v1/me/playlists"
    assert json.loads(call.content) == {"name": "Nova", "public": False, "description": "Sessão 1"}


@pytest.mark.parametrize("payload", [{}, {"name": ""}, {"name": "   "}, {"name": "x" * 101}, {"name": "ok", "description": "d" * 301}])
def test_create_playlist_validation(monkeypatch, configured, payload) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().post(f"{BASE}/playlists", headers=_headers(), json=payload).status_code == 422
    assert backend.api_calls == []


def test_create_playlist_forbidden_is_mapped(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=_forbidden)
    backend.install(monkeypatch)
    response = _client().post(f"{BASE}/playlists", headers=_headers(), json={"name": "Nova"})
    assert response.status_code == 403 and "Reconecte" in response.json()["detail"]


def test_update_playlist(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(200))
    backend.install(monkeypatch)
    client = _client()
    assert client.patch(f"{BASE}/playlists/{PLAYLIST}", headers=_headers(), json={"name": "Outro"}).json() == {"ok": True}
    assert client.patch(f"{BASE}/playlists/{PLAYLIST}", headers=_headers(), json={"description": ""}).json() == {"ok": True}
    first, second = backend.api_calls
    assert first.method == "PUT" and first.url.path == f"/v1/playlists/{PLAYLIST}" and json.loads(first.content) == {"name": "Outro"}
    assert json.loads(second.content) == {"description": ""}


@pytest.mark.parametrize("playlist_id,payload", [
    (PLAYLIST, {}), (PLAYLIST, {"name": ""}), (PLAYLIST, {"name": "x" * 101}), ("not-a-playlist", {"name": "ok"}),
])
def test_update_playlist_validation(monkeypatch, configured, playlist_id, payload) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().patch(f"{BASE}/playlists/{playlist_id}", headers=_headers(), json=payload).status_code == 422
    assert backend.api_calls == []


def test_update_playlist_forbidden_and_not_found(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=_forbidden)
    backend.install(monkeypatch)
    assert _client().patch(f"{BASE}/playlists/{PLAYLIST}", headers=_headers(), json={"name": "Outro"}).status_code == 403
    backend.api = lambda request: httpx.Response(404, json={"error": {"status": 404}})
    response = _client().patch(f"{BASE}/playlists/{PLAYLIST}", headers=_headers(), json={"name": "Outro"})
    assert response.status_code == 404 and "Playlist não encontrada" in response.json()["detail"]


def test_playlist_tracks_skip_null_and_local(monkeypatch, configured) -> None:
    payload = {"total": 4, "items": [
        {"item": _track_json()},
        {"track": _track_json(TRACK_B, name="Dia")},
        {"item": None},
        {"item": {"uri": "spotify:local:a:b:c:1", "is_local": True, "name": "Local"}},
    ]}
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(200, json=payload))
    backend.install(monkeypatch)
    response = _client().get(f"{BASE}/playlists/{PLAYLIST}/tracks", headers=_headers(), params={"limit": 50, "offset": 10})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 4 and [track["uri"] for track in body["items"]] == [TRACK_A, TRACK_B]
    assert set(body["items"][0]) == {"uri", "id", "name", "artists", "album", "duration_ms"}
    call = backend.api_calls[0]
    assert call.url.path == f"/v1/playlists/{PLAYLIST}/items" and call.url.params["limit"] == "50" and call.url.params["offset"] == "10"


@pytest.mark.parametrize("path,params", [
    (f"{BASE}/playlists/bad/tracks", {}), (f"{BASE}/playlists/{PLAYLIST}/tracks", {"limit": 101}),
    (f"{BASE}/playlists/{PLAYLIST}/tracks", {"limit": 0}), (f"{BASE}/playlists/{PLAYLIST}/tracks", {"offset": -1}),
])
def test_playlist_tracks_validation(monkeypatch, configured, path, params) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().get(path, headers=_headers(), params=params).status_code == 422
    assert backend.api_calls == []


def test_playlist_tracks_forbidden_is_mapped(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=_forbidden)
    backend.install(monkeypatch)
    response = _client().get(f"{BASE}/playlists/{PLAYLIST}/tracks", headers=_headers())
    assert response.status_code == 403 and "playlist" in response.json()["detail"]


def test_add_and_remove_playlist_tracks(monkeypatch, configured) -> None:
    backend = FakeBackend(connection=_connection(), api=lambda request: httpx.Response(201 if request.method == "POST" else 200, json={"snapshot_id": "snap-1"}))
    backend.install(monkeypatch)
    client = _client()
    added = client.post(f"{BASE}/playlists/{PLAYLIST}/tracks", headers=_headers(), json={"uris": [TRACK_A, TRACK_B]})
    removed = client.request("DELETE", f"{BASE}/playlists/{PLAYLIST}/tracks", headers=_headers(), json={"uris": [TRACK_A]})
    assert added.status_code == 200 and added.json() == {"snapshot_id": "snap-1"}
    assert removed.status_code == 200 and removed.json() == {"snapshot_id": "snap-1"}
    add_call, remove_call = backend.api_calls
    assert add_call.method == "POST" and add_call.url.path == f"/v1/playlists/{PLAYLIST}/items"
    assert json.loads(add_call.content) == {"uris": [TRACK_A, TRACK_B]}
    assert remove_call.method == "DELETE" and json.loads(remove_call.content) == {"items": [{"uri": TRACK_A}]}


@pytest.mark.parametrize("method", ["POST", "DELETE"])
@pytest.mark.parametrize("payload", [{}, {"uris": []}, {"uris": ["spotify:track:bad"]}, {"uris": [TRACK_A] * 101}])
def test_playlist_tracks_write_validation(monkeypatch, configured, method, payload) -> None:
    backend = FakeBackend(connection=_connection())
    backend.install(monkeypatch)
    assert _client().request(method, f"{BASE}/playlists/{PLAYLIST}/tracks", headers=_headers(), json=payload).status_code == 422
    assert _client().request(method, f"{BASE}/playlists/bad/tracks", headers=_headers(), json={"uris": [TRACK_A]}).status_code == 422
    assert backend.api_calls == []


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_playlist_tracks_write_forbidden_and_not_found(monkeypatch, configured, method) -> None:
    backend = FakeBackend(connection=_connection(), api=_forbidden)
    backend.install(monkeypatch)
    response = _client().request(method, f"{BASE}/playlists/{PLAYLIST}/tracks", headers=_headers(), json={"uris": [TRACK_A]})
    assert response.status_code == 403 and "permissão de playlists" in response.json()["detail"]
    backend.api = lambda request: httpx.Response(404, json={"error": {"status": 404}})
    response = _client().request(method, f"{BASE}/playlists/{PLAYLIST}/tracks", headers=_headers(), json={"uris": [TRACK_A]})
    assert response.status_code == 404 and "Playlist não encontrada" in response.json()["detail"]
