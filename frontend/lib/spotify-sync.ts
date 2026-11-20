export type SpotifyUriKind = "playlist" | "album" | "track";
export type ParsedSpotifyUri = { kind: SpotifyUriKind; id: string; uri: string };

export type NowPlayingState = {
  campaign_id?: string;
  context_uri: string | null;
  track_uri: string | null;
  track_name: string | null;
  position_ms: number;
  is_playing: boolean;
  started_at: string | null;
  updated_at?: string;
  updated_by?: string | null;
};

const URI = /^spotify:(playlist|album|track):([0-9A-Za-z]{22})$/;
const URL_PATH = /^\/(?:intl-[a-z]{2}\/)?(playlist|album|track)\/([0-9A-Za-z]{22})\/?$/;

/** Aceita URI (spotify:track:ID) ou link https://open.spotify.com/...; devolve null se inválido. */
export function parseSpotifyUri(value: string): ParsedSpotifyUri | null {
  const text = value.trim();
  const direct = text.match(URI);
  if (direct) return { kind: direct[1] as SpotifyUriKind, id: direct[2], uri: text };
  try {
    const url = new URL(text);
    const match = url.pathname.match(URL_PATH);
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.port !== "" || url.username !== "" || url.password !== "" || !match) return null;
    return { kind: match[1] as SpotifyUriKind, id: match[2], uri: `spotify:${match[1]}:${match[2]}` };
  } catch {
    return null;
  }
}

export function isValidSpotifyUri(uri: string, kinds: readonly SpotifyUriKind[] = ["playlist", "album", "track"]): boolean {
  const match = uri.match(URI);
  return Boolean(match && kinds.includes(match[1] as SpotifyUriKind));
}

export function playlistUriFromId(id: string): string | null {
  return /^[0-9A-Za-z]{22}$/.test(id) ? `spotify:playlist:${id}` : null;
}

/** Posição estimada agora: position_ms mais o tempo decorrido desde started_at, se estiver tocando. */
export function currentPositionMs(state: Pick<NowPlayingState, "position_ms" | "is_playing" | "started_at">, nowMs: number): number {
  let position = state.position_ms;
  if (state.is_playing && state.started_at) {
    const started = Date.parse(state.started_at);
    if (Number.isFinite(started)) position += nowMs - started;
  }
  return Math.max(0, Math.round(position));
}

export type FollowPlayPayload =
  | { context_uri: string; offset_uri?: string; position_ms: number }
  | { uris: string[]; position_ms: number };

/** Corpo de /player/play para acompanhar o narrador; null quando não há o que tocar. */
export function followPlayPayload(state: NowPlayingState, nowMs: number): FollowPlayPayload | null {
  const position_ms = currentPositionMs(state, nowMs);
  if (state.context_uri) {
    return state.track_uri
      ? { context_uri: state.context_uri, offset_uri: state.track_uri, position_ms }
      : { context_uri: state.context_uri, position_ms };
  }
  if (state.track_uri) return { uris: [state.track_uri], position_ms };
  return null;
}

type PlayerLike = {
  is_playing: boolean;
  progress_ms: number | null;
  item: { name: string; artists: string[]; url: string | null } | null;
  context_uri: string | null;
} | null;

/** Converte o retorno de GET /player no estado publicado para a mesa. */
export function nowPlayingFromPlayer(player: PlayerLike, nowMs: number): Pick<NowPlayingState, "context_uri" | "track_uri" | "track_name" | "position_ms" | "is_playing" | "started_at"> {
  const context = player?.context_uri && isValidSpotifyUri(player.context_uri, ["playlist", "album"]) ? player.context_uri : null;
  const parsedTrack = player?.item?.url ? parseSpotifyUri(player.item.url) : null;
  const track = parsedTrack?.kind === "track" ? parsedTrack.uri : null;
  const name = player?.item ? [player.item.name, player.item.artists.join(", ")].filter(Boolean).join(" · ").slice(0, 300) : null;
  return {
    context_uri: context,
    track_uri: track,
    track_name: name,
    position_ms: Math.min(86_400_000, Math.max(0, Math.round(player?.progress_ms ?? 0))),
    is_playing: Boolean(player?.is_playing),
    started_at: new Date(nowMs).toISOString(),
  };
}
