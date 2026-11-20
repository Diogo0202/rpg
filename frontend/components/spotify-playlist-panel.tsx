"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";

import { browserDb, currentUserId } from "../lib/data/browser";
import { memberRole } from "../lib/data/campaign";
import * as music from "../lib/data/music";
import { useCampaignNowPlaying } from "../lib/use-campaign-now-playing";
import { nowPlayingFromPlayer } from "../lib/spotify-sync";
import type { SpotifyPlayer } from "../lib/spotify-api";
import { SpotifyAccountCard, useSpotifyAccount } from "./spotify-account-card";
import { SpotifyNowPlayingBanner } from "./spotify-now-playing";
import { PlaylistTracks, SpotifyPlaylistEditor } from "./spotify-playlist-editor";
import styles from "./spotify-playlist-panel.module.css";

type Playlist = { id: string; url: string };

const PLAYLIST_PATH = /^\/playlist\/([A-Za-z0-9]{22})$/;

function parsePlaylistUrl(value: string): Playlist | null {
  try {
    const parsed = new URL(value.trim());
    const match = parsed.pathname.match(PLAYLIST_PATH);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "open.spotify.com" ||
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !match
    ) {
      return null;
    }

    return { id: match[1], url: `https://open.spotify.com/playlist/${match[1]}` };
  } catch {
    return null;
  }
}

