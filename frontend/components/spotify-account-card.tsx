"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { spotifyApi, SpotifyApiError, type SpotifyConnection, type SpotifyDevice, type SpotifyPlayBody, type SpotifyPlayer } from "../lib/spotify-api";
import styles from "./spotify-playlist-panel.module.css";

const POLL_MS = 15_000;

// What the account connection adds on top of the embedded player.
const CONNECTED_FEATURES = [
  "Play, pausa e volume sem sair da mesa",
  "Escolha do aparelho que toca a música",
  "Tocar uma playlist da campanha direto na sua conta",
];

type State = {
  connection: SpotifyConnection | null;
  player: SpotifyPlayer | null;
  devices: SpotifyDevice[];
  loading: boolean;
  busy: boolean;
  message: string;
  error: boolean;
};

const INITIAL: State = { connection: null, player: null, devices: [], loading: true, busy: false, message: "", error: false };

/** Conexão, estado do player e ações; um por painel de música. */
export function useSpotifyAccount(options: { onPlayerAction?: (player: SpotifyPlayer | null) => void } = {}) {
  const [state, setState] = useState<State>(INITIAL);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mounted = useRef(true);
  const patch = useCallback((next: Partial<State>) => {
    if (mounted.current) setState((current) => ({ ...current, ...next }));
  }, []);

  const failure = useCallback((reason: unknown, fallback: string) => {
    const error = reason instanceof SpotifyApiError ? reason : null;
    if (error?.reconnect) {
      patch({ connection: { enabled: true, connected: false, display_name: null, product: null, premium: false, connected_at: null }, player: null, devices: [] });
    }
    patch({ message: error?.message ?? fallback, error: true });
  }, [patch]);

  const refreshPlayer = useCallback(async (): Promise<SpotifyPlayer | null> => {
    try {
      const [player, devices] = await Promise.all([
        spotifyApi<SpotifyPlayer>("/player"),
        spotifyApi<{ devices: SpotifyDevice[] }>("/devices"),
      ]);
      patch({ player, devices: devices.devices });
      return player;
    } catch (reason) {
      failure(reason, "Não foi possível ler o player do Spotify.");
      return null;
    }
  }, [failure, patch]);

  const loadConnection = useCallback(async () => {
    patch({ loading: true, message: "", error: false });
    try {
      const connection = await spotifyApi<SpotifyConnection>("/connection");
      patch({ connection, loading: false });
      if (connection.connected) await refreshPlayer();
    } catch (reason) {
      patch({ loading: false });
      failure(reason, "Não foi possível consultar a conta Spotify.");
    }
  }, [failure, patch, refreshPlayer]);

  useEffect(() => {
    mounted.current = true;
    void loadConnection();
    return () => { mounted.current = false; };
  }, [loadConnection]);

  const connected = Boolean(state.connection?.connected);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPlayer();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [connected, refreshPlayer]);

  const run = useCallback(async (action: () => Promise<unknown>, done: string, fallback: string, sync = false) => {
    patch({ busy: true, message: "", error: false });
    try {
      await action();
      patch({ message: done, error: false });
      // O Spotify leva um instante para refletir o comando.
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      const player = await refreshPlayer();
      if (sync) optionsRef.current.onPlayerAction?.(player);
    } catch (reason) {
      failure(reason, fallback);
    } finally {
      patch({ busy: false });
    }
  }, [failure, patch, refreshPlayer]);

  const deviceId = state.player?.device?.id ?? state.devices.find((device) => device.is_active)?.id ?? state.devices[0]?.id;
  const device = deviceId ? { device_id: deviceId } : {};

  return {
    ...state,
    canControl: connected && Boolean(state.connection?.premium),
    reload: loadConnection,
    refreshPlayer,
    connect: async (returnTo: string) => {
      patch({ busy: true, message: "", error: false });
      try {
        const { url } = await spotifyApi<{ url: string }>("/authorize", { method: "POST", body: { return_to: returnTo } });
        if (!url.startsWith("https://accounts.spotify.com/authorize?")) throw new Error("bad url");
        window.location.assign(url);
      } catch (reason) {
        patch({ busy: false });
        failure(reason, "Não foi possível abrir a autorização do Spotify.");
      }
    },
    disconnect: async () => {
      if (!window.confirm("Desconectar sua conta Spotify do RPG-Atlas?")) return;
      patch({ busy: true, message: "", error: false });
      try {
        await spotifyApi("/connection", { method: "DELETE" });
        patch({ connection: state.connection ? { ...state.connection, connected: false, display_name: null, product: null, premium: false } : null, player: null, devices: [], message: "Conta Spotify desconectada.", error: false });
      } catch (reason) {
        failure(reason, "Não foi possível desconectar a conta.");
      } finally {
        patch({ busy: false });
      }
    },
    playPlaylist: (playlistId: string) => run(() => spotifyApi("/player/play", { method: "POST", body: { playlist_id: playlistId, ...device } }), "Playlist tocando na sua conta.", "Não foi possível tocar a playlist.", true),
    playBody: (body: SpotifyPlayBody, done = "Tocando na sua conta.") => run(() => spotifyApi("/player/play", { method: "POST", body: { ...body, ...device } }), done, "Não foi possível tocar. Confira o Premium e o aparelho.", true),
    togglePlay: () => run(
      () => spotifyApi(state.player?.is_playing ? "/player/pause" : "/player/play", { method: "POST", body: device }),
      state.player?.is_playing ? "Pausado." : "Tocando.", "O Spotify não respondeu ao comando.", true,
    ),
    skip: (direction: "next" | "previous") => run(() => spotifyApi(`/player/${direction}`, { method: "POST", body: device }), direction === "next" ? "Próxima faixa." : "Faixa anterior.", "O Spotify não trocou a faixa.", true),
    setVolume: (percent: number) => run(() => spotifyApi("/player/volume", { method: "POST", body: { percent, ...device } }), `Volume em ${percent}%.`, "O Spotify não mudou o volume."),
    transfer: (id: string) => run(() => spotifyApi("/player/transfer", { method: "POST", body: { device_id: id, play: Boolean(state.player?.is_playing) } }), "Música passada para o aparelho escolhido.", "O Spotify não trocou de aparelho."),
  };
}

