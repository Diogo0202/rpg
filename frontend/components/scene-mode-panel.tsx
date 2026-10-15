"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { downloadText } from "../lib/download";
import styles from "./scene-mode-panel.module.css";

type Participant = { id: string; name: string; initiative: number };
type SceneState = { round: number; turn: number; participants: Participant[]; paused: boolean };
type Scene = { id: string; campaign_id: string; title: string; state: unknown; active: boolean; created_by: string; version: number; created_at: string };
type SceneNote = { id: string; combat_id: string; actor_id: string; event_type: string; payload: { description?: string }; created_at: string };

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function parseState(value: unknown): SceneState | null {
  if (!isRecord(value) || !Number.isInteger(value.round) || (value.round as number) < 1 || !Number.isInteger(value.turn) || (value.turn as number) < 0 || typeof value.paused !== "boolean" || !Array.isArray(value.participants) || value.participants.length > 50) return null;
  const ids = new Set<string>();
  const participants: Participant[] = [];
  for (const item of value.participants) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 || !Number.isFinite(item.initiative) || (item.initiative as number) < 0 || (item.initiative as number) > 1000) return null;
    ids.add(item.id);
    participants.push({ id: item.id, name: item.name, initiative: item.initiative as number });
  }
  if (participants.length && (value.turn as number) >= participants.length) return null;
  return { round: value.round as number, turn: value.turn as number, participants: participants.sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name)), paused: value.paused };
}
function blankState(): SceneState { return { round: 1, turn: 0, participants: [], paused: false }; }
function slug(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "cena"; }

