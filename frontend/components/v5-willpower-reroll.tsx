"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Outcome = { successes: number; success: boolean; critical_pairs: number; messy_critical: boolean; clean_critical: boolean; bestial_failure: boolean };
export type StoredRoll = {
  id: string; pool: number; hunger: number; difficulty: number;
  normal_dice: number[]; hunger_dice: number[]; outcome: Outcome;
  original_normal_dice: number[] | null; rerolled_indices: number[] | null;
  created_at: string; rerolled_at: string | null; recommended_reroll: number[];
};
type RerollResponse = { roll: StoredRoll; willpower_spent: boolean; sheet_values: Record<string, unknown> | null };

const apiBase = process.env.NEXT_PUBLIC_API_URL;

async function authorizedFetch(path: string, init: RequestInit = {}) {
  if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para acessar a API.");
  const { data } = await createClient().auth.getSession();
  if (!data.session) throw new Error("Entre na campanha para rolar.");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === "string" ? body.detail : "A API recusou a operação.");
  }
  return response.json();
}

function summary(outcome: Outcome) {
  const parts = [`${outcome.successes} sucesso(s)`, outcome.success ? "atingiu" : "falhou"];
  if (outcome.messy_critical) parts.push("crítico sujo");
  else if (outcome.clean_critical) parts.push("crítico");
  if (outcome.bestial_failure) parts.push("falha bestial");
  return parts.join(" · ");
}

function Die({ face, hunger, selected, disabled, onClick }: { face: number; hunger?: boolean; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={hunger ? undefined : selected}
    aria-label={`${hunger ? "Dado de Fome" : "Dado comum"} ${face}${selected ? ", marcado para rerrolar" : ""}`}
    style={{
      width: 38, height: 38, fontWeight: "bold", border: `2px solid ${selected ? "#b84a31" : hunger ? "#8e3c37" : "#172020"}`,
      background: hunger ? "#8e3c37" : selected ? "#f3d9cf" : "#fffef9", color: hunger ? "#fff" : "#172020",
      cursor: disabled ? "default" : "pointer",
    }}>{face}</button>;
}

/** Rolagem guardada no servidor e rerrolagem efetiva de Vontade (V5-07). */
export function V5WillpowerReroll({ sheetId, pool, difficulty, contextTags }: { sheetId: string; pool: number; difficulty: number; contextTags: string[] }) {
  const [history, setHistory] = useState<StoredRoll[]>([]);
  const [current, setCurrent] = useState<StoredRoll | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      const rows = await authorizedFetch(`/api/v1/v5/sheets/${sheetId}/rolls?limit=10`) as StoredRoll[];
      setHistory(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar o histórico.");
    }
  }, [sheetId]);

  useEffect(() => { setCurrent(null); setSelected([]); void loadHistory(); }, [loadHistory]);

  async function roll() {
    setBusy(true); setMessage("");
    try {
      const saved = await authorizedFetch(`/api/v1/v5/sheets/${sheetId}/rolls`, {
        method: "POST", body: JSON.stringify({ pool, difficulty, context_tags: contextTags }),
      }) as StoredRoll;
      setCurrent(saved); setSelected([]);
      setHistory((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)].slice(0, 10));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível rolar.");
    } finally { setBusy(false); }
  }

  async function reroll() {
    if (!current || !selected.length) return;
    setBusy(true); setMessage("");
    try {
      const result = await authorizedFetch(`/api/v1/v5/rolls/${current.id}/willpower-reroll`, {
        method: "POST", body: JSON.stringify({ normal_indices: selected }),
      }) as RerollResponse;
      setCurrent(result.roll); setSelected([]);
      setHistory((rows) => rows.map((row) => (row.id === result.roll.id ? result.roll : row)));
      setMessage(result.willpower_spent ? "Rerrolagem feita. 1 ponto de dano superficial de Vontade foi marcado na ficha." : "Rerrolagem feita. Este modelo de ficha não tem trilha de Vontade.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível rerrolar.");
    } finally { setBusy(false); }
  }

  const canReroll = current !== null && current.rerolled_at === null;
  const toggle = (index: number) => setSelected((items) => items.includes(index)
    ? items.filter((item) => item !== index)
    : items.length < 3 ? [...items, index] : items);

  return <article className="generation-card" aria-labelledby="v5-willpower-title">
    <p className="eyebrow">ROLAGEM DA FICHA</p>
    <h3 id="v5-willpower-title">Rolar e rerrolar com Vontade</h3>
    <p className="probability-note">O servidor rola {pool} dados com a Fome e as condições da ficha, contra dificuldade {difficulty}. Depois você pode rerrolar até 3 dados comuns uma vez; Dados de Fome não mudam.</p>
    <button type="button" className="primary" onClick={() => void roll()} disabled={busy}>{busy ? "Aguarde…" : "Rolar e guardar"}</button>
    {current && <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {current.normal_dice.map((face, index) => <Die key={`n${index}`} face={face} selected={selected.includes(index)}
          disabled={!canReroll || busy} onClick={() => toggle(index)} />)}
        {current.hunger_dice.map((face, index) => <Die key={`h${index}`} face={face} hunger disabled />)}
      </div>
      <p role="status" style={{ margin: 0 }}><b>{summary(current.outcome)}</b> (dificuldade {current.difficulty})</p>
      {current.original_normal_dice && <p className="probability-note">Antes da Vontade: {current.original_normal_dice.join(", ")}. Rerrolados: dados {current.rerolled_indices?.map((index) => index + 1).join(", ")}.</p>}
      {canReroll && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="quiet" disabled={busy || !current.recommended_reroll.length}
          onClick={() => setSelected(current.recommended_reroll)}>
          {current.recommended_reroll.length ? `Sugestão ótima: dados ${current.recommended_reroll.map((index) => index + 1).join(", ")}` : "Rerrolar não melhora esta rolagem"}
        </button>
        <button type="button" className="primary" disabled={busy || !selected.length} onClick={() => void reroll()}>
          Rerrolar {selected.length || ""} com Vontade
        </button>
      </div>}
    </div>}
    {message && <p className="auth-message" role="status">{message}</p>}
    {history.length > 0 && <details style={{ marginTop: 12 }}>
      <summary className="probability-note">Histórico recente ({history.length})</summary>
      <ol style={{ paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
        {history.map((row) => <li key={row.id}>
          {new Date(row.created_at).toLocaleString("pt-BR")} · {row.pool} dados (Fome {row.hunger}) · dif. {row.difficulty} · {summary(row.outcome)}{row.rerolled_at ? " · com Vontade" : ""}
        </li>)}
      </ol>
    </details>}
  </article>;
}
