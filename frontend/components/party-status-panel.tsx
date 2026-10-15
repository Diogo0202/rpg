"use client";

import { useEffect, useId, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import styles from "./party-status-panel.module.css";

type Sheet = {
  id: string;
  name: string;
  values: Record<string, unknown>;
  updated_at: string;
  version: number;
};

type RealtimeState = "connected" | "offline" | "error";
type NumericField = { value: number | null; invalid: boolean };

function numericValue(values: Record<string, unknown>, key: string, max?: number): NumericField {
  if (!Object.prototype.hasOwnProperty.call(values, key) || values[key] === null || values[key] === undefined) {
    return { value: null, invalid: false };
  }
  const value = values[key];
  const valid = typeof value === "number" && Number.isInteger(value) && value >= 0 && (max === undefined || value <= max);
  return valid ? { value, invalid: false } : { value: null, invalid: true };
}

function displayValue(field: NumericField): string {
  if (field.invalid) return "Valor inválido";
  return field.value === null ? "Não informado" : String(field.value);
}

function willpower(values: Record<string, unknown>): NumericField {
  const hasCurrent = Object.prototype.hasOwnProperty.call(values, "vontade_atual") && values.vontade_atual !== null && values.vontade_atual !== undefined;
  const current = numericValue(values, "vontade_atual");
  if (hasCurrent) return current;

  const control = numericValue(values, "autocontrole");
  const resolve = numericValue(values, "resolucao");
  if (control.invalid || resolve.invalid) return { value: null, invalid: true };
  if (control.value === null || resolve.value === null) return { value: null, invalid: false };

  const superficial = numericValue(values, "vontade_superficial");
  const aggravated = numericValue(values, "vontade_agravada");
  if (superficial.invalid || aggravated.invalid) return { value: null, invalid: true };
  if (superficial.value === null || aggravated.value === null) return { value: null, invalid: false };
  return { value: Math.max(0, control.value + resolve.value - superficial.value - aggravated.value), invalid: false };
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Não informado"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function PartyStatusPanel({ campaignId }: { campaignId: string }) {
  const titleId = useId();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<RealtimeState>("offline");
  const [message, setMessage] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let subscribed = false;
    let requestId = 0;
    setSheets([]);
    setLoading(true);
    setStatus("offline");
    setMessage("");

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setLoading(false);
      setStatus("error");
      setMessage("Configure a conexão do Supabase para carregar as fichas.");
      return () => { active = false; };
    }

    async function refresh(manual = false) {
      const currentRequest = ++requestId;
      if (active) {
        setRefreshing(manual);
      }

      try {
        const { data, error } = await supabase
          .from("character_sheets")
          .select("id, name, values, updated_at, version")
          .eq("campaign_id", campaignId)
          .order("name", { ascending: true });

        if (!active || currentRequest !== requestId) return;
        if (error) throw error;

        setSheets((data ?? []) as Sheet[]);
        setMessage("");
        setStatus(subscribed ? "connected" : "offline");
      } catch {
        if (!active || currentRequest !== requestId) return;
        setStatus("error");
        setMessage("Não foi possível carregar as fichas desta campanha.");
      } finally {
        if (active && currentRequest === requestId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    refreshRef.current = () => void refresh(true);

    const channel = supabase
      .channel(`party-status-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "character_sheets", filter: `campaign_id=eq.${campaignId}` },
        () => void refresh(),
      )
      .subscribe((channelStatus) => {
        if (!active) return;
        if (channelStatus === "SUBSCRIBED") {
          subscribed = true;
          setStatus("connected");
          void refresh();
        } else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT") {
          subscribed = false;
          setStatus("error");
          setMessage("O realtime apresentou um erro. Atualize para buscar os dados atuais.");
        } else if (channelStatus === "CLOSED") {
          subscribed = false;
          setStatus("offline");
        }
      });

    void refresh();

    return () => {
      active = false;
      refreshRef.current = () => undefined;
      void supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const statusLabel = status === "connected" ? "Conectado" : status === "error" ? "Erro" : "Sem realtime";
  const visibleSheets = onlyActive ? sheets.filter((sheet) => sheet.values.ativo_na_sessao === true) : sheets;

  return (
    <section className={styles.panel} aria-labelledby={titleId} aria-busy={loading || refreshing}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>ESTADO DA CRÔNICA</p>
          <h2 id={titleId}>Party View</h2>
        </div>
        <span className={`${styles.connection} ${styles[status]}`} role="status" aria-live="polite">
          <span className={styles.connectionDot} aria-hidden="true" />
          {statusLabel}
        </span>
      </div>

      <div className={styles.toolbar}>
        <p className={styles.description}>Condição atual das fichas visíveis nesta campanha.</p>
        <button className={styles.refreshButton} type="button" onClick={() => refreshRef.current()} disabled={refreshing}>
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </div>

      <div className={styles.filter}>
        <label className={styles.filterLabel}>
          <input type="checkbox" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} />
          Somente ativos na sessão
        </label>
        <p className={styles.filterHelp}>Marque “Ativo na sessão” na ficha para exibir o personagem. Fichas de templates antigos podem não ter esse campo; desative o filtro para mostrar todas.</p>
      </div>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      {loading ? (
        <p className={styles.empty}>Carregando fichas…</p>
      ) : sheets.length === 0 ? (
        <p className={styles.empty}>Esta campanha ainda não tem fichas.</p>
      ) : visibleSheets.length ? (
        <ul className={styles.list} aria-label="Personagens da campanha">
          {visibleSheets.map((sheet) => {
            const hunger = numericValue(sheet.values, "fome", 5);
            const humanity = numericValue(sheet.values, "humanidade", 10);
            const stains = numericValue(sheet.values, "manchas", 10);
            const will = willpower(sheet.values);
            return (
              <li className={styles.card} key={sheet.id}>
                <div className={styles.characterHeading}>
                  <h3>{sheet.name || "Personagem sem nome"}</h3>
                  <span className={styles.version}>v{sheet.version}</span>
                </div>
                <dl className={styles.metrics}>
                  <div className={`${styles.metric} ${hunger.value !== null && hunger.value >= 4 ? styles.hungerHigh : ""}`}>
                    <dt>Fome <span className={styles.range}>(0 a 5)</span></dt>
                    <dd>{displayValue(hunger)}</dd>
                  </div>
                  <div className={styles.metric}>
                    <dt>Vontade disponível</dt>
                    <dd>{displayValue(will)}</dd>
                  </div>
                  <div className={styles.metric}>
                    <dt>Humanidade <span className={styles.range}>(0 a 10)</span></dt>
                    <dd>{displayValue(humanity)}</dd>
                  </div>
                  <div className={styles.metric}>
                    <dt>Manchas <span className={styles.range}>(0 a 10)</span></dt>
                    <dd>{displayValue(stains)}</dd>
                  </div>
                </dl>
                <p className={styles.updated}>Atualizada {dateLabel(sheet.updated_at)}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>Nenhuma ficha está marcada como ativa na sessão. Marque o campo na ficha ou desative o filtro para mostrar todas.</p>
      )}
    </section>
  );

}