export function SceneModePanel({ campaignId, viewerId, canManage }: { campaignId: string; viewerId: string; canManage: boolean }) {
  const uid = useId();
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const requestRef = useRef(0);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<SceneNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [initiativeDraft, setInitiativeDraft] = useState("0");
  const [noteDraft, setNoteDraft] = useState("");

  async function refresh(requestCampaign = campaignId) {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const client = createClient();
      const { data, error } = await client.from("combat_sessions").select("id,campaign_id,title,state,active,created_by,version,created_at").eq("campaign_id", requestCampaign).order("created_at", { ascending: false });
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
      setMessage("");
    } catch {
      if (request === requestRef.current && campaignRef.current === requestCampaign) setMessage("Não foi possível atualizar as cenas. Tente novamente.");
    } finally {
      if (request === requestRef.current && campaignRef.current === requestCampaign) setLoading(false);
    }
  }

  useEffect(() => {
    setScenes([]); setNotes([]); setSelectedId(null); setBusy(false); setMessage("");
    void refresh(campaignId);
    return () => { requestRef.current += 1; };
  }, [campaignId]);

  const selected = scenes.find((scene) => scene.id === selectedId) ?? null;
  const state = selected ? parseState(selected.state) : null;
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
      const { data, error } = await createClient().from("combat_sessions").insert({ campaign_id: requestCampaign, title, state: blankState(), active: true, created_by: viewerId }).select("id").single();
      if (error) throw error;
      if (campaignRef.current !== requestCampaign) return;
      setTitleDraft("");
      await refresh(requestCampaign);
      if (data?.id && campaignRef.current === requestCampaign) setSelectedId(data.id);
      setMessage("Cena criada e salva.");
    } catch { if (campaignRef.current === requestCampaign) setMessage("Não foi possível criar a cena."); }
    finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  async function saveState(next: SceneState, success: string): Promise<boolean> {
    if (!selected || !canManage || !selected.active || busy) return false;
    const requestCampaign = campaignId;
    const sceneId = selected.id;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await createClient().from("combat_sessions").update({ state: next }).eq("id", sceneId).eq("campaign_id", requestCampaign).eq("version", selected.version).select("id").maybeSingle();
      if (error || !data) throw error ?? new Error("stale scene");
      if (campaignRef.current !== requestCampaign || selectedId !== sceneId) return false;
      setScenes((rows) => rows.map((row) => row.id === sceneId ? { ...row, state: next, version: row.version + 1 } : row));
      setMessage(success);
      return true;
    } catch {
      if (campaignRef.current === requestCampaign && selectedId === sceneId) { setMessage("A cena mudou ou não foi salva. Atualize para receber a versão atual."); await refresh(requestCampaign); }
      return false;
    } finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !canEdit) return;
    const name = participantName.trim();
    const initiative = Number(initiativeDraft);
    if (!name || name.length > 120 || !Number.isFinite(initiative) || initiative < 0 || initiative > 1000) { setMessage("Informe nome e iniciativa entre 0 e 1000."); return; }
    if (state.participants.length >= 50) { setMessage("A cena atingiu o limite de 50 participantes."); return; }
    if (state.participants.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setMessage("Já existe um participante com esse nome."); return; }
    const activeId = state.participants[state.turn]?.id;
    const participants = [...state.participants, { id: crypto.randomUUID(), name, initiative }].sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
    const turn = Math.max(0, participants.findIndex((item) => item.id === activeId));
    const saved = await saveState({ ...state, participants, turn }, "Participante incluído na ordem de iniciativa.");
    if (saved) { setParticipantName(""); setInitiativeDraft("0"); }
  }

  function advanceTurn() {
    if (!state || !state.participants.length || state.paused) return;
    const turn = (state.turn + 1) % state.participants.length;
    void saveState({ ...state, turn, round: turn === 0 ? state.round + 1 : state.round }, turn === 0 ? "Nova rodada iniciada." : "Turno avançado.");
  }
  function resetScene() { if (state) void saveState({ ...state, round: 1, turn: 0, paused: false }, "Rodada e turno reiniciados."); }
  function togglePause() { if (state) void saveState({ ...state, paused: !state.paused }, state.paused ? "Cena retomada." : "Cena pausada."); }

  async function closeScene() {
    if (!selected || !canManage || !selected.active || busy || !window.confirm(`Encerrar a cena “${selected.title}”?`)) return;
    const requestCampaign = campaignId;
    const sceneId = selected.id;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await createClient().from("combat_sessions").update({ active: false }).eq("id", sceneId).eq("campaign_id", requestCampaign).eq("version", selected.version).select("id").maybeSingle();
      if (error || !data) throw error ?? new Error("stale scene");
      if (campaignRef.current === requestCampaign && selectedId === sceneId) { setScenes((rows) => rows.map((row) => row.id === sceneId ? { ...row, active: false, version: row.version + 1 } : row)); setMessage("Cena encerrada."); }
    } catch { if (campaignRef.current === requestCampaign && selectedId === sceneId) { setMessage("A cena mudou ou não foi encerrada. Atualize a lista."); await refresh(requestCampaign); } }
    finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !noteDraft.trim() || noteDraft.trim().length > 4000 || busy) return;
    const requestCampaign = campaignId;
    const combatId = selected.id;
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().from("combat_events").insert({ combat_id: combatId, actor_id: viewerId, event_type: "notes", payload: { description: noteDraft.trim() } });
      if (error) throw error;
      if (campaignRef.current !== requestCampaign || selectedId !== combatId) return;
      setNoteDraft(""); await refresh(requestCampaign); setMessage("Nota salva na cena.");
    } catch { if (campaignRef.current === requestCampaign && selectedId === combatId) setMessage("Não foi possível salvar a nota."); }
    finally { if (campaignRef.current === requestCampaign) setBusy(false); }
  }

  function exportScene() {
    if (!selected || !state) return;
    const exportData = { format: "rpg-nexus-scene-v1", exported_at: new Date().toISOString(), scene: { title: selected.title, active: selected.active, state, notes: sceneNotes.map((note) => ({ actor: note.actor_id === viewerId ? "Você" : "Membro", description: note.payload.description ?? "", created_at: note.created_at })) } };
    downloadText(`${slug(selected.title)}.json`, JSON.stringify(exportData, null, 2));
    setMessage("JSON da cena exportado.");
  }

  return <section className={styles.panel} aria-labelledby={`${uid}-title`} aria-busy={loading || busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>MESA EM ANDAMENTO</p><h2 id={`${uid}-title`}>Modo de cena</h2><p className={styles.intro}>Iniciativa, turnos e notas salvos na campanha.</p></div><button type="button" className={styles.secondaryButton} disabled={loading || busy} onClick={() => void refresh()}>Atualizar</button></header>
    <p className={styles.message} role="status" aria-live="polite">{message}</p>
    {canManage && <form className={styles.createForm} onSubmit={createScene}><label htmlFor={`${uid}-title-draft`}>Nova cena<input id={`${uid}-title-draft`} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={160} required placeholder="Nome da cena" /></label><button className={styles.primaryButton} disabled={busy || !titleDraft.trim()}>Criar cena</button></form>}
    {loading ? <p className={styles.empty}>Carregando cenas…</p> : scenes.length ? <>
      <div className={styles.sceneSelect}><label htmlFor={`${uid}-scene`}>Cena<select id={`${uid}-scene`} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}{scene.active ? " · ativa" : " · encerrada"}</option>)}</select></label><button type="button" className={styles.secondaryButton} disabled={!selected || !state} onClick={exportScene}>Exportar JSON</button></div>
      {selected && !state ? <p className={styles.error} role="alert">O estado salvo desta cena tem dados inválidos.</p> : selected && state ? <>
        <section className={styles.statusCard}><div><p className={styles.eyebrow}>{selected.active ? state.paused ? "CENA PAUSADA" : "CENA ATIVA" : "CENA ENCERRADA"}</p><h3>{selected.title}</h3><p>Rodada {state.round}{current ? ` · turno de ${current.name}` : " · sem participantes"}</p></div>{canManage && selected.active && <div className={styles.actions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={togglePause}>{state.paused ? "Retomar" : "Pausar"}</button><button type="button" className={styles.secondaryButton} disabled={busy} onClick={resetScene}>Reiniciar</button><button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void closeScene()}>Encerrar</button></div>}</section>
        <div className={styles.columns}><section className={styles.subpanel}><div className={styles.subhead}><div><p className={styles.eyebrow}>ORDEM DE AÇÃO</p><h3>Iniciativa</h3></div><span className={styles.count}>{state.participants.length}/50</span></div>
          {state.participants.length ? <ol className={styles.participantList}>{state.participants.map((item, index) => <li key={item.id} className={index === state.turn && selected.active ? styles.currentTurn : undefined}><span className={styles.rank}>{index + 1}</span><strong>{item.name}</strong><span className={styles.initiative}>{item.initiative}</span><span className={styles.turnMark}>{index === state.turn && selected.active ? "Turno atual" : ""}</span></li>)}</ol> : <p className={styles.empty}>Inclua participantes para ordenar a iniciativa.</p>}
          {canManage && selected.active && <form className={styles.participantForm} onSubmit={addParticipant}><label htmlFor={`${uid}-participant`}>Participante<input id={`${uid}-participant`} value={participantName} onChange={(event) => setParticipantName(event.target.value)} maxLength={120} required disabled={busy} /></label><label htmlFor={`${uid}-initiative`}>Iniciativa<input id={`${uid}-initiative`} type="number" min="0" max="1000" value={initiativeDraft} onChange={(event) => setInitiativeDraft(event.target.value)} required disabled={busy} /></label><button className={styles.primaryButton} disabled={!canEdit || state.participants.length >= 50}>Adicionar</button></form>}
          {canManage && selected.active && <button type="button" className={styles.primaryButton} disabled={!canEdit || state.paused || !state.participants.length} onClick={advanceTurn}>Avançar turno</button>}
        </section><section className={styles.subpanel}><div className={styles.subhead}><div><p className={styles.eyebrow}>REGISTRO DA CENA</p><h3>Notas</h3></div><span className={styles.count}>{sceneNotes.length}</span></div><form className={styles.noteForm} onSubmit={addNote}><label htmlFor={`${uid}-note`}>Nova nota<textarea id={`${uid}-note`} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={4000} rows={3} placeholder="Registre um acontecimento" /></label><button className={styles.secondaryButton} disabled={busy || !noteDraft.trim()}>Salvar nota</button></form>{sceneNotes.length ? <ol className={styles.notes}>{sceneNotes.map((note) => <li key={note.id}><p>{note.payload.description ?? "Nota sem descrição."}</p><small>{note.actor_id === viewerId ? "Você" : "Membro da campanha"} · {new Date(note.created_at).toLocaleString("pt-BR")}</small></li>)}</ol> : <p className={styles.empty}>Nenhuma nota nesta cena.</p>}</section></div>
      </> : null}
    </> : <p className={styles.empty}>{canManage ? "Nenhuma cena salva nesta campanha." : "O narrador ainda não criou cenas nesta campanha."}</p>}
  </section>;
}
