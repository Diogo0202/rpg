"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  advanceCombatTurn, appendParticipantsToCombat, blankCombatState, CombatStateError, parseCombatState, type CombatState,
} from "../lib/combat-state";
import { applyRowChange, connectionLabel, startRealtimeSync, type RealtimeConnection, type RowChange } from "../lib/realtime-sync";
import { createClient } from "../lib/supabase/client";
import { downloadText } from "../lib/download";
import { CampaignPresence } from "./campaign-presence";
import { CampaignChat } from "./campaign-chat";
import styles from "./scene-mode-panel.module.css";

type Scene = { id: string; campaign_id: string; title: string; state: unknown; active: boolean; created_by: string; version: number; created_at: string };
type SceneNote = { id: string; combat_id: string; actor_id: string; event_type: string; payload: { description?: string }; created_at: string };

const SCENE_COLUMNS = "id,campaign_id,title,state,active,created_by,version,created_at";
function slug(value: string) { return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "cena"; }

export function SceneModePanel({ campaignId, viewerId, canManage }: { campaignId: string; viewerId: string; canManage: boolean }) {
  const uid = useId();
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const requestRef = useRef(0);
  const scenesRef = useRef<Scene[]>([]);
  const syncRef = useRef<{ reconnectNow(): void } | null>(null);
  const [scenes, setScenesState] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<SceneNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [live, setLive] = useState<RealtimeConnection>("connecting");
  const [titleDraft, setTitleDraft] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [initiativeDraft, setInitiativeDraft] = useState("0");
  const [noteDraft, setNoteDraft] = useState("");

  function setScenes(update: Scene[] | ((rows: Scene[]) => Scene[])) {
    setScenesState((rows) => {
      const next = typeof update === "function" ? update(rows) : update;
      scenesRef.current = next;
      return next;
    });
  }

  async function refresh(requestCampaign = campaignId, silent = false) {
    const request = ++requestRef.current;
    if (!silent) setLoading(true);
    try {
      const client = createClient();
      const { data, error } = await client.from("combat_sessions").select(SCENE_COLUMNS).eq("campaign_id", requestCampaign).order("created_at", { ascending: false });
      if (error) throw error;
      if (request !== requestRef.current || campaignRef.current !== requestCampaign) return;
      const rows = (data ?? []) as Scene[];
      setScenes(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
      const activeIds = rows.map((row) => row.id);
      if (activeIds.length) {
        const result = await client.from("combat_events").select("id,combat_id,actor_id,event_type,payload,created_at").in("combat_id", activeIds).eq("event_type", "notes").order("created_at", { ascending: false }).limit(500);
        if (result.error) throw result.error;
        if (request === requestRef.current && campaignRef.current === requestCampaign) setNotes((result.data ?? []) as SceneNote[]);
      } else setNotes([]);
      if (!silent) setMessage("");
    } catch {
      if (request === requestRef.current && campaignRef.current === requestCampaign) setMessage("Não foi possível atualizar as cenas. Tente novamente.");
    } finally {
      if (request === requestRef.current && campaignRef.current === requestCampaign) setLoading(false);
    }
  }

  useEffect(() => {
    setScenes([]); setNotes([]); setSelectedId(null); setBusy(false); setMessage(""); setLive("connecting");
    void refresh(campaignId);
    let active = true;
    let client: ReturnType<typeof createClient>;
    try { client = createClient(); } catch { setLive("offline"); return () => { active = false; requestRef.current += 1; }; }
    // Combat rows and their notes arrive through postgres_changes; RLS limits them to campaign members.
    const sync = startRealtimeSync<RealtimeChannel>({
      client,
      topic: `combat-sync-${campaignId}`,
      bind: (channel) => channel
        .on("postgres_changes", { event: "*", schema: "public", table: "combat_sessions", filter: `campaign_id=eq.${campaignId}` }, (payload) => {
          if (!active) return;
          const change = { eventType: payload.eventType, new: payload.new, old: payload.old } as RowChange<Scene>;
          if (change.eventType !== "DELETE" && (change.new as Scene).campaign_id !== campaignId) return;
          setScenes((rows) => applyRowChange(rows, change));
          if (change.eventType === "DELETE") setSelectedId((current) => current === change.old.id ? null : current);
          else setSelectedId((current) => current ?? (change.new as Scene).id);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "combat_events" }, (payload) => {
          if (!active) return;
          const note = payload.new as SceneNote;
          if (note?.event_type !== "notes" || !scenesRef.current.some((scene) => scene.id === note.combat_id)) return;
          setNotes((rows) => rows.some((row) => row.id === note.id) ? rows : [note, ...rows]);
        }),
      onStatus: (status) => { if (active) setLive(status); },
      // Every (re)subscribe re-reads the snapshot, so changes missed while offline are recovered.
      onResync: () => { if (active) void refresh(campaignId, true); },
    });
    syncRef.current = sync;
    return () => { active = false; requestRef.current += 1; syncRef.current = null; sync.stop(); };
  }, [campaignId]);

  const selected = scenes.find((scene) => scene.id === selectedId) ?? null;
  const state = selected ? parseCombatState(selected.state) : null;
  const sceneNotes = selected ? notes.filter((note) => note.combat_id === selected.id) : [];
  const current = state?.participants[state.turn] ?? null;
  const canEdit = canManage && Boolean(selected?.active) && !busy;

  async function createScene(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (!canManage || !title || title.length > 160 || busy) return;
    const requestCampaign = campaignId;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await createClient().from("combat_sessions").insert({ campaign_id: requestCampaign, title, state: blankCombatState(), active: true, created_by: viewerId }).select(SCENE_COLUMNS).single();
      if (error) throw error;
      if (campaignRef.current !== requestCampaign) return;
      setTitleDraft("");
      if (data) { setScenes((rows) => applyRowChange(rows, { eventType: "INSERT", new: data as Scene })); setSelectedId((data as Scene).id); }
      setMessage("Cena criada e salva.");
    } catch { if (campaignRef.current === requestCampaign) setMessage("Não foi possível criar a cena."); }
    finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  /** Writes the whole state guarded by the version we rendered; a conflict reloads the latest row. */
  async function saveState(next: CombatState, success: string): Promise<boolean> {
    if (!selected || !canManage || !selected.active || busy) return false;
    const requestCampaign = campaignId;
    const sceneId = selected.id;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await createClient().from("combat_sessions").update({ state: next }).eq("id", sceneId).eq("campaign_id", requestCampaign).eq("version", selected.version).select(SCENE_COLUMNS).maybeSingle();
      if (error || !data) throw error ?? new Error("stale scene");
      if (campaignRef.current !== requestCampaign) return false;
      setScenes((rows) => applyRowChange(rows, { eventType: "UPDATE", new: data as Scene }));
      setMessage(success);
      return true;
    } catch {
      if (campaignRef.current === requestCampaign) { setMessage("Outro dispositivo alterou a cena antes. A versão atual foi carregada; repita a ação se ainda fizer sentido."); await refresh(requestCampaign, true); }
      return false;
    } finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !canEdit || !selected) return;
    const requestCampaign = campaignId;
    setBusy(true); setMessage("");
    try {
      // Same path the generators use: re-reads, merges and retries on version conflicts.
      await appendParticipantsToCombat(createClient(), { campaignId: requestCampaign, combatId: selected.id }, [{ name: participantName, initiative: Number(initiativeDraft) }]);
      if (campaignRef.current !== requestCampaign) return;
      setParticipantName(""); setInitiativeDraft("0");
      setMessage("Participante incluído na ordem de iniciativa.");
      await refresh(requestCampaign, true);
    } catch (problem) {
      if (campaignRef.current === requestCampaign) setMessage(problem instanceof CombatStateError ? problem.message : "Não foi possível incluir o participante.");
    } finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  function advanceTurn() {
    if (!state || !state.participants.length || state.paused) return;
    const next = advanceCombatTurn(state);
    void saveState(next, next.turn === 0 ? "Nova rodada iniciada." : "Turno avançado.");
  }
  function resetScene() { if (state) void saveState({ ...state, round: 1, turn: 0, paused: false }, "Rodada e turno reiniciados."); }
  function togglePause() { if (state) void saveState({ ...state, paused: !state.paused }, state.paused ? "Cena retomada." : "Cena pausada."); }

  async function closeScene() {
    if (!selected || !canManage || !selected.active || busy || !window.confirm(`Encerrar a cena “${selected.title}”?`)) return;
    const requestCampaign = campaignId;
    const sceneId = selected.id;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await createClient().from("combat_sessions").update({ active: false }).eq("id", sceneId).eq("campaign_id", requestCampaign).eq("version", selected.version).select(SCENE_COLUMNS).maybeSingle();
      if (error || !data) throw error ?? new Error("stale scene");
      if (campaignRef.current === requestCampaign) { setScenes((rows) => applyRowChange(rows, { eventType: "UPDATE", new: data as Scene })); setMessage("Cena encerrada."); }
    } catch { if (campaignRef.current === requestCampaign) { setMessage("A cena mudou ou não foi encerrada. A versão atual foi carregada."); await refresh(requestCampaign, true); } }
    finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !noteDraft.trim() || noteDraft.trim().length > 4000 || busy) return;
    const requestCampaign = campaignId;
    const combatId = selected.id;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await createClient().from("combat_events").insert({ combat_id: combatId, actor_id: viewerId, event_type: "notes", payload: { description: noteDraft.trim() } }).select("id,combat_id,actor_id,event_type,payload,created_at").single();
      if (error) throw error;
      if (campaignRef.current !== requestCampaign) return;
      const note = data as SceneNote;
      setNotes((rows) => rows.some((row) => row.id === note.id) ? rows : [note, ...rows]);
      setNoteDraft(""); setMessage("Nota salva na cena.");
    } catch { if (campaignRef.current === requestCampaign) setMessage("Não foi possível salvar a nota."); }
    finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  function exportScene() {
    if (!selected || !state) return;
    const exportData = { format: "rpg-nexus-scene-v1", exported_at: new Date().toISOString(), scene: { title: selected.title, active: selected.active, state, notes: sceneNotes.map((note) => ({ actor: note.actor_id === viewerId ? "Você" : "Membro", description: note.payload.description ?? "", created_at: note.created_at })) } };
    downloadText(`${slug(selected.title)}.json`, JSON.stringify(exportData, null, 2));
    setMessage("JSON da cena exportado.");
  }

  return <section className={styles.panel} aria-labelledby={`${uid}-title`} aria-busy={loading || busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>MESA EM ANDAMENTO</p><h2 id={`${uid}-title`}>Modo de cena</h2><p className={styles.intro}>Iniciativa, turnos e notas sincronizados entre os dispositivos da campanha.</p></div><div className={styles.actions}><span className={`${styles.live} ${styles[live]}`} role="status" aria-live="polite"><span className={styles.liveDot} aria-hidden="true" />{connectionLabel(live)}</span>{live !== "connected" && <button type="button" className={styles.secondaryButton} onClick={() => syncRef.current?.reconnectNow()}>Reconectar</button>}<button type="button" className={styles.secondaryButton} disabled={loading || busy} onClick={() => void refresh()}>Atualizar</button></div></header>
    <CampaignPresence campaignId={campaignId} viewerId={viewerId} canManage={canManage} />
    <CampaignChat campaignId={campaignId} viewerId={viewerId} canManage={canManage} />
    <p className={styles.message} role="status" aria-live="polite">{message}</p>
    {canManage && <form className={styles.createForm} onSubmit={createScene}><label htmlFor={`${uid}-title-draft`}>Nova cena<input id={`${uid}-title-draft`} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={160} required placeholder="Nome da cena" /></label><button className={styles.primaryButton} disabled={busy || !titleDraft.trim()}>Criar cena</button></form>}
    {loading ? <p className={styles.empty}>Carregando cenas…</p> : scenes.length ? <>
      <div className={styles.sceneSelect}><label htmlFor={`${uid}-scene`}>Cena<select id={`${uid}-scene`} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}{scene.active ? " · ativa" : " · encerrada"}</option>)}</select></label><button type="button" className={styles.secondaryButton} disabled={!selected || !state} onClick={exportScene}>Exportar JSON</button></div>
      {selected && !state ? <p className={styles.error} role="alert">O estado salvo desta cena tem dados inválidos.</p> : selected && state ? <>
        <section className={styles.statusCard}><div><p className={styles.eyebrow}>{selected.active ? state.paused ? "CENA PAUSADA" : "CENA ATIVA" : "CENA ENCERRADA"}</p><h3>{selected.title}</h3><p>Rodada {state.round}{current ? ` · turno de ${current.name}` : " · sem participantes"} · v{selected.version}</p></div>{canManage && selected.active && <div className={styles.actions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={togglePause}>{state.paused ? "Retomar" : "Pausar"}</button><button type="button" className={styles.secondaryButton} disabled={busy} onClick={resetScene}>Reiniciar</button><button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void closeScene()}>Encerrar</button></div>}</section>
        <div className={styles.columns}><section className={styles.subpanel}><div className={styles.subhead}><div><p className={styles.eyebrow}>ORDEM DE AÇÃO</p><h3>Iniciativa</h3></div><span className={styles.count}>{state.participants.length}/50</span></div>
          {state.participants.length ? <ol className={styles.participantList}>{state.participants.map((item, index) => <li key={item.id} className={index === state.turn && selected.active ? styles.currentTurn : undefined}><span className={styles.rank}>{index + 1}</span><strong>{item.name}{typeof item.health === "number" && typeof item.health_max === "number" ? <small> · Saúde {item.health}/{item.health_max}</small> : null}</strong><span className={styles.initiative}>{item.initiative}</span><span className={styles.turnMark}>{index === state.turn && selected.active ? "Turno atual" : ""}</span></li>)}</ol> : <p className={styles.empty}>Inclua participantes para ordenar a iniciativa.</p>}
          {canManage && selected.active && <form className={styles.participantForm} onSubmit={addParticipant}><label htmlFor={`${uid}-participant`}>Participante<input id={`${uid}-participant`} value={participantName} onChange={(event) => setParticipantName(event.target.value)} maxLength={120} required disabled={busy} /></label><label htmlFor={`${uid}-initiative`}>Iniciativa<input id={`${uid}-initiative`} type="number" min="0" max="1000" value={initiativeDraft} onChange={(event) => setInitiativeDraft(event.target.value)} required disabled={busy} /></label><button className={styles.primaryButton} disabled={!canEdit || state.participants.length >= 50}>Adicionar</button></form>}
          {canManage && selected.active && <button type="button" className={styles.primaryButton} disabled={!canEdit || state.paused || !state.participants.length} onClick={advanceTurn}>Avançar turno</button>}
        </section><section className={styles.subpanel}><div className={styles.subhead}><div><p className={styles.eyebrow}>REGISTRO DA CENA</p><h3>Notas</h3></div><span className={styles.count}>{sceneNotes.length}</span></div><form className={styles.noteForm} onSubmit={addNote}><label htmlFor={`${uid}-note`}>Nova nota<textarea id={`${uid}-note`} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={4000} rows={3} placeholder="Registre um acontecimento" /></label><button className={styles.secondaryButton} disabled={busy || !noteDraft.trim()}>Salvar nota</button></form>{sceneNotes.length ? <ol className={styles.notes}>{sceneNotes.map((note) => <li key={note.id}><p>{note.payload.description ?? "Nota sem descrição."}</p><small>{note.actor_id === viewerId ? "Você" : "Membro da campanha"} · {new Date(note.created_at).toLocaleString("pt-BR")}</small></li>)}</ol> : <p className={styles.empty}>Nenhuma nota nesta cena.</p>}</section></div>
      </> : null}
    </> : <p className={styles.empty}>{canManage ? "Nenhuma cena salva nesta campanha." : "O narrador ainda não criou cenas nesta campanha."}</p>}
  </section>;
}
