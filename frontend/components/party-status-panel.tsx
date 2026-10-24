"use client";

import { useEffect, useId, useRef, useState } from "react";

import { adjustExperience, spendMetaCurrency } from "../lib/sheet-adjustments";
import type { MetaCurrency, SheetTemplate } from "../lib/sheet-template";
import { createClient } from "../lib/supabase/client";
import styles from "./party-status-panel.module.css";

type Sheet = {
  id: string;
  name: string;
  template_id: string;
  values: Record<string, unknown>;
  updated_at: string;
  version: number;
};
type Resources = { experienceField: string | null; currencies: MetaCurrency[] };
type Grant = { kind: "xp" } | { kind: "currency"; id: string };

function resourcesOf(schema: SheetTemplate | undefined): Resources {
  return { experienceField: schema?.experience_field ?? null, currencies: schema?.meta_currencies ?? [] };
}

function plainNumber(values: Record<string, unknown>, key: string): number {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

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
  const [templates, setTemplates] = useState<Record<string, SheetTemplate>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteStatus, setNoteStatus] = useState<Record<string, string>>({});
  const refreshRef = useRef<() => void>(() => undefined);

  /** Master-only notes live in character_sheet_secrets, which not even the sheet owner can read. */
  async function saveNote(sheetId: string) {
    const text = (noteDrafts[sheetId] ?? notes[sheetId] ?? "").slice(0, 10000);
    setNoteStatus((current) => ({ ...current, [sheetId]: "Salvando…" }));
    const { error } = await createClient().from("character_sheet_secrets")
      .upsert({ sheet_id: sheetId, campaign_id: campaignId, notes: text }, { onConflict: "sheet_id" });
    if (error) { setNoteStatus((current) => ({ ...current, [sheetId]: "Não foi possível salvar a anotação." })); return; }
    setNotes((current) => ({ ...current, [sheetId]: text }));
    setNoteDrafts((current) => { const next = { ...current }; delete next[sheetId]; return next; });
    setNoteStatus((current) => ({ ...current, [sheetId]: "Anotação salva. Só você a vê." }));
  }

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
        const [{ data, error }, templateResult, secretResult] = await Promise.all([
          supabase.from("character_sheets").select("id, name, template_id, values, updated_at, version")
            .eq("campaign_id", campaignId).order("name", { ascending: true }),
          supabase.from("system_templates").select("id, schema").eq("campaign_id", campaignId).eq("status", "approved"),
          supabase.from("character_sheet_secrets").select("sheet_id, notes").eq("campaign_id", campaignId),
        ]);

        if (!active || currentRequest !== requestId) return;
        if (error) throw error;

        setSheets((data ?? []) as Sheet[]);
        setTemplates(Object.fromEntries((templateResult.data ?? []).map((row) => [row.id as string, row.schema as SheetTemplate])));
        setNotes(Object.fromEntries((secretResult.data ?? []).map((row) => [row.sheet_id as string, row.notes as string])));
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
        { event: "INSERT", schema: "public", table: "character_sheet_notifications", filter: `campaign_id=eq.${campaignId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "character_sheet_notifications", filter: `campaign_id=eq.${campaignId}` },
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
  const chosen = visibleSheets.filter((sheet) => selected.has(sheet.id));
  const currencyOptions = new Map<string, string>();
  for (const sheet of chosen) for (const currency of resourcesOf(templates[sheet.template_id]).currencies) currencyOptions.set(currency.id, currency.label);
  const validAmount = Number.isInteger(amount) && amount >= 1 && amount <= 1000;

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  /** Applies one grant to every selected sheet; each call is an atomic server delta. */
  async function apply(grant: Grant, direction: 1 | -1) {
    if (!validAmount || applying || chosen.length === 0) return;
    setApplying(true);
    const lines: string[] = [];
    for (const sheet of chosen) {
      const resources = resourcesOf(templates[sheet.template_id]);
      const label = sheet.name || "Personagem sem nome";
      try {
        if (grant.kind === "xp") {
          if (!resources.experienceField) { lines.push(`${label}: o modelo não tem experiência.`); continue; }
          await adjustExperience(sheet.id, direction * amount, reason);
          lines.push(`${label}: ${direction > 0 ? "+" : "−"}${amount} XP.`);
        } else {
          const currency = resources.currencies.find((item) => item.id === grant.id);
          if (!currency) { lines.push(`${label}: o modelo não tem ${currencyOptions.get(grant.id) ?? grant.id}.`); continue; }
          // Granting a pool raises it; for a damage track the grant clears marks.
          await spendMetaCurrency(sheet.id, currency.id, -direction * amount, reason);
          lines.push(`${label}: ${currency.label} ${direction > 0 ? "concedido" : "gasto"} (${amount}).`);
        }
      } catch (problem) {
        lines.push(`${label}: ${problem instanceof Error ? problem.message : "não aplicado"}.`);
      }
    }
    setResults(lines);
    setApplying(false);
    refreshRef.current();
  }

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

      {visibleSheets.length > 0 && <form className={styles.grants} aria-label="Injetar bônus nas fichas" onSubmit={(event) => event.preventDefault()}>
        <div className={styles.grantRow}>
          <button type="button" className={styles.refreshButton} onClick={() => setSelected(chosen.length === visibleSheets.length ? new Set() : new Set(visibleSheets.map((sheet) => sheet.id)))}>
            {chosen.length === visibleSheets.length ? "Limpar seleção" : "Selecionar toda a party"}
          </button>
          <label>Quantidade<input type="number" min={1} max={1000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
          <label className={styles.reason}>Motivo<input value={reason} maxLength={200} placeholder="Ex.: fim da sessão 5" onChange={(event) => setReason(event.target.value)} /></label>
        </div>
        <div className={styles.grantRow}>
          <button type="button" disabled={applying || !validAmount || chosen.length === 0} onClick={() => void apply({ kind: "xp" }, 1)}>Dar XP</button>
          {[...currencyOptions].map(([id, label]) => <span key={id} className={styles.grantPair}>
            <button type="button" disabled={applying || !validAmount} onClick={() => void apply({ kind: "currency", id }, 1)}>Conceder {label}</button>
            <button type="button" disabled={applying || !validAmount} onClick={() => void apply({ kind: "currency", id }, -1)}>Gastar {label}</button>
          </span>)}
          <span className={styles.selectionCount}>{chosen.length === 0 ? "Selecione personagens abaixo" : `${chosen.length} selecionado(s)`}</span>
        </div>
        {results.length > 0 && <ul className={styles.results} role="status" aria-live="polite">{results.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </form>}

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
            const resources = resourcesOf(templates[sheet.template_id]);
            const isV5 = Object.prototype.hasOwnProperty.call(sheet.values, "fome");
            return (
              <li className={`${styles.card} ${selected.has(sheet.id) ? styles.cardSelected : ""}`} key={sheet.id}>
                <div className={styles.characterHeading}>
                  <label className={styles.pick}><input type="checkbox" checked={selected.has(sheet.id)} onChange={() => toggle(sheet.id)} />
                    <h3>{sheet.name || "Personagem sem nome"}</h3></label>
                  <span className={styles.version}>v{sheet.version}</span>
                </div>
                <dl className={styles.metrics}>
                  {isV5 && <>
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
                  </>}
                  {resources.experienceField && <div className={styles.metric}>
                    <dt>Experiência disponível</dt>
                    <dd>{plainNumber(sheet.values, resources.experienceField)} XP</dd>
                  </div>}
                  {resources.currencies.filter((currency) => !(isV5 && currency.field === "vontade_superficial")).map((currency) => <div className={styles.metric} key={currency.id}>
                    <dt>{currency.label}</dt>
                    <dd>{plainNumber(sheet.values, currency.field)}{currency.mode === "track" ? " marcado(s)" : ""}{typeof currency.max === "number" ? ` / ${currency.max}` : ""}</dd>
                  </div>)}
                </dl>
                {typeof sheet.values.compulsao_atual === "string" && sheet.values.compulsao_atual !== "Nenhuma" &&
                  <p className={styles.private}>Compulsão: {sheet.values.compulsao_atual} <span>(privada)</span></p>}
                <details className={styles.note}>
                  <summary>Anotação do Mestre{notes[sheet.id] ? " · preenchida" : ""}</summary>
                  <textarea rows={3} maxLength={10000} value={noteDrafts[sheet.id] ?? notes[sheet.id] ?? ""}
                    aria-label={`Anotação do Mestre sobre ${sheet.name || "personagem"}`}
                    onChange={(event) => setNoteDrafts((current) => ({ ...current, [sheet.id]: event.target.value }))} />
                  <div className={styles.noteActions}>
                    <button type="button" disabled={noteDrafts[sheet.id] === undefined} onClick={() => void saveNote(sheet.id)}>Salvar anotação</button>
                    <span role="status">{noteStatus[sheet.id] ?? "O jogador não vê este texto."}</span>
                  </div>
                </details>
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
