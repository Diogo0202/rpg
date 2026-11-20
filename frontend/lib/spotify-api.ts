import { ApiError, detailOf, type ApiResponse } from "./api/http.ts";
import { sessionSend } from "./api/session.ts";

export type SpotifyConnection = {
  enabled: boolean;
  connected: boolean;
  display_name: string | null;
  product: string | null;
  premium: boolean;
  connected_at: string | null;
  scopes?: string[];
  needs_reconnect?: boolean;
};

export type SpotifyDevice = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
  supports_volume: boolean;
};

export type SpotifyPlayer = {
  active: boolean;
  is_playing: boolean;
  progress_ms: number | null;
  device: SpotifyDevice | null;
  item: { name: string; artists: string[]; album: string | null; image_url: string | null; duration_ms: number | null; url: string | null } | null;
  context_uri: string | null;
};

/** Erro já traduzido pela API; `reconnect` diz que a conta precisa ser conectada de novo. */
export class SpotifyApiError extends ApiError {
  constructor(message: string, status: number) {
    super(message, "http", status);
    this.name = "SpotifyApiError";
  }

  get reconnect() {
    return this.status === 409 && /Conecte/.test(this.message);
  }
}

const SPOTIFY_MESSAGES = {
  missingApi: "Configure NEXT_PUBLIC_API_URL para falar com o Spotify.",
  signedOut: "Entre na sua conta para usar o Spotify.",
  network: "A API não respondeu. Confira a conexão.",
  rejected: "O pedido ao Spotify falhou.",
};

const RETURN_TO = /^\/app(\/campaign\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;

export function safeReturnPath(value: unknown): string {
  return typeof value === "string" && RETURN_TO.test(value) ? value : "/app";
}

export async function spotifyApi<T>(path: string, init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {}): Promise<T> {
  let response: ApiResponse;
  try {
    response = await sessionSend(`/api/v1/spotify${path}`, init, SPOTIFY_MESSAGES);
  } catch (error) {
    if (error instanceof ApiError) throw new SpotifyApiError(error.message, error.kind === "config" ? (error.status || 503) : 503);
    throw error;
  }
  if (!response.ok) throw new SpotifyApiError(detailOf(response.body, 500) ?? SPOTIFY_MESSAGES.rejected, response.status);
  return (response.status === 204 ? undefined : response.body) as T;
}

export type SpotifyTrack = { uri: string; id: string; name: string; artists: string[]; album: string | null; duration_ms: number | null };
export type SpotifyPlaylist = { id: string; name: string; description: string | null; public: boolean | null; owner_id: string | null; tracks_total: number; uri: string };
export type SpotifyPlayBody = {
  playlist_id?: string;
  context_uri?: string;
  uris?: string[];
  offset_uri?: string;
  position_ms?: number;
  device_id?: string;
};

export const spotifySearch = (q: string, limit = 10) =>
  spotifyApi<{ tracks: SpotifyTrack[] }>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
export const spotifyQueue = (uri: string, deviceId?: string) =>
  spotifyApi<{ ok: boolean }>("/player/queue", { method: "POST", body: { uri, ...(deviceId ? { device_id: deviceId } : {}) } });
export const spotifyPlay = (body: SpotifyPlayBody) => spotifyApi<void>("/player/play", { method: "POST", body });
export const spotifyListPlaylists = (limit = 50, offset = 0) =>
  spotifyApi<{ items: SpotifyPlaylist[]; total: number }>(`/playlists?limit=${limit}&offset=${offset}`);
export const spotifyCreatePlaylist = (body: { name: string; description?: string; public?: boolean }) =>
  spotifyApi<SpotifyPlaylist>("/playlists", { method: "POST", body });
export const spotifyUpdatePlaylist = (id: string, body: { name?: string; description?: string }) =>
  spotifyApi<{ ok: boolean }>(`/playlists/${id}`, { method: "PATCH", body });
export const spotifyPlaylistTracks = (id: string, limit = 50, offset = 0) =>
  spotifyApi<{ items: SpotifyTrack[]; total: number }>(`/playlists/${id}/tracks?limit=${limit}&offset=${offset}`);
export const spotifyAddTracks = (id: string, uris: string[]) =>
  spotifyApi<{ snapshot_id: string }>(`/playlists/${id}/tracks`, { method: "POST", body: { uris } });
export const spotifyRemoveTracks = (id: string, uris: string[]) =>
  spotifyApi<{ snapshot_id: string }>(`/playlists/${id}/tracks`, { method: "DELETE", body: { uris } });
