"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { downloadText } from "../lib/download";
import styles from "./second-inquisition-panel.module.css";

type EventKind = "public_discipline" | "masquerade_breach" | "digital_trace";
type ConfirmedEvent = {
  id: string;
  campaign_id: string;
  event_kind: EventKind;
  area_id: string;
  occurred_at: string;
  verified_at: string;
  created_by: string;
  version: number;
};
type ThreatAssessment = {
  campaign_id: string;
  score: number;
  level: number;
  level_name: string;
  verified_event_count: number;
  score_by_event_kind: Record<EventKind, number>;
  responses: Array<{ kind: string; title: string; triggered_at_level: number; stats: Record<string, number | string | boolean> }>;
  assessment_at: string;
};
type PanelData = { events: ConfirmedEvent[]; assessment: ThreatAssessment };

const eventLabels: Record<EventKind, string> = {
  public_discipline: "Disciplina usada em público",
  masquerade_breach: "Ruptura da Máscara",
  digital_trace: "Rastro digital",
};
const statLabels: Record<string, string> = {
  coverage: "Cobertura",
  duration_hours: "Duração em horas",
  lead_count: "Pistas",
  team_size: "Agentes",
  combat_pool: "Parada de combate",
  health: "Vitalidade",
  armor: "Proteção",
  coordination: "Coordenação",
  accounts_affected: "Contas afetadas",
  scope: "Abrangência",
};

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data inválida" : date.toLocaleString("pt-BR");
}

