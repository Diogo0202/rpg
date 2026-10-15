"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import styles from "./campaign-journal-panel.module.css";

type SessionStatus = "planned" | "played" | "archived";
type EventStatus = "planned" | "active" | "resolved" | "failed" | "consequence";

type CampaignSession = {
  id: string;
  campaign_id: string;
  sequence: number;
  title: string;
  summary: string;
  status: SessionStatus;
  played_on: string | null;
  created_at: string;
  updated_at: string;
};

type CampaignFaction = {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  goal: string;
  tension: number;
  limit: number;
  consequence: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type CampaignEvent = {
  id: string;
  campaign_id: string;
  session_id: string | null;
  faction_id: string | null;
  title: string;
  description: string;
  occurred_on: string;
  status: EventStatus;
  created_at: string;
  updated_at: string;
};

type SessionDraft = {
  id: string | null;
  sequence: string;
  title: string;
  summary: string;
  status: SessionStatus;
  played_on: string;
};

type FactionDraft = {
  id: string | null;
  name: string;
  description: string;
  goal: string;
  tension: string;
  limit: string;
  consequence: string;
};

type EventDraft = {
  id: string | null;
  session_id: string;
  faction_id: string;
  title: string;
  description: string;
  occurred_on: string;
  status: EventStatus;
};

const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  planned: "Planejada",
  played: "Jogada",
  archived: "Arquivada",
};

const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  planned: "Planejado",
  active: "Ativo",
  resolved: "Resolvido",
  failed: "Falhou",
  consequence: "Consequência",
};

