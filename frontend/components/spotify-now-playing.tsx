"use client";

import { useEffect, useRef, useState } from "react";

import { spotifyApi } from "../lib/spotify-api";
import { followPlayPayload, parseSpotifyUri, type NowPlayingState } from "../lib/spotify-sync";
import type { SpotifyAccountApi } from "./spotify-account-card";
import styles from "./spotify-playlist-panel.module.css";

/** Faixa para jogadores: mostra o que o narrador toca e, se quiserem, acompanha na própria conta. */
export function SpotifyNowPlayingBanner({ state, account, returnTo }: { state: NowPlayingState | null; account: SpotifyAccountApi; returnTo: string }) {
  const [follow, setFollow] = useState(false);
  const [note, setNote] = useState("");
  const lastKey = useRef("");
  const canFollow = account.canControl;
  const context = state?.context_uri ? parseSpotifyUri(state.context_uri) : null;
  const active = Boolean(state && (state.track_uri || state.context_uri) && state.is_playing);
  const label = state?.track_name ?? (context ? "uma playlist da campanha" : "");

  const key = state ? `${state.updated_at ?? ""}|${state.context_uri}|${state.track_uri}|${state.is_playing}` : "";
  useEffect(() => {
    if (!follow || !canFollow || !state || key === lastKey.current) return;
    lastKey.current = key;
    let cancelled = false;
    (async () => {
      try {
        if (state.is_playing) {
          const payload = followPlayPayload(state, Date.now());
          if (payload) await account.playBody(payload, "Acompanhando o narrador.");
        } else {
          await spotifyApi("/player/pause", { method: "POST", body: {} });
          await account.refreshPlayer();
        }
        if (!cancelled) setNote("");
      } catch {
        if (!cancelled) setNote("Não foi possível acompanhar o narrador. Confira o aparelho e o Premium.");
      }
    })();
    return () => { cancelled = true; };
    // account muda a cada render; só reagimos a mudanças do estado do narrador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, canFollow, key]);

  if (!state || (!state.track_uri && !state.context_uri)) return null;

  return (
    <div className={styles.banner} role="region" aria-label="Música do narrador">
      <p className={styles.bannerText}>
        {active ? <>O narrador está tocando: <strong>{label}</strong></> : <>O narrador pausou a música{label ? <>: <strong>{label}</strong></> : null}.</>}
      </p>
      {canFollow ? (
        <label className={styles.followToggle}>
          <input type="checkbox" checked={follow} onChange={(event) => { lastKey.current = ""; setFollow(event.target.checked); }} />
          Acompanhar
        </label>
      ) : account.connection?.connected && account.connection.needs_reconnect ? (
        <button className={styles.primaryButton} type="button" onClick={() => void account.connect(returnTo)}>Reconecte o Spotify para liberar playlists</button>
      ) : context && active ? (
        <iframe
          className={styles.embed}
          title="Player do Spotify da playlist do narrador"
          src={`https://open.spotify.com/embed/${context.kind}/${context.id}?utm_source=generator`}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      ) : (
        <p className={styles.help}>Conecte uma conta Spotify Premium para acompanhar o narrador automaticamente.</p>
      )}
      {note && <p className={styles.accountError} role="status">{note}</p>}
    </div>
  );
}