export function SecondInquisitionPanel({ campaignId, canManage }: { campaignId: string; canManage: boolean }) {
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const requestRef = useRef(0);
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [eventKind, setEventKind] = useState<EventKind>("public_discipline");
  const [areaId, setAreaId] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue(new Date()));

  async function api(path: string, method = "GET", payload?: unknown) {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!baseUrl) throw new Error("A API não está configurada.");
    const { data: sessionData, error } = await createClient().auth.getSession();
    if (error || !sessionData.session) throw new Error("Entre na campanha com uma sessão válida.");
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new Error(typeof body?.detail === "string" ? body.detail : `A API respondeu com status ${response.status}.`);
    }
    return response.status === 204 ? null : response.json();
  }

  async function refresh(selectedCampaign = campaignId) {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await api(`/api/v1/campaigns/${selectedCampaign}/second-inquisition`) as PanelData;
      if (request !== requestRef.current || campaignRef.current !== selectedCampaign) return;
      setData(result);
      setMessage("");
    } catch (error) {
      if (request === requestRef.current && campaignRef.current === selectedCampaign) {
        setData(null);
        setMessage(error instanceof Error ? error.message : "Não foi possível consultar os eventos confirmados.");
      }
    } finally {
      if (request === requestRef.current && campaignRef.current === selectedCampaign) setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    setMessage("");
    setBusy(false);
    void refresh(campaignId);
    return () => { requestRef.current += 1; };
  }, [campaignId]);

  async function confirmEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedCampaign = campaignId;
    const cleanArea = areaId.trim();
    const occurredDate = new Date(occurredAt);
    if (!canManage || !cleanArea || cleanArea.length > 100 || Number.isNaN(occurredDate.getTime()) || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/v1/campaigns/${selectedCampaign}/second-inquisition`, "POST", {
        event_kind: eventKind,
        area_id: cleanArea,
        occurred_at: occurredDate.toISOString(),
      });
      if (campaignRef.current !== selectedCampaign) return;
      setAreaId("");
      setMessage("Evento confirmado pelo mestre e incluído na avaliação.");
      await refresh(selectedCampaign);
    } catch (error) {
      if (campaignRef.current === selectedCampaign) setMessage(error instanceof Error ? error.message : "Não foi possível confirmar o evento.");
    } finally {
      if (campaignRef.current === selectedCampaign) setBusy(false);
    }
  }

  async function revokeEvent(item: ConfirmedEvent) {
    const selectedCampaign = campaignId;
    if (!canManage || busy || !window.confirm(`Retirar a confirmação de “${eventLabels[item.event_kind]}” em ${item.area_id}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/v1/campaigns/${selectedCampaign}/second-inquisition/${item.id}?expected_version=${item.version}`, "DELETE");
      if (campaignRef.current !== selectedCampaign) return;
      setMessage("Confirmação retirada. A avaliação foi reconstruída.");
      await refresh(selectedCampaign);
    } catch (error) {
      if (campaignRef.current === selectedCampaign) setMessage(error instanceof Error ? error.message : "Não foi possível retirar a confirmação.");
    } finally {
      if (campaignRef.current === selectedCampaign) setBusy(false);
    }
  }

  function exportAssessment() {
    if (!data) return;
    const backup = {
      format: "rpg-nexus-second-inquisition",
      format_version: 1,
      campaign_id: campaignId,
      exported_at: new Date().toISOString(),
      events: data.events,
      assessment: data.assessment,
    };
    downloadText(`segunda-inquisicao-${campaignId.slice(0, 8)}.json`, JSON.stringify(backup, null, 2));
  }

  if (!canManage) return <section className={styles.panel}><h2>Segunda Inquisição</h2><p>Apenas o mestre ou proprietário da campanha pode consultar os eventos confirmados.</p></section>;

  return <section className={styles.panel} aria-busy={loading || busy} aria-labelledby="second-inquisition-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>EVENTOS CONFIRMADOS PELO MESTRE</p><h2 id="second-inquisition-title">Segunda Inquisição</h2>
        <p>Salvar um evento confirma o relato para esta campanha. Ações dos jogadores não entram no cálculo automaticamente.</p></div>
      <button type="button" disabled={!data || loading || busy} onClick={exportAssessment}>Exportar JSON</button>
    </header>

    <p className={styles.message} role="status" aria-live="polite">{loading ? "Carregando os eventos confirmados…" : message}</p>

    {data && <div className={styles.metrics} aria-label="Resultado da avaliação">
      <article><span>Pontuação</span><strong>{data.assessment.score}</strong></article>
      <article><span>Nível</span><strong>{data.assessment.level} · {data.assessment.level_name}</strong></article>
      <article><span>Eventos avaliados</span><strong>{data.assessment.verified_event_count}</strong></article>
      <article><span>Avaliado em</span><strong>{formatDate(data.assessment.assessment_at)}</strong></article>
    </div>}

    {data && <section className={styles.results} aria-label="Respostas por nível">
      <div><h3>Pontuação por tipo</h3>
        {Object.entries(data.assessment.score_by_event_kind).map(([kind, score]) => <p key={kind}><span>{eventLabels[kind as EventKind] ?? kind}</span><b>{score}</b></p>)}
      </div>
      <div><h3>Respostas da mesa</h3>
        {data.assessment.responses.length ? data.assessment.responses.map((response) => <article key={response.kind}>
          <h4>Nível {response.triggered_at_level} · {response.title}</h4>
          <dl>{Object.entries(response.stats).map(([key, value]) => <div key={key}><dt>{statLabels[key] ?? key}</dt><dd>{value}</dd></div>)}</dl>
        </article>) : <p>Nenhuma resposta foi acionada pelas regras atuais da mesa.</p>}
      </div>
    </section>}

    <form className={styles.form} onSubmit={confirmEvent}>
      <h3>Confirmar evento narrado</h3>
      <p>O horário de ocorrência vem do relato aprovado. O banco grava a data de confirmação e o autor autenticado.</p>
      <label>Tipo do evento
        <select value={eventKind} onChange={(event) => setEventKind(event.target.value as EventKind)} disabled={busy}>
          {Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Área ou local
        <input value={areaId} maxLength={100} required onChange={(event) => setAreaId(event.target.value)} placeholder="Ex.: Centro, zona portuária" disabled={busy} />
      </label>
      <label>Quando ocorreu
        <input type="datetime-local" value={occurredAt} required onChange={(event) => setOccurredAt(event.target.value)} disabled={busy} />
      </label>
      <button type="submit" disabled={busy || !areaId.trim()}>Confirmar evento e recalcular</button>
    </form>

    <section className={styles.eventSection}>
      <div className={styles.eventHeading}><h3>Confirmações da campanha</h3><button type="button" className={styles.quiet} onClick={() => void refresh()} disabled={loading || busy}>Atualizar</button></div>
      {!loading && data?.events.length === 0 && <p>Nenhum evento foi confirmado nesta campanha.</p>}
      <ol className={styles.events}>
        {data?.events.map((item) => <li key={item.id}>
          <div><strong>{eventLabels[item.event_kind] ?? item.event_kind}</strong><span>{item.area_id} · ocorrência: {formatDate(item.occurred_at)}</span><small>Confirmado em {formatDate(item.verified_at)}</small></div>
          <button type="button" className={styles.remove} disabled={busy} onClick={() => void revokeEvent(item)}>Retirar confirmação</button>
        </li>)}
      </ol>
    </section>
  </section>;
}