function dateLabel(value: string | null): string {
  if (!value) return "Sem data";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "Data inválida" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

function safePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "campanha";
}

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([*_`])/g, "\\$1");
}

function saveFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function emptySession(sequence: number): SessionDraft {
  return { id: null, sequence: String(sequence), title: "", summary: "", status: "planned", played_on: "" };
}

function emptyFaction(): FactionDraft {
  return { id: null, name: "", description: "", goal: "", tension: "0", limit: "6", consequence: "" };
}

function emptyEvent(): EventDraft {
  return { id: null, session_id: "", faction_id: "", title: "", description: "", occurred_on: new Date().toISOString().slice(0, 10), status: "planned" };
}

export function CampaignJournalPanel({ campaignId, canManage }: { campaignId: string; canManage: boolean }) {
  const id = useId();
  const [sessions, setSessions] = useState<CampaignSession[]>([]);
  const [factions, setFactions] = useState<CampaignFaction[]>([]);
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [factionFilter, setFactionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null);
  const [factionDraft, setFactionDraft] = useState<FactionDraft | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [showFactionForm, setShowFactionForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const campaignRef = useRef(campaignId);
  const refreshRef = useRef<() => void>(() => undefined);
  campaignRef.current = campaignId;

  useEffect(() => {
    let active = true;
    let requestId = 0;
    const requestCampaignId = campaignId;
    setSessions([]);
    setFactions([]);
    setEvents([]);
    setLoading(true);
    setSaving(false);
    setMessage("");
    setQuery("");
    setSessionFilter("");
    setFactionFilter("");
    setStatusFilter("");
    setSessionDraft(null);
    setFactionDraft(null);
    setEventDraft(null);
    setShowSessionForm(false);
    setShowFactionForm(false);
    setShowEventForm(false);

    async function load() {
      const currentRequest = ++requestId;
      try {
        const supabase = createClient();
        const [sessionResult, factionResult, eventResult] = await Promise.all([
          supabase.from("campaign_sessions").select("*").eq("campaign_id", requestCampaignId).order("sequence", { ascending: true }),
          supabase.from("campaign_factions").select("*").eq("campaign_id", requestCampaignId).order("name", { ascending: true }),
          supabase.from("campaign_events").select("*").eq("campaign_id", requestCampaignId).order("occurred_on", { ascending: true }).order("created_at", { ascending: true }),
        ]);
        if (!active || currentRequest !== requestId) return;
        if (sessionResult.error || factionResult.error || eventResult.error) throw new Error("query failed");
        setSessions((sessionResult.data ?? []) as CampaignSession[]);
        setFactions((factionResult.data ?? []) as CampaignFaction[]);
        setEvents((eventResult.data ?? []) as CampaignEvent[]);
      } catch {
        if (active && currentRequest === requestId) setMessage("Não foi possível carregar o diário desta campanha.");
      } finally {
        if (active && currentRequest === requestId) setLoading(false);
      }
    }

    refreshRef.current = () => void load();
    void load();
    return () => {
      active = false;
      refreshRef.current = () => undefined;
    };
  }, [campaignId]);

  const filteredEvents = events.filter((item) => {
    if (sessionFilter && item.session_id !== sessionFilter) return false;
    if (factionFilter && item.faction_id !== factionFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (query) {
      const needle = query.trim().toLocaleLowerCase("pt-BR");
      const searchable = `${item.title} ${item.description}`.toLocaleLowerCase("pt-BR");
      if (!searchable.includes(needle)) return false;
    }
    return true;
  });

  function currentCampaign(requestCampaignId: string): boolean {
    return campaignRef.current === requestCampaignId;
  }

  async function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionDraft || !canManage) return;
    const requestCampaignId = campaignId;
    const draft = sessionDraft;
    const sequence = Number(draft.sequence);
    if (!Number.isInteger(sequence) || sequence < 1 || !draft.title.trim()) {
      setMessage("Informe uma sequência positiva e um título para a sessão.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const supabase = createClient();
      const values = {
        sequence,
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        status: draft.status,
        played_on: draft.played_on || null,
      };
      let error;
      if (draft.id) {
        const existing = sessions.find((item) => item.id === draft.id);
        if (!existing) throw new Error("stale row");
        const result = await supabase.from("campaign_sessions").update(values).eq("id", draft.id).eq("campaign_id", requestCampaignId).eq("updated_at", existing.updated_at).select("id").maybeSingle();
        error = result.error ?? (!result.data ? new Error("stale row") : null);
      } else {
        const result = await supabase.from("campaign_sessions").insert({ campaign_id: requestCampaignId, ...values });
        error = result.error;
      }
      if (!currentCampaign(requestCampaignId)) return;
      if (error) throw error;
      setSessionDraft(null);
      setShowSessionForm(false);
      setMessage("Sessão salva.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível salvar. Atualize a lista e confira se alguém alterou este registro.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function deleteSession(item: CampaignSession) {
    if (!canManage || !window.confirm(`Excluir a sessão ${item.sequence}: ${item.title}? Os eventos continuarão no diário sem esse vínculo.`)) return;
    const requestCampaignId = campaignId;
    setSaving(true);
    try {
      const { data, error } = await createClient().from("campaign_sessions").delete().eq("id", item.id).eq("campaign_id", requestCampaignId).eq("updated_at", item.updated_at).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale row");
      setMessage("Sessão removida.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível remover a sessão. Atualize a lista e tente novamente.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function saveFaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factionDraft || !canManage) return;
    const requestCampaignId = campaignId;
    const draft = factionDraft;
    const tension = Number(draft.tension);
    const limit = Number(draft.limit);
    if (!draft.name.trim() || !Number.isInteger(tension) || tension < 0 || tension > 12 || !Number.isInteger(limit) || limit < 1 || limit > 12) {
      setMessage("Informe nome, tensão entre 0 e 12 e limite entre 1 e 12.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const supabase = createClient();
      const values = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        goal: draft.goal.trim(),
        tension,
        limit,
        consequence: draft.consequence.trim(),
      };
      let error;
      if (draft.id) {
        const existing = factions.find((item) => item.id === draft.id);
        if (!existing) throw new Error("stale row");
        const result = await supabase.from("campaign_factions").update(values).eq("id", draft.id).eq("campaign_id", requestCampaignId).eq("version", existing.version).select("id").maybeSingle();
        error = result.error ?? (!result.data ? new Error("stale row") : null);
      } else {
        const result = await supabase.from("campaign_factions").insert({ campaign_id: requestCampaignId, ...values });
        error = result.error;
      }
      if (!currentCampaign(requestCampaignId)) return;
      if (error) throw error;
      setFactionDraft(null);
      setShowFactionForm(false);
      setMessage("Facção salva.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível salvar. Atualize a lista e confira se alguém alterou esta facção.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function changeTension(item: CampaignFaction, amount: number) {
    if (!canManage) return;
    const requestCampaignId = campaignId;
    const tension = Math.max(0, Math.min(12, item.tension + amount));
    if (tension === item.tension) return;
    setSaving(true);
    try {
      const { data, error } = await createClient().from("campaign_factions").update({ tension }).eq("id", item.id).eq("campaign_id", requestCampaignId).eq("version", item.version).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale row");
      setMessage(tension >= item.limit ? `Ruptura: ${item.name} atingiu o limite.` : `Tensão atualizada para ${item.name}.`);
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível atualizar a tensão. Atualize o painel para receber a versão atual.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function deleteFaction(item: CampaignFaction) {
    if (!canManage || !window.confirm(`Excluir a facção ${item.name}? Os eventos continuarão no diário sem esse vínculo.`)) return;
    const requestCampaignId = campaignId;
    setSaving(true);
    try {
      const { data, error } = await createClient().from("campaign_factions").delete().eq("id", item.id).eq("campaign_id", requestCampaignId).eq("version", item.version).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale row");
      setMessage("Facção removida.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível remover a facção. Atualize a lista e tente novamente.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventDraft || !canManage) return;
    const requestCampaignId = campaignId;
    const draft = eventDraft;
    if (!draft.title.trim() || !draft.occurred_on) {
      setMessage("Informe título e data para o evento.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const supabase = createClient();
      const values = {
        session_id: draft.session_id || null,
        faction_id: draft.faction_id || null,
        title: draft.title.trim(),
        description: draft.description.trim(),
        occurred_on: draft.occurred_on,
        status: draft.status,
      };
      let error;
      if (draft.id) {
        const existing = events.find((item) => item.id === draft.id);
        if (!existing) throw new Error("stale row");
        const result = await supabase.from("campaign_events").update(values).eq("id", draft.id).eq("campaign_id", requestCampaignId).eq("updated_at", existing.updated_at).select("id").maybeSingle();
        error = result.error ?? (!result.data ? new Error("stale row") : null);
      } else {
        const result = await supabase.from("campaign_events").insert({ campaign_id: requestCampaignId, ...values });
        error = result.error;
      }
      if (!currentCampaign(requestCampaignId)) return;
      if (error) throw error;
      setEventDraft(null);
      setShowEventForm(false);
      setMessage("Evento salvo.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível salvar. Confira os vínculos e atualize a lista.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function deleteEvent(item: CampaignEvent) {
    if (!canManage || !window.confirm(`Excluir o evento ${item.title}?`)) return;
    const requestCampaignId = campaignId;
    setSaving(true);
    try {
      const { data, error } = await createClient().from("campaign_events").delete().eq("id", item.id).eq("campaign_id", requestCampaignId).eq("updated_at", item.updated_at).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale row");
      setMessage("Evento removido.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível remover o evento. Atualize a lista e tente novamente.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  function exportJson() {
    try {
      saveFile(`diario-${safePart(campaignId)}.json`, JSON.stringify({ campaign_id: campaignId, exported_at: new Date().toISOString(), sessions, factions, events }, null, 2), "application/json;charset=utf-8");
      setMessage("Arquivo JSON do diário salvo.");
    } catch {
      setMessage("Não foi possível gerar o arquivo JSON.");
    }
  }

  function exportMarkdown() {
    try {
      const sessionNames = new Map(sessions.map((item) => [item.id, `Sessão ${item.sequence}: ${item.title}`]));
      const factionNames = new Map(factions.map((item) => [item.id, item.name]));
      const lines = ["# Diário da campanha", "", `ID da campanha: ${campaignId}`, "", "## Sessões", ""];
      if (!sessions.length) lines.push("Nenhuma sessão registrada.", "");
      for (const item of sessions) {
        lines.push(`### Sessão ${item.sequence}: ${escapeMarkdown(item.title)}`, "", `Status: ${SESSION_STATUS_LABELS[item.status]}`, `Data: ${dateLabel(item.played_on)}`, "", item.summary || "Sem resumo registrado.", "");
      }
      lines.push("## Facções", "");
      if (!factions.length) lines.push("Nenhuma facção registrada.", "");
      for (const item of factions) {
        lines.push(`### ${escapeMarkdown(item.name)}`, "", `Tensão: ${item.tension} de ${item.limit}${item.tension >= item.limit ? " (Ruptura)" : ""}`, "", `Descrição: ${item.description || "Sem descrição registrada."}`, `Objetivo: ${item.goal || "Sem objetivo registrado."}`, `Consequência: ${item.consequence || "Sem consequência registrada."}`, "");
      }
      lines.push("## Linha do tempo", "");
      if (!events.length) lines.push("Nenhum evento registrado.", "");
      for (const item of events) {
        lines.push(`### ${dateLabel(item.occurred_on)} · ${escapeMarkdown(item.title)}`, "", `Status: ${EVENT_STATUS_LABELS[item.status]}`, `Sessão: ${item.session_id ? sessionNames.get(item.session_id) ?? "Sessão removida" : "Sem vínculo"}`, `Facção: ${item.faction_id ? factionNames.get(item.faction_id) ?? "Facção removida" : "Sem vínculo"}`, "", item.description || "Sem descrição registrada.", "");
      }
      saveFile(`diario-${safePart(campaignId)}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
      setMessage("Arquivo Markdown do diário salvo.");
    } catch {
      setMessage("Não foi possível gerar o arquivo Markdown.");
    }
  }

  const inputId = (name: string) => `${id}-${name}`;

  return (
    <section className={styles.panel} aria-labelledby={inputId("title")} aria-busy={loading || saving}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>REGISTROS DA CAMPANHA</p>
          <h2 id={inputId("title")}>Diário e linha do tempo</h2>
        </div>
        <div className={styles.exportActions}>
          <button type="button" className={styles.secondaryButton} onClick={exportJson} disabled={loading}>Exportar JSON</button>
          <button type="button" className={styles.secondaryButton} onClick={exportMarkdown} disabled={loading}>Exportar Markdown</button>
        </div>
      </div>

      <p className={styles.intro}>Sessões, eventos da crônica e tensão das facções ficam salvos nesta campanha.</p>
      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.section} aria-labelledby={inputId("sessions-title")}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>CRONOLOGIA DE MESA</p><h3 id={inputId("sessions-title")}>Sessões</h3></div>
          <div className={styles.sectionActions}><button className={styles.secondaryButton} type="button" onClick={() => refreshRef.current()} disabled={loading || saving}>Atualizar</button>{canManage && <button className={styles.primaryButton} type="button" disabled={saving} onClick={() => { setSessionDraft(emptySession(Math.max(0, ...sessions.map((item) => item.sequence)) + 1)); setShowSessionForm(true); }}>Nova sessão</button>}</div>
        </div>
        {showSessionForm && sessionDraft && canManage && (
          <form className={styles.form} onSubmit={saveSession}>
            <fieldset disabled={saving} className={styles.editingFields}>
            <div className={styles.formGrid}>
              <label htmlFor={inputId("session-sequence")}>Sequência<input id={inputId("session-sequence")} type="number" min="1" step="1" required value={sessionDraft.sequence} onChange={(event) => setSessionDraft({ ...sessionDraft, sequence: event.target.value })} /></label>
              <label htmlFor={inputId("session-title")}>Título<input id={inputId("session-title")} maxLength={160} required value={sessionDraft.title} onChange={(event) => setSessionDraft({ ...sessionDraft, title: event.target.value })} /></label>
              <label htmlFor={inputId("session-status")}>Status<select id={inputId("session-status")} value={sessionDraft.status} onChange={(event) => setSessionDraft({ ...sessionDraft, status: event.target.value as SessionStatus })}>{Object.entries(SESSION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label htmlFor={inputId("session-date")}>Data da sessão<input id={inputId("session-date")} type="date" value={sessionDraft.played_on} onChange={(event) => setSessionDraft({ ...sessionDraft, played_on: event.target.value })} /></label>
            </div>
            <label htmlFor={inputId("session-summary")}>Resumo<textarea id={inputId("session-summary")} rows={3} maxLength={12000} value={sessionDraft.summary} onChange={(event) => setSessionDraft({ ...sessionDraft, summary: event.target.value })} /></label>
            <div className={styles.formActions}><button className={styles.primaryButton} disabled={saving}>{sessionDraft.id ? "Salvar sessão" : "Criar sessão"}</button><button className={styles.secondaryButton} type="button" onClick={() => { setSessionDraft(null); setShowSessionForm(false); }}>Cancelar</button></div>
            </fieldset>
          </form>
        )}
        {loading ? <p className={styles.empty}>Carregando sessões…</p> : sessions.length === 0 ? <p className={styles.empty}>Nenhuma sessão registrada nesta campanha.</p> : (
          <ol className={styles.sessionList}>
            {sessions.map((item) => <li className={styles.sessionCard} key={item.id}>
              <div className={styles.recordHeading}><div><span className={styles.sequence}>Sessão {item.sequence}</span><h4>{item.title}</h4></div><span className={styles.badge}>{SESSION_STATUS_LABELS[item.status]}</span></div>
              <p className={styles.recordMeta}>{dateLabel(item.played_on)}</p>
              <p className={styles.recordText}>{item.summary || "Sem resumo registrado."}</p>
              {canManage && <div className={styles.rowActions}><button type="button" className={styles.textButton} disabled={saving} onClick={() => { setSessionDraft({ id: item.id, sequence: String(item.sequence), title: item.title, summary: item.summary, status: item.status, played_on: item.played_on ?? "" }); setShowSessionForm(true); }}>Editar</button><button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void deleteSession(item)}>Excluir</button></div>}
            </li>)}
          </ol>
        )}
      </section>

      <section className={styles.section} aria-labelledby={inputId("factions-title")}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>RELÓGIOS DE TENSÃO</p><h3 id={inputId("factions-title")}>Facções</h3></div>
          {canManage && <button className={styles.primaryButton} type="button" disabled={saving} onClick={() => { setFactionDraft(emptyFaction()); setShowFactionForm(true); }}>Nova facção</button>}
        </div>
        {showFactionForm && factionDraft && canManage && (
          <form className={styles.form} onSubmit={saveFaction}>
            <fieldset disabled={saving} className={styles.editingFields}>
            <div className={styles.formGrid}>
              <label htmlFor={inputId("faction-name")}>Nome<input id={inputId("faction-name")} maxLength={160} required value={factionDraft.name} onChange={(event) => setFactionDraft({ ...factionDraft, name: event.target.value })} /></label>
              <label htmlFor={inputId("faction-tension")}>Tensão<input id={inputId("faction-tension")} type="number" min="0" max="12" step="1" required value={factionDraft.tension} onChange={(event) => setFactionDraft({ ...factionDraft, tension: event.target.value })} /></label>
              <label htmlFor={inputId("faction-limit")}>Limite do relógio<input id={inputId("faction-limit")} type="number" min="1" max="12" step="1" required value={factionDraft.limit} onChange={(event) => setFactionDraft({ ...factionDraft, limit: event.target.value })} /></label>
            </div>
            <label htmlFor={inputId("faction-description")}>Descrição<textarea id={inputId("faction-description")} rows={2} maxLength={6000} value={factionDraft.description} onChange={(event) => setFactionDraft({ ...factionDraft, description: event.target.value })} /></label>
            <label htmlFor={inputId("faction-goal")}>Objetivo<textarea id={inputId("faction-goal")} rows={2} maxLength={3000} value={factionDraft.goal} onChange={(event) => setFactionDraft({ ...factionDraft, goal: event.target.value })} /></label>
            <label htmlFor={inputId("faction-consequence")}>Consequência ao atingir o limite<textarea id={inputId("faction-consequence")} rows={2} maxLength={3000} value={factionDraft.consequence} onChange={(event) => setFactionDraft({ ...factionDraft, consequence: event.target.value })} /></label>
            <div className={styles.formActions}><button className={styles.primaryButton} disabled={saving}>{factionDraft.id ? "Salvar facção" : "Criar facção"}</button><button className={styles.secondaryButton} type="button" onClick={() => { setFactionDraft(null); setShowFactionForm(false); }}>Cancelar</button></div>
            </fieldset>
          </form>
        )}
        {loading ? <p className={styles.empty}>Carregando facções…</p> : factions.length === 0 ? <p className={styles.empty}>Nenhuma facção registrada nesta campanha.</p> : (
          <ul className={styles.factionList}>
            {factions.map((item) => {
              const broken = item.tension >= item.limit;
              return <li className={`${styles.factionCard} ${broken ? styles.broken : ""}`} key={item.id}>
                <div className={styles.recordHeading}><div><h4>{item.name}</h4><span className={styles.recordMeta}>{item.description || "Sem descrição registrada."}</span></div>{broken && <span className={styles.rupture}>Ruptura</span>}</div>
                <p className={styles.recordText}><strong>Objetivo:</strong> {item.goal || "Não informado."}</p>
                <p className={styles.recordText}><strong>Consequência:</strong> {item.consequence || "Não informada."}</p>
                <div className={styles.clockRow}>
                  <div className={styles.clockTrack} role="meter" aria-label={`Tensão de ${item.name}`} aria-valuemin={0} aria-valuemax={item.limit} aria-valuenow={Math.min(item.tension, item.limit)} aria-valuetext={`${item.tension} de ${item.limit}${broken ? ", Ruptura" : ""}`}>
                    {Array.from({ length: item.limit }, (_, index) => <span className={`${styles.clockSegment} ${index < item.tension ? (broken ? styles.segmentBroken : styles.segmentFilled) : ""}`} key={index} />)}
                  </div>
                  <strong className={styles.clockValue}>{item.tension}/{item.limit}</strong>
                </div>
                {canManage && <div className={styles.rowActions}><button type="button" className={styles.secondaryButton} aria-label={`Reduzir tensão de ${item.name}`} disabled={saving || item.tension <= 0} onClick={() => void changeTension(item, -1)}>−</button><button type="button" className={styles.secondaryButton} aria-label={`Aumentar tensão de ${item.name}`} disabled={saving || item.tension >= 12} onClick={() => void changeTension(item, 1)}>+</button><button type="button" className={styles.textButton} disabled={saving} onClick={() => { setFactionDraft({ id: item.id, name: item.name, description: item.description, goal: item.goal, tension: String(item.tension), limit: String(item.limit), consequence: item.consequence }); setShowFactionForm(true); }}>Editar</button><button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void deleteFaction(item)}>Excluir</button></div>}
              </li>;
            })}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby={inputId("events-title")}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>HISTÓRICO CRONOLÓGICO</p><h3 id={inputId("events-title")}>Linha do tempo</h3></div>
          {canManage && <button className={styles.primaryButton} type="button" disabled={saving} onClick={() => { setEventDraft(emptyEvent()); setShowEventForm(true); }}>Novo evento</button>}
        </div>
        <div className={styles.filters}>
          <label htmlFor={inputId("event-query")}>Buscar evento<input id={inputId("event-query")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Título ou descrição" /></label>
          <label htmlFor={inputId("event-session-filter")}>Sessão<select id={inputId("event-session-filter")} value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}><option value="">Todas</option>{sessions.map((item) => <option key={item.id} value={item.id}>Sessão {item.sequence}: {item.title}</option>)}</select></label>
          <label htmlFor={inputId("event-faction-filter")}>Facção<select id={inputId("event-faction-filter")} value={factionFilter} onChange={(event) => setFactionFilter(event.target.value)}><option value="">Todas</option>{factions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label htmlFor={inputId("event-status-filter")}>Status<select id={inputId("event-status-filter")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos</option>{Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {showEventForm && eventDraft && canManage && (
          <form className={styles.form} onSubmit={saveEvent}>
            <fieldset disabled={saving} className={styles.editingFields}>
            <div className={styles.formGrid}>
              <label htmlFor={inputId("event-title")}>Título<input id={inputId("event-title")} maxLength={200} required value={eventDraft.title} onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} /></label>
              <label htmlFor={inputId("event-date")}>Data<input id={inputId("event-date")} type="date" required value={eventDraft.occurred_on} onChange={(event) => setEventDraft({ ...eventDraft, occurred_on: event.target.value })} /></label>
              <label htmlFor={inputId("event-status")}>Status<select id={inputId("event-status")} value={eventDraft.status} onChange={(event) => setEventDraft({ ...eventDraft, status: event.target.value as EventStatus })}>{Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label htmlFor={inputId("event-session")}>Sessão<select id={inputId("event-session")} value={eventDraft.session_id} onChange={(event) => setEventDraft({ ...eventDraft, session_id: event.target.value })}><option value="">Sem vínculo</option>{sessions.map((item) => <option key={item.id} value={item.id}>Sessão {item.sequence}: {item.title}</option>)}</select></label>
              <label htmlFor={inputId("event-faction")}>Facção<select id={inputId("event-faction")} value={eventDraft.faction_id} onChange={(event) => setEventDraft({ ...eventDraft, faction_id: event.target.value })}><option value="">Sem vínculo</option>{factions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            <label htmlFor={inputId("event-description")}>Descrição<textarea id={inputId("event-description")} rows={3} maxLength={12000} value={eventDraft.description} onChange={(event) => setEventDraft({ ...eventDraft, description: event.target.value })} /></label>
            <div className={styles.formActions}><button className={styles.primaryButton} disabled={saving}>{eventDraft.id ? "Salvar evento" : "Criar evento"}</button><button className={styles.secondaryButton} type="button" onClick={() => { setEventDraft(null); setShowEventForm(false); }}>Cancelar</button></div>
            </fieldset>
          </form>
        )}
        {loading ? <p className={styles.empty}>Carregando eventos…</p> : events.length === 0 ? <p className={styles.empty}>Nenhum evento registrado nesta campanha.</p> : filteredEvents.length === 0 ? <p className={styles.empty}>Nenhum evento corresponde a estes filtros.</p> : (
          <ol className={styles.timeline}>
            {filteredEvents.map((item) => {
              const session = sessions.find((entry) => entry.id === item.session_id);
              const faction = factions.find((entry) => entry.id === item.faction_id);
              return <li className={styles.eventCard} key={item.id}>
                <p className={styles.eventDate}>{dateLabel(item.occurred_on)}</p>
                <div className={styles.recordHeading}><h4>{item.title}</h4><span className={styles.badge}>{EVENT_STATUS_LABELS[item.status]}</span></div>
                <p className={styles.recordText}>{item.description || "Sem descrição registrada."}</p>
                <p className={styles.recordMeta}>Sessão: {session ? `Sessão ${session.sequence}: ${session.title}` : "Sem vínculo"} · Facção: {faction?.name ?? "Sem vínculo"}</p>
                {canManage && <div className={styles.rowActions}><button type="button" className={styles.textButton} disabled={saving} onClick={() => { setEventDraft({ id: item.id, session_id: item.session_id ?? "", faction_id: item.faction_id ?? "", title: item.title, description: item.description, occurred_on: item.occurred_on, status: item.status }); setShowEventForm(true); }}>Editar</button><button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void deleteEvent(item)}>Excluir</button></div>}
              </li>;
            })}
          </ol>
        )}
      </section>
    </section>
  );
}
