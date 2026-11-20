"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";

import { browserDb } from "../lib/data/browser";
import * as music from "../lib/data/music";
import { checkedAudioUrl } from "../lib/audio-url";
import { downloadText } from "../lib/download";
import { spotifyApi, spotifyPlay, type SpotifyPlayer } from "../lib/spotify-api";
import { nowPlayingFromPlayer, parseSpotifyUri, playlistUriFromId } from "../lib/spotify-sync";
import { useCampaignNowPlaying } from "../lib/use-campaign-now-playing";
import { spotifyErrorMessage } from "./spotify-playlist-editor";
import styles from "./music-cues-panel.module.css";

type SceneType = "arrival" | "exploration" | "intrigue" | "tension" | "combat" | "aftermath" | "rest";
type MusicCue = { id: string; campaign_id: string; session_id: string | null; title: string; scene_type: SceneType; duration_seconds: number; brief: string; notes: string; audio_url: string | null; spotify_uri: string | null; version: number; created_at: string; updated_at: string };
type CampaignSession = { id: string; title: string; sequence: number };
type CueDraft = { title: string; sessionId: string; sceneType: SceneType; durationSeconds: string; brief: string; notes: string; audioUrl: string; spotifyUri: string };

const SCENE_TYPES: Record<SceneType, string> = { arrival: "Chegada", exploration: "Exploração", intrigue: "Intriga", tension: "Tensão", combat: "Combate", aftermath: "Consequência", rest: "Descanso" };
const EMPTY_DRAFT: CueDraft = { title: "", sessionId: "", sceneType: "exploration", durationSeconds: "120", brief: "", notes: "", audioUrl: "", spotifyUri: "" };
function cueSlug(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "referencia-musical"; }
function emptyDraft(): CueDraft { return { ...EMPTY_DRAFT }; }