export type SpotifyAccountApi = ReturnType<typeof useSpotifyAccount>;

function formatTime(ms: number | null) {
  if (ms === null) return "–";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function SpotifyAccountCard({ account, returnTo }: { account: SpotifyAccountApi; returnTo: string }) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const { connection, player, devices, loading, busy, message, error } = account;
  const [volume, setVolume] = useState<number | null>(null);
  const shownVolume = volume ?? player?.device?.volume_percent ?? null;
  const activeDeviceId = player?.device?.id ?? "";

  const pill = loading ? "Consultando" : !connection?.enabled ? "Indisponível" : !connection.connected ? "Não conectada" : connection.premium ? "Premium" : "Free";

  return (
    <aside className={styles.account} aria-labelledby={titleId} aria-busy={loading || busy}>
      <div className={styles.accountHeader}>
        <h3 id={titleId}>Conta Spotify</h3>
        <span className={`${styles.statePill} ${connection?.connected ? styles.statePillOn : ""}`}>{pill}</span>
      </div>

      {loading ? (
        <>
          <span className={styles.skeletonName} />
          <span className={styles.skeletonAction} />
        </>
      ) : connection?.connected ? (
        <>
          <p className={styles.accountText}>
            Conectada como <strong>{connection.display_name ?? "sua conta"}</strong>.
          </p>

          {connection.needs_reconnect && (
            <div className={styles.errorBox} role="alert">
              <p>Reconecte o Spotify para liberar playlists.</p>
              <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void account.connect(returnTo)}>Reconectar</button>
            </div>
          )}

          <div className={styles.nowPlaying}>
            {player?.item?.image_url
              ? <img className={styles.cover} src={player.item.image_url} alt="" width={56} height={56} />
              : <span className={styles.cover} aria-hidden="true" />}
            <div className={styles.trackInfo}>
              {player?.item ? (
                <>
                  <span className={styles.trackName}>{player.item.name}</span>
                  <span className={styles.trackMeta}>{player.item.artists.join(", ") || "Artista desconhecido"}</span>
                  <span className={styles.trackMeta}>
                    {player.is_playing ? "Tocando" : "Pausado"} · {formatTime(player.progress_ms)} de {formatTime(player.item.duration_ms)}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.trackName}>Nada tocando na sua conta</span>
                  <span className={styles.trackHint}>Abra o Spotify num aparelho ou toque uma playlist da campanha.</span>
                </>
              )}
            </div>
          </div>

          {account.canControl ? (
            <>
              <div className={styles.transport} role="group" aria-label="Controles de reprodução">
                <button className={styles.secondaryButton} type="button" disabled={busy || !player?.active} onClick={() => void account.skip("previous")}>Anterior</button>
                <button className={styles.primaryButton} type="button" disabled={busy || devices.length === 0} onClick={() => void account.togglePlay()}>
                  {player?.is_playing ? "Pausar" : "Tocar"}
                </button>
                <button className={styles.secondaryButton} type="button" disabled={busy || !player?.active} onClick={() => void account.skip("next")}>Próxima</button>
              </div>

              <label className={styles.label} htmlFor={`${uid}-device`}>Aparelho</label>
              {devices.length > 0 ? (
                <select
                  id={`${uid}-device`}
                  className={styles.input}
                  value={activeDeviceId}
                  disabled={busy}
                  onChange={(event) => { if (event.target.value) void account.transfer(event.target.value); }}
                >
                  {!activeDeviceId && <option value="">Escolha um aparelho</option>}
                  {devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.type}</option>)}
                </select>
              ) : (
                <p className={styles.help} id={`${uid}-device`}>Nenhum aparelho encontrado. Abra o Spotify no celular, no computador ou no navegador e atualize.</p>
              )}

              {player?.device?.supports_volume !== false && shownVolume !== null && (
                <div className={styles.volume}>
                  <label className={styles.label} htmlFor={`${uid}-volume`}>Volume <span className={styles.volumeValue}>{shownVolume}%</span></label>
                  <input
                    id={`${uid}-volume`}
                    className={styles.range}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={shownVolume}
                    disabled={busy}
                    onChange={(event) => setVolume(Number(event.target.value))}
                    onPointerUp={() => { if (volume !== null) { void account.setVolume(volume); setVolume(null); } }}
                    onKeyUp={() => { if (volume !== null) { void account.setVolume(volume); setVolume(null); } }}
                  />
                </div>
              )}
            </>
          ) : (
            <p className={styles.help}>
              O Spotify só deixa controlar a reprodução com uma conta Premium. O player incorporado ao lado continua tocando.
            </p>
          )}

          <div className={styles.accountActions}>
            <button className={styles.textButton} type="button" disabled={busy} onClick={() => void account.refreshPlayer()}>Atualizar</button>
            <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => void account.disconnect()}>Desconectar</button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.accountText}>
            O player ao lado usa a sua sessão do Spotify no navegador; sem login lá, ele toca trechos de 30 segundos.
          </p>
          <button
            className={connection?.enabled ? styles.primaryButton : styles.connectButton}
            type="button"
            disabled={!connection?.enabled || busy}
            aria-describedby={`${titleId}-why`}
            onClick={() => void account.connect(returnTo)}
          >
            {busy ? "Abrindo o Spotify…" : "Conectar conta"}
          </button>
          <p className={styles.help} id={`${titleId}-why`}>
            {connection?.enabled
              ? "Você autoriza no site do Spotify e volta para esta mesa. Controlar a reprodução exige Spotify Premium."
              : "A conexão com o Spotify não está ativa neste servidor."}
          </p>
          <h4 className={styles.unlockTitle}>Com a conta conectada</h4>
          <ul className={styles.unlockList}>
            {CONNECTED_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
        </>
      )}

      <p className={error ? styles.accountError : styles.status} role="status" aria-live="polite">{message}</p>
    </aside>
  );
}

