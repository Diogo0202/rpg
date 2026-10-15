"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
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
  const currentCampaignId = useRef(campaignId);
  currentCampaignId.current = campaignId;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCampaignPlaylists() {
      setLoading(true);
      setCanManage(false);
      setPlaylists([]);
      setInput("");
      setMessage("");

      try {
        const supabase = createClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error("A sessão não está disponível.");

        const [ownerResult, memberResult, playlistResult] = await Promise.all([
          supabase.from("campaigns").select("id").eq("id", campaignId).eq("owner_id", authData.user.id).maybeSingle(),
          supabase.from("campaign_members").select("role").eq("campaign_id", campaignId).eq("user_id", authData.user.id).maybeSingle(),
          supabase.from("campaign_playlist_links").select("playlist_id").eq("campaign_id", campaignId).order("created_at"),
        ]);

        if (ownerResult.error || memberResult.error || playlistResult.error) {
          throw new Error("Não foi possível consultar os dados da campanha.");
        }

        if (!active) return;
        setCanManage(Boolean(ownerResult.data || memberResult.data?.role === "master" || memberResult.data?.role === "owner"));
        setPlaylists(playlistResult.data.flatMap((row): Playlist[] => {
          const playlist = parsePlaylistUrl(`https://open.spotify.com/playlist/${row.playlist_id}`);
          return playlist ? [playlist] : [];
        }));
      } catch {
        if (active) setMessage("Não foi possível carregar as playlists. Confira sua sessão e a conexão.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadCampaignPlaylists();
    return () => { active = false; };
  }, [campaignId]);

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
      const supabase = createClient();
      const { error } = await supabase.from("campaign_playlist_links").insert({
        campaign_id: requestCampaignId,
        playlist_id: playlist.id,
      });
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

  async function removePlaylist(playlistId: string) {
    const requestCampaignId = campaignId;
    setRemovingId(playlistId);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("campaign_playlist_links")
        .delete()
        .eq("campaign_id", requestCampaignId)
        .eq("playlist_id", playlistId);
      if (currentCampaignId.current !== requestCampaignId) return;
      if (error) {
        setMessage("Não foi possível remover o link desta campanha.");
        return;
      }

      setPlaylists((current) => current.filter((item) => item.id !== playlistId));
      setMessage("Playlist removida desta campanha.");
    } catch {
      if (currentCampaignId.current === requestCampaignId) {
        setMessage("Não foi possível remover o link. Confira sua sessão e a conexão.");
      }
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={titleId} aria-busy={loading}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>TRILHA DA MESA</p>
          <h2 id={titleId}>Playlists do Spotify</h2>
        </div>
        <span className={styles.count} aria-label={`${playlists.length} playlists salvas`}>
          {playlists.length}
        </span>
      </div>

      <p className={styles.description}>
        Guarde links para abrir durante a sessão. A lista fica salva na campanha e acompanha os membros autorizados em outros dispositivos.
      </p>

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
              placeholder="https://open.spotify.com/playlist/..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-describedby={`${helpId} ${messageId}`}
              disabled={loading || saving}
            />
            <button className={styles.addButton} type="submit" disabled={loading || saving}>
              {saving ? "Salvando…" : "Salvar link"}
            </button>
          </div>
          <p className={styles.help} id={helpId}>Aceita links HTTPS de playlists públicas do Spotify.</p>
        </form>
      )}

      <p className={styles.status} id={messageId} role="status" aria-live="polite">{message}</p>

      {loading ? <p className={styles.empty}>Carregando playlists da campanha…</p> : playlists.length > 0 ? (
        <ul className={styles.list} aria-label="Playlists salvas nesta campanha">
          {playlists.map((playlist, index) => (
            <li className={styles.item} key={playlist.id}>
              <div className={styles.playlistInfo}>
                <span className={styles.playlistNumber}>Playlist {index + 1}</span>
                <code className={styles.playlistId}>{playlist.id}</code>
              </div>
              <div className={styles.actions}>
                <a className={styles.openLink} href={playlist.url} target="_blank" rel="noopener noreferrer">
                  Abrir Spotify <span className={styles.srOnly}>, abre em nova aba</span>
                </a>
                {canManage && (
                  <button
                    className={styles.removeButton}
                    type="button"
                    onClick={() => void removePlaylist(playlist.id)}
                    disabled={removingId === playlist.id}
                    aria-label={`Remover playlist ${index + 1}`}
                  >
                    {removingId === playlist.id ? "Removendo…" : "Remover"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{canManage ? "Nenhum link salvo nesta campanha." : "Nenhuma playlist visível nesta campanha."}</p>
      )}

      <p className={styles.scope}>
        Este painel guarda e abre links da campanha. Ele não conecta à sua conta Spotify nem toca música dentro do RPG Nexus.
      </p>
    </section>
  );
}
