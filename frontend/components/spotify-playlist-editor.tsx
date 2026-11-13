"use client";

import { FormEvent, useEffect, useId, useState } from "react";

import { createClient } from "../lib/supabase/client";
import {
  SpotifyApiError, spotifyAddTracks, spotifyCreatePlaylist, spotifyPlaylistTracks, spotifyQueue,
  spotifyRemoveTracks, spotifySearch, spotifyUpdatePlaylist, type SpotifyTrack,
} from "../lib/spotify-api";
import type { SpotifyAccountApi } from "./spotify-account-card";
import styles from "./spotify-playlist-panel.module.css";

export function spotifyErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof SpotifyApiError) {
    if (reason.reconnect) return "Reconecte o Spotify para liberar playlists.";
    if (reason.status === 403) return "O Spotify negou o pedido. Confira se a conta é Premium, se a playlist é sua e se você reconectou para liberar playlists.";
    return reason.message;
  }
  return fallback;
}

const trackLine = (track: SpotifyTrack) => `${track.name} · ${track.artists.join(", ") || "Artista desconhecido"}`;

/** Edição de uma playlist: renomear, listar e remover faixas. */
export function PlaylistTracks({ playlistId, label }: { playlistId: string; label: string }) {
  const uid = useId();
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setTracks(null);
    spotifyPlaylistTracks(playlistId)
      .then((result) => { if (active) setTracks(result.items); })
      .catch((reason) => { if (active) { setTracks([]); setMessage(spotifyErrorMessage(reason, "Não foi possível listar as faixas.")); } });
    return () => { active = false; };
  }, [playlistId]);

  async function rename(event: FormEvent) {
    event.preventDefault();
    const body: { name?: string; description?: string } = {};
    if (name.trim()) body.name = name.trim().slice(0, 100);
    if (description.trim()) body.description = description.trim().slice(0, 300);
    if (!body.name && !body.description) { setMessage("Informe um novo nome ou descrição."); return; }
    setBusy(true);
    try {
      await spotifyUpdatePlaylist(playlistId, body);
      setMessage("Playlist atualizada no Spotify.");
      setName(""); setDescription("");
    } catch (reason) {
      setMessage(spotifyErrorMessage(reason, "Não foi possível atualizar a playlist."));
    } finally { setBusy(false); }
  }

  async function remove(track: SpotifyTrack) {
    setBusy(true);
    try {
      await spotifyRemoveTracks(playlistId, [track.uri]);
      setTracks((current) => current?.filter((item) => item.uri !== track.uri) ?? current);
      setMessage("Faixa removida.");
    } catch (reason) {
      setMessage(spotifyErrorMessage(reason, "Não foi possível remover a faixa."));
    } finally { setBusy(false); }
  }

  return (
    <div className={styles.subForm}>
      <form className={styles.form} onSubmit={rename}>
        <label className={styles.label} htmlFor={`${uid}-name`}>Novo nome de {label}</label>
        <input id={`${uid}-name`} className={styles.input} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <label className={styles.label} htmlFor={`${uid}-desc`}>Nova descrição</label>
        <input id={`${uid}-desc`} className={styles.input} maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} />
        <div><button className={styles.secondaryButton} type="submit" disabled={busy}>Salvar nome e descrição</button></div>
      </form>
      {tracks === null ? <p className={styles.help}>Carregando faixas…</p> : tracks.length === 0 ? <p className={styles.help}>Nenhuma faixa listada.</p> : (
        <ul className={styles.trackList} aria-label={`Faixas de ${label}`}>
          {tracks.map((track) => (
            <li className={styles.trackItem} key={track.uri}>
              <div><span className={styles.playlistName}>{track.name}</span><span className={styles.help}>{track.artists.join(", ")}</span></div>
              <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => void remove(track)} aria-label={`Remover ${track.name} da playlist`}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.status} role="status" aria-live="polite">{message}</p>
    </div>
  );
}

type EditorProps = {
  campaignId: string;
  playlistIds: string[];
  account: SpotifyAccountApi;
  onCreated: (playlistId: string) => void;
};

/** Criar playlist e buscar faixas para adicionar à playlist ou à fila. Só para quem gerencia a campanha. */
export function SpotifyPlaylistEditor({ campaignId, playlistIds, account, onCreated }: EditorProps) {
  const uid = useId();
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const connected = Boolean(account.connection?.connected);
  const effectiveTarget = playlistIds.includes(target) ? target : (playlistIds[0] ?? "");

  useEffect(() => {
    const text = query.trim();
    if (!connected || text.length < 2) { setResults([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      spotifySearch(text, 8)
        .then((result) => { if (active) setResults(result.tracks); })
        .catch((reason) => { if (active) { setResults([]); setMessage(spotifyErrorMessage(reason, "A busca do Spotify falhou.")); } });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, connected]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (name.length < 1 || name.length > 100) { setMessage("O nome da playlist precisa ter de 1 a 100 caracteres."); return; }
    setBusy(true); setMessage("");
    try {
      const playlist = await spotifyCreatePlaylist({ name, ...(newDescription.trim() ? { description: newDescription.trim().slice(0, 300) } : {}) });
      const { error } = await createClient().from("campaign_playlist_links").insert({ campaign_id: campaignId, playlist_id: playlist.id });
      if (error && error.code !== "23505") { setMessage("A playlist foi criada no Spotify, mas não foi vinculada à campanha."); return; }
      onCreated(playlist.id);
      setNewName(""); setNewDescription("");
      setMessage("Playlist criada e vinculada à campanha.");
    } catch (reason) {
      setMessage(spotifyErrorMessage(reason, "Não foi possível criar a playlist."));
    } finally { setBusy(false); }
  }

  async function addToPlaylist(track: SpotifyTrack) {
    if (!effectiveTarget) { setMessage("Escolha uma playlist da campanha."); return; }
    setBusy(true);
    try {
      await spotifyAddTracks(effectiveTarget, [track.uri]);
      setMessage(`“${track.name}” adicionada à playlist.`);
    } catch (reason) {
      setMessage(spotifyErrorMessage(reason, "Não foi possível adicionar a faixa."));
    } finally { setBusy(false); }
  }

  async function enqueue(track: SpotifyTrack) {
    setBusy(true);
    try {
      await spotifyQueue(track.uri, account.player?.device?.id);
      setMessage(`“${track.name}” entrou na fila.`);
    } catch (reason) {
      setMessage(spotifyErrorMessage(reason, "Não foi possível adicionar à fila."));
    } finally { setBusy(false); }
  }

  if (!connected) return null;

  return (
    <div className={styles.subForm}>
      <form className={styles.form} onSubmit={create}>
        <label className={styles.label} htmlFor={`${uid}-new`}>Criar playlist</label>
        <div className={styles.inputRow}>
          <input id={`${uid}-new`} className={styles.input} maxLength={100} placeholder="Nome da playlist" value={newName} onChange={(event) => setNewName(event.target.value)} disabled={busy} />
          <button className={styles.primaryButton} type="submit" disabled={busy}>Criar playlist</button>
        </div>
        <input className={styles.input} maxLength={300} placeholder="Descrição (opcional)" aria-label="Descrição da nova playlist" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} disabled={busy} />
      </form>

      <label className={styles.label} htmlFor={`${uid}-search`}>Buscar faixas</label>
      <input id={`${uid}-search`} className={styles.input} type="search" placeholder="Nome da faixa ou artista" value={query} onChange={(event) => setQuery(event.target.value)} />
      {playlistIds.length > 0 && (
        <>
          <label className={styles.label} htmlFor={`${uid}-target`}>Playlist de destino</label>
          <select id={`${uid}-target`} className={styles.input} value={effectiveTarget} onChange={(event) => setTarget(event.target.value)}>
            {playlistIds.map((id, index) => <option key={id} value={id}>Playlist {index + 1} ({id.slice(0, 6)}…)</option>)}
          </select>
        </>
      )}
      {results.length > 0 && (
        <ul className={styles.trackList} aria-label="Resultados da busca">
          {results.map((track) => (
            <li className={styles.trackItem} key={track.uri}>
              <div><span className={styles.playlistName}>{track.name}</span><span className={styles.help}>{trackLine(track).split(" · ").slice(1).join(" · ")}</span></div>
              <div className={styles.actions}>
                <button className={styles.secondaryButton} type="button" disabled={busy || !effectiveTarget} onClick={() => void addToPlaylist(track)}>Adicionar à playlist</button>
                {account.canControl && <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void enqueue(track)}>Na fila</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.status} role="status" aria-live="polite">{message}</p>
    </div>
  );
}