export default function SpotifyPlaylistPanel({ campaignId }: { campaignId: string }) {
  const id = useId();
  const inputId = `${id}-spotify-playlist-url`;
  const helpId = `${id}-spotify-playlist-help`;
  const messageId = `${id}-spotify-playlist-message`;
  const titleId = `${id}-spotify-playlists-title`;
  const canManageRef = useRef(false);
  const nowPlaying = useCampaignNowPlaying(campaignId);
  const publishRef = useRef(nowPlaying.publish);
  publishRef.current = nowPlaying.publish;
  // O narrador publica o que está tocando depois de cada ação de reprodução.
  const account = useSpotifyAccount({
    onPlayerAction: (player: SpotifyPlayer | null) => {
      if (canManageRef.current && player) void publishRef.current(nowPlayingFromPlayer(player, Date.now()));
    },
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const currentCampaignId = useRef(campaignId);
  currentCampaignId.current = campaignId;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadCampaignPlaylists() {
      setLoading(true);
      setLoadFailed(false);
      setCanManage(false);
      setPlaylists([]);
      setPlayingId(null);
      setInput("");
      setMessage("");

      try {
        const userId = await currentUserId();
        if (!userId) throw new Error("A sessão não está disponível.");

        const db = browserDb();
        const [ownerResult, memberResult, playlistResult] = await Promise.all([
          music.ownedCampaign(db, campaignId, userId),
          memberRole(db, campaignId, userId),
          music.listPlaylistLinks(db, campaignId),
        ]);

        if (ownerResult.error || memberResult.error || playlistResult.error) {
          throw new Error("Não foi possível consultar os dados da campanha.");
        }

        if (!active) return;
        const manage = Boolean(ownerResult.data || memberResult.data?.role === "master" || memberResult.data?.role === "owner");
        canManageRef.current = manage;
        setCanManage(manage);
        setPlaylists(playlistResult.data.flatMap((row): Playlist[] => {
          const playlist = parsePlaylistUrl(`https://open.spotify.com/playlist/${row.playlist_id}`);
          return playlist ? [playlist] : [];
        }));
      } catch {
        if (active) setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadCampaignPlaylists();
    return () => { active = false; };
  }, [campaignId, reloadKey]);

  async function addPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestCampaignId = campaignId;
    const playlist = parsePlaylistUrl(input);

    if (!playlist) {
      setMessage("Cole um link HTTPS de playlist do Spotify com o ID completo.");
      return;
    }
    if (playlists.some((item) => item.id === playlist.id)) {
      setMessage("Esta playlist já está nesta campanha.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await music.linkPlaylist(browserDb(), requestCampaignId, playlist.id);
      if (currentCampaignId.current !== requestCampaignId) return;
      if (error) {
        setMessage(error.code === "23505" ? "Esta playlist já está nesta campanha." : "Não foi possível salvar o link nesta campanha.");
        return;
      }

      setPlaylists((current) => [...current, playlist]);
      setInput("");
      setMessage("Playlist salva e sincronizada com esta campanha.");
    } catch {
      if (currentCampaignId.current === requestCampaignId) {
        setMessage("Não foi possível salvar o link. Confira sua sessão e a conexão.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function removePlaylist(playlistId: string, position: number) {
    if (!window.confirm(`Remover a playlist ${position} desta campanha?`)) return;
    const requestCampaignId = campaignId;
    setRemovingId(playlistId);
    try {
      const { error } = await music.unlinkPlaylist(browserDb(), requestCampaignId, playlistId);
      if (currentCampaignId.current !== requestCampaignId) return;
      if (error) {
        setMessage("Não foi possível remover o link desta campanha.");
        return;
      }

      setPlaylists((current) => current.filter((item) => item.id !== playlistId));
      setPlayingId((current) => (current === playlistId ? null : current));
      setMessage("Playlist removida desta campanha.");
    } catch {
      if (currentCampaignId.current === requestCampaignId) {
        setMessage("Não foi possível remover o link. Confira sua sessão e a conexão.");
      }
    } finally {
      setRemovingId(null);
    }
  }

  const playingIndex = playlists.findIndex((item) => item.id === playingId);
  const countLine = loading
    ? "Carregando as playlists da campanha…"
    : loadFailed
      ? "As playlists da campanha não carregaram."
      : playlists.length === 0
      ? "Nenhuma playlist salva nesta campanha."
      : `${playlists.length} ${playlists.length === 1 ? "playlist salva" : "playlists salvas"} nesta campanha, visíveis a todos os membros.`;

  return (
    <section className={styles.panel} aria-labelledby={titleId} aria-busy={loading}>
      <header className={styles.header}>
        <h2 id={titleId}>Playlists do Spotify</h2>
        <p className={styles.subline}>{countLine}</p>
      </header>

      <div className={styles.layout}>
        <div className={styles.main}>
          <div className={styles.player} aria-live="polite">
            {playingIndex >= 0 ? (
              <iframe
                key={playlists[playingIndex].id}
                className={styles.embed}
                title={`Player do Spotify, playlist ${playingIndex + 1}`}
                src={`https://open.spotify.com/embed/playlist/${playlists[playingIndex].id}?utm_source=generator`}
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
              />
            ) : (
              <div className={styles.playerEmpty}>
                <p className={styles.playerTitle}>Nada tocando</p>
                <p>
                  {playlists.length > 0
                    ? "Escolha “Tocar aqui” numa playlist para abrir o player do Spotify neste painel."
                    : loadFailed
                      ? "O player abre quando as playlists da campanha carregarem."
                      : "Salve uma playlist da campanha para tocá-la aqui."}
                </p>
              </div>
            )}
          </div>

          {!canManage && (
            <SpotifyNowPlayingBanner state={nowPlaying.state} account={account} returnTo={`/app/campaign/${campaignId}`} />
          )}

          {canManage && (
            <SpotifyPlaylistEditor
              campaignId={campaignId}
              playlistIds={playlists.map((item) => item.id)}
              account={account}
              onCreated={() => setReloadKey((key) => key + 1)}
            />
          )}

          {canManage && (
            <form className={styles.form} onSubmit={addPlaylist}>
              <label className={styles.label} htmlFor={inputId}>Link da playlist</label>
              <div className={styles.inputRow}>
                <input
                  id={inputId}
                  className={styles.input}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://open.spotify.com/playlist/…"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  aria-describedby={`${helpId} ${messageId}`}
                  disabled={loading || saving}
                />
                <button className={styles.primaryButton} type="submit" disabled={loading || saving}>
                  {saving ? "Salvando…" : "Salvar link"}
                </button>
              </div>
              <p className={styles.help} id={helpId}>Aceita links HTTPS de playlists públicas do Spotify.</p>
            </form>
          )}

          <p className={styles.status} id={messageId} role="status" aria-live="polite">{message}</p>

          {loading ? (
            <ul className={styles.list} aria-hidden="true">
              {[0, 1].map((row) => (
                <li className={styles.item} key={row}>
                  <span className={styles.skeletonName} />
                  <span className={styles.skeletonAction} />
                </li>
              ))}
            </ul>
          ) : loadFailed ? (
            <div className={styles.errorBox}>
              <p>Não foi possível carregar as playlists. Confira sua sessão e a conexão.</p>
              <button className={styles.textButton} type="button" onClick={() => setReloadKey((key) => key + 1)}>Tentar de novo</button>
            </div>
          ) : playlists.length > 0 ? (
            <ul className={styles.list} aria-label="Playlists salvas nesta campanha">
              {playlists.map((playlist, index) => {
                const playing = playlist.id === playingId;
                return (
                  <li className={`${styles.item} ${playing ? styles.itemPlaying : ""}`} key={playlist.id}>
                    <div className={styles.playlistInfo}>
                      <span className={styles.playlistName}>
                        Playlist {index + 1}
                        {playing && <span className={styles.playingTag}>No player</span>}
                      </span>
                      <code className={styles.playlistId}>{playlist.id}</code>
                    </div>
                    <div className={styles.actions}>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        aria-pressed={playing}
                        onClick={() => setPlayingId(playing ? null : playlist.id)}
                      >
                        {playing ? "Fechar player" : "Tocar aqui"}
                      </button>
                      {account.canControl && (
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          disabled={account.busy}
                          onClick={() => void account.playPlaylist(playlist.id)}
                          aria-label={`Tocar a playlist ${index + 1} na sua conta Spotify`}
                        >
                          Tocar na conta
                        </button>
                      )}
                      <a className={styles.textButton} href={playlist.url} target="_blank" rel="noopener noreferrer">
                        Abrir no Spotify <span className={styles.srOnly}>, abre em nova aba</span>
                      </a>
                      {canManage && account.connection?.connected && (
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          aria-expanded={expandedId === playlist.id}
                          onClick={() => setExpandedId(expandedId === playlist.id ? null : playlist.id)}
                        >
                          {expandedId === playlist.id ? "Fechar faixas" : "Faixas"}
                        </button>
                      )}
                      {canManage && (
                        <button
                          className={styles.dangerButton}
                          type="button"
                          onClick={() => void removePlaylist(playlist.id, index + 1)}
                          disabled={removingId === playlist.id}
                          aria-label={`Remover playlist ${index + 1}`}
                        >
                          {removingId === playlist.id ? "Removendo…" : "Remover"}
                        </button>
                      )}
                    </div>
                    {canManage && expandedId === playlist.id && (
                      <div style={{ flexBasis: "100%" }}><PlaylistTracks playlistId={playlist.id} label={`playlist ${index + 1}`} /></div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.emptyBox}>
              {canManage ? "Nenhum link salvo. Cole acima o link de uma playlist para a mesa." : "O mestre ainda não salvou playlists nesta campanha."}
            </p>
          )}
        </div>

        <SpotifyAccountCard account={account} returnTo={`/app/campaign/${campaignId}`} />
      </div>
    </section>
  );
}