export function MusicCuesPanel({ campaignId, canManage }: { campaignId: string; canManage: boolean }) {
  const uid = useId();
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const requestRef = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);
  const [cues, setCues] = useState<MusicCue[]>([]);
  const [sessions, setSessions] = useState<CampaignSession[]>([]);
  const [sessionFilter, setSessionFilter] = useState("all");
  const [editing, setEditing] = useState<MusicCue | null>(null);
  const [draft, setDraft] = useState<CueDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playlistIds, setPlaylistIds] = useState<string[]>([]);
  const nowPlaying = useCampaignNowPlaying(campaignId);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const requestCampaign = campaignId;
    let active = true;
    setCues([]); setSessions([]); setSessionFilter("all"); setEditing(null); setDraft(emptyDraft()); setBusy(false); setMessage(""); setLoading(true);
    async function load() {
      const request = ++requestRef.current;
      try {
        const db = browserDb();
        const [cueResult, sessionResult, linkResult] = await Promise.all([
          music.listCues(db, requestCampaign),
          music.listSessionTitles(db, requestCampaign),
          music.listPlaylistLinks(db, requestCampaign),
        ]);
        if (!active || request !== requestRef.current || campaignRef.current !== requestCampaign) return;
        if (cueResult.error) throw cueResult.error;
        if (sessionResult.error) throw sessionResult.error;
        setCues((cueResult.data ?? []) as MusicCue[]);
        setSessions((sessionResult.data ?? []) as CampaignSession[]);
        setPlaylistIds((linkResult.data ?? []).map((row) => String(row.playlist_id)));
        setMessage("");
      } catch {
        if (active && request === requestRef.current && campaignRef.current === requestCampaign) setMessage("Não foi possível carregar as referências musicais da campanha.");
      } finally {
        if (active && request === requestRef.current && campaignRef.current === requestCampaign) setLoading(false);
      }
    }
    refreshRef.current = () => void load();
    void load();
    return () => { active = false; requestRef.current += 1; refreshRef.current = () => undefined; };
  }, [campaignId]);

  const filteredCues = cues.filter((cue) => sessionFilter === "all" || cue.session_id === sessionFilter);
  function beginEdit(cue: MusicCue) {
    setEditing(cue);
    setDraft({ title: cue.title, sessionId: cue.session_id ?? "", sceneType: cue.scene_type, durationSeconds: String(cue.duration_seconds), brief: cue.brief, notes: cue.notes, audioUrl: cue.audio_url ?? "", spotifyUri: cue.spotify_uri ?? "" });
    setMessage("");
  }
  function beginNew() { setEditing(null); setDraft(emptyDraft()); setMessage(""); }
  function field<K extends keyof CueDraft>(key: K, value: CueDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); }

  async function saveCue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    const title = draft.title.trim();
    const brief = draft.brief.trim();
    const notes = draft.notes.trim();
    const duration = Number(draft.durationSeconds);
    const audioUrl = checkedAudioUrl(draft.audioUrl);
    if (title.length < 3 || title.length > 160) { setMessage("O título precisa ter de 3 a 160 caracteres."); return; }
    if (!Number.isInteger(duration) || duration < 30 || duration > 3600) { setMessage("A duração precisa ficar entre 30 e 3600 segundos."); return; }
    if (brief.length > 8000 || notes.length > 2000) { setMessage("Confira o limite de 8000 caracteres no brief e 2000 nas notas."); return; }
    if (draft.audioUrl.trim() && audioUrl === null) { setMessage("Informe uma URL HTTPS válida, sem usuário ou senha, com até 2048 caracteres."); return; }
    const spotifyParsed = draft.spotifyUri.trim() ? parseSpotifyUri(draft.spotifyUri) : null;
    if (draft.spotifyUri.trim() && !spotifyParsed) { setMessage("Informe um link ou URI de faixa, álbum ou playlist do Spotify."); return; }
    const requestCampaign = campaignId;
    const snapshot = editing;
    const values = { session_id: draft.sessionId || null, title, scene_type: draft.sceneType, duration_seconds: duration, brief, notes, audio_url: audioUrl, spotify_uri: spotifyParsed?.uri ?? null };
    setBusy(true); setMessage("");
    try {
      const result = snapshot
        ? await music.updateCue(browserDb(), snapshot, requestCampaign, values)
        : await music.insertCue(browserDb(), requestCampaign, values);
      if (result.error || !result.data) throw result.error ?? new Error("stale cue");
      if (campaignRef.current !== requestCampaign) return;
      setEditing(null); setDraft(emptyDraft());
      refreshRef.current();
      setMessage(snapshot ? "Referência musical atualizada." : "Referência musical salva.");
    } catch {
      if (campaignRef.current === requestCampaign) { setMessage("A gravação falhou ou a referência mudou. Atualize a lista e tente de novo."); if (snapshot) refreshRef.current(); }
    } finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  async function deleteCue(cue: MusicCue) {
    if (!canManage || busy || !window.confirm(`Excluir “${cue.title}”?`)) return;
    const requestCampaign = campaignId;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await music.deleteCue(browserDb(), cue, requestCampaign);
      if (error || !data) throw error ?? new Error("stale cue");
      if (campaignRef.current !== requestCampaign) return;
      if (editing?.id === cue.id) beginNew();
      refreshRef.current(); setMessage("Referência musical removida.");
    } catch {
      if (campaignRef.current === requestCampaign) { setMessage("A referência mudou ou não foi removida. Atualize a lista."); refreshRef.current(); }
    } finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  async function playCue(cue: MusicCue) {
    if (!canManage || busy || !cue.spotify_uri) return;
    const parsed = parseSpotifyUri(cue.spotify_uri);
    if (!parsed) return;
    setBusy(true); setMessage("");
    try {
      await spotifyPlay(parsed.kind === "track" ? { uris: [parsed.uri] } : { context_uri: parsed.uri });
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      let player: SpotifyPlayer | null = null;
      try { player = await spotifyApi<SpotifyPlayer>("/player"); } catch { /* publica só o que se sabe */ }
      const now = Date.now();
      const published = player
        ? nowPlayingFromPlayer(player, now)
        : { context_uri: parsed.kind === "track" ? null : parsed.uri, track_uri: parsed.kind === "track" ? parsed.uri : null, track_name: cue.title.slice(0, 300), position_ms: 0, is_playing: true, started_at: new Date(now).toISOString() };
      await nowPlaying.publish(published);
      setMessage(`Cena “${cue.title}” tocando para a mesa.`);
    } catch (reason) {
      setMessage(spotifyErrorMessage(reason, "Não foi possível tocar a cena."));
    } finally { setBusy(false); }
  }

  function exportJson() {
    const sessionNames = new Map(sessions.map((session) => [session.id, `Sessão ${session.sequence}: ${session.title}`]));
    const content = { format: "rpg-nexus-music-cues-v1", exported_at: new Date().toISOString(), cues: filteredCues.map((cue) => ({ title: cue.title, session: cue.session_id ? sessionNames.get(cue.session_id) ?? null : null, scene_type: cue.scene_type, duration_seconds: cue.duration_seconds, brief: cue.brief, notes: cue.notes, audio_url: cue.audio_url, spotify_uri: cue.spotify_uri })) };
    downloadText(`referencias-musicais-${cueSlug(sessionFilter === "all" ? "campanha" : sessionNames.get(sessionFilter) ?? "sessao")}.json`, JSON.stringify(content, null, 2));
    setMessage("JSON exportado.");
  }

  return <section className={styles.panel} aria-labelledby={`${uid}-title`} aria-busy={loading || busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>ARQUIVO SONORO</p><h2 id={`${uid}-title`}>Ambientação musical</h2><p className={styles.intro}>Briefs, notas e faixas vinculadas às cenas da campanha.</p></div><div className={styles.headerActions}><button type="button" className={styles.secondaryButton} disabled={loading || busy} onClick={() => refreshRef.current()}>Atualizar</button><button type="button" className={styles.secondaryButton} disabled={loading || !filteredCues.length} onClick={exportJson}>Exportar JSON</button></div></header>
    <p className={styles.message} role="status" aria-live="polite">{message}</p>
    <div className={styles.toolbar}><label htmlFor={`${uid}-session-filter`}>Filtrar por sessão<select id={`${uid}-session-filter`} value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}><option value="all">Todas as sessões</option>{sessions.map((session) => <option key={session.id} value={session.id}>Sessão {session.sequence}: {session.title}</option>)}</select></label><span className={styles.count}>{filteredCues.length} referência(s)</span>{canManage && <button type="button" className={styles.primaryButton} disabled={busy} onClick={beginNew}>Nova referência</button>}</div>
    {canManage && <form className={styles.form} onSubmit={saveCue}>
      <div className={styles.formHeading}><div><p className={styles.eyebrow}>{editing ? "EDIÇÃO" : "NOVA ENTRADA"}</p><h3>{editing ? "Editar referência" : "Preservar referência musical"}</h3></div>{editing && <button type="button" className={styles.textButton} disabled={busy} onClick={beginNew}>Cancelar edição</button>}</div>
      <div className={styles.fields}><label htmlFor={`${uid}-title`}>Título<input id={`${uid}-title`} value={draft.title} minLength={3} maxLength={160} required onChange={(event) => field("title", event.target.value)} /></label><label htmlFor={`${uid}-session`}>Sessão<select id={`${uid}-session`} value={draft.sessionId} onChange={(event) => field("sessionId", event.target.value)}><option value="">Sem vínculo</option>{sessions.map((session) => <option key={session.id} value={session.id}>Sessão {session.sequence}: {session.title}</option>)}</select></label><label htmlFor={`${uid}-scene-type`}>Tipo de cena<select id={`${uid}-scene-type`} value={draft.sceneType} onChange={(event) => field("sceneType", event.target.value as SceneType)}>{Object.entries(SCENE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label htmlFor={`${uid}-duration`}>Duração em segundos<input id={`${uid}-duration`} type="number" min="30" max="3600" step="1" required value={draft.durationSeconds} onChange={(event) => field("durationSeconds", event.target.value)} /></label><label className={styles.wideField} htmlFor={`${uid}-brief`}>Brief<textarea id={`${uid}-brief`} rows={5} maxLength={8000} value={draft.brief} onChange={(event) => field("brief", event.target.value)} /><small>{draft.brief.length}/8000</small></label><label className={styles.wideField} htmlFor={`${uid}-notes`}>Notas<textarea id={`${uid}-notes`} rows={3} maxLength={2000} value={draft.notes} onChange={(event) => field("notes", event.target.value)} /><small>{draft.notes.length}/2000</small></label><label className={styles.wideField} htmlFor={`${uid}-audio-url`}>URL de áudio HTTPS<input id={`${uid}-audio-url`} type="url" maxLength={2048} value={draft.audioUrl} placeholder="https://…" onChange={(event) => field("audioUrl", event.target.value)} /><small>Reprodução começa somente quando alguém aciona os controles.</small></label></div>
      <label className={styles.wideField} htmlFor={`${uid}-spotify`}>Spotify (faixa, álbum ou playlist)<select aria-label="Escolher playlist da campanha" value="" onChange={(event) => { const uri = playlistUriFromId(event.target.value); if (uri) field("spotifyUri", uri); }}><option value="">Escolher playlist da campanha…</option>{playlistIds.map((id, index) => <option key={id} value={id}>Playlist {index + 1} ({id.slice(0, 6)}…)</option>)}</select><input id={`${uid}-spotify`} value={draft.spotifyUri} maxLength={200} placeholder="https://open.spotify.com/track/… ou spotify:playlist:…" onChange={(event) => field("spotifyUri", event.target.value)} /><small>Usado por “Tocar cena” na conta Spotify do narrador.</small></label>
      <div className={styles.actions}><button type="submit" className={styles.primaryButton} disabled={busy}>{editing ? "Salvar alterações" : "Salvar referência"}</button></div>
    </form>}
    {loading ? <p className={styles.empty}>Carregando referências…</p> : filteredCues.length ? <ul className={styles.list}>{filteredCues.map((cue) => <li className={styles.cue} key={cue.id}>
      <div className={styles.cueHeader}><div><p className={styles.eyebrow}>{SCENE_TYPES[cue.scene_type]}{cue.session_id && sessions.find((session) => session.id === cue.session_id) ? ` · Sessão ${sessions.find((session) => session.id === cue.session_id)?.sequence}` : ""}</p><h3>{cue.title}</h3></div><span className={styles.duration}>{Math.floor(cue.duration_seconds / 60)}m {cue.duration_seconds % 60}s</span></div>
      {cue.brief && <p className={styles.brief}>{cue.brief}</p>}{cue.notes && <p className={styles.notes}><strong>Notas</strong> {cue.notes}</p>}
      {checkedAudioUrl(cue.audio_url ?? "") ? <audio className={styles.audio} controls preload="none" src={checkedAudioUrl(cue.audio_url ?? "") ?? undefined}>Seu navegador não reproduz este áudio.</audio> : <p className={styles.noAudio}>Nenhuma faixa vinculada.</p>}
      {canManage && <div className={styles.actions}>{cue.spotify_uri && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void playCue(cue)}>Tocar cena</button>}<button type="button" className={styles.textButton} disabled={busy} onClick={() => beginEdit(cue)}>Editar</button><button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void deleteCue(cue)}>Excluir</button></div>}
    </li>)}</ul> : <p className={styles.empty}>{sessionFilter === "all" ? "Nenhuma referência musical salva nesta campanha." : "Nenhuma referência vinculada a esta sessão."}</p>}
  </section>;
}

