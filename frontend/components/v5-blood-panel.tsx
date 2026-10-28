"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useCharacterSession, type SessionCharacter } from "../lib/character-session";
import { createClient } from "../lib/supabase/client";
import {
  BLOOD_REVIEW_RULES, COMPULSION_OPTIONS, bloodState, feedingPenaltyLabel, rouseSuccessChance, type FrenzyKind,
} from "../lib/v5-blood";
import { describeV5Power, v5PowerMetadata, V5_POWER_METADATA_REVIEW } from "../lib/v5-creation-data";
import styles from "./v5-action-panel.module.css";

type BloodEvent = { id: number; kind: string; dice: number[]; outcome: Record<string, unknown>; created_at?: string };
type BloodResponse = { replayed: boolean; outcome: Record<string, unknown>; dice: number[]; event_id: number | null; sheet: Record<string, unknown> | null };

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const KIND_LABELS: Record<string, string> = {
  rouse: "Rouse", awaken: "Despertar", remorse: "Remorso", frenzy: "Frenesi", compulsion: "Compulsão", torpor: "Torpor",
};
const FRENZY_LABELS: Record<FrenzyKind, string> = { fury: "Fúria", hunger: "Fome", terror: "Terror (Rötschreck)" };

async function api(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  if (!API_URL) throw new Error("Configure NEXT_PUBLIC_API_URL para usar o painel de Sangue.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre na campanha para agir sobre o Sangue.");
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const parsed = await response.json().catch(() => null) as { detail?: unknown } | null;
  if (!response.ok) throw new Error(typeof parsed?.detail === "string" ? parsed.detail : "O servidor recusou a ação de Sangue.");
  return parsed;
}

/** Short text for one stored blood event. */
export function describeBloodEvent(event: Pick<BloodEvent, "kind" | "outcome">): string {
  const o = event.outcome;
  switch (event.kind) {
    case "rouse":
    case "awaken":
      return `${o.success ? "sem aumento" : "falhou"} · Fome ${o.hunger_before} → ${o.hunger_after}${o.hunger_frenzy_test ? " · teste de frenesi de fome" : ""}${o.rerolled ? " · rerrolado pela Potência" : ""}`;
    case "remorse":
      return `${o.success ? "manteve" : "perdeu 1"} Humanidade (${o.humanity_before} → ${o.humanity_after}) · Manchas limpas`;
    case "frenzy":
      return `${FRENZY_LABELS[o.kind as FrenzyKind] ?? o.kind}: ${o.successes} sucessos / dif. ${o.difficulty} · ${o.frenzy ? "entra em frenesi" : "resistiu"}`;
    case "compulsion":
      return `${o.compulsion}${o.clan_compulsion ? ` (${o.clan_compulsion})` : ""}${o.rolled ? " · sorteada" : ""}`;
    case "torpor":
      return o.in_torpor ? `entrou em Torpor · duração ${o.duration}` : "saiu do Torpor";
    default:
      return "";
  }
}

export function V5BloodPanel({ canEdit }: { canEdit: boolean }) {
  const { character, acceptSavedCharacter } = useCharacterSession();
  const pending = useRef(new Map<string, string>());
  const [events, setEvents] = useState<BloodEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [power, setPower] = useState("");
  const [frenzy, setFrenzy] = useState<{ difficulty: number; kind: FrenzyKind }>({ difficulty: 3, kind: "fury" });
  const [compulsion, setCompulsion] = useState("");

  const loadEvents = useCallback(async (sheetId: string) => {
    try {
      const rows = await api(`/api/v1/v5/sheets/${sheetId}/blood-events?limit=20`);
      setEvents(Array.isArray(rows) ? rows as BloodEvent[] : []);
    } catch {
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    setEvents([]);
    setMessage("");
    setPower("");
    pending.current.clear();
    if (character?.id) void loadEvents(character.id);
  }, [character?.id, loadEvents]);

  if (!character) return <section className={`content ${styles.panel}`}><h2>Sangue V5</h2><p>Selecione uma ficha de Vampiro V5 salva.</p></section>;
  const selected: SessionCharacter = character;
  const state = bloodState(selected.values);
  const powers = (Array.isArray(selected.values.disciplinas) ? selected.values.disciplinas : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => ({ item, meta: v5PowerMetadata(item) }));
  const chosen = powers.find((entry) => entry.item === power)?.meta ?? null;
  const notVampire = typeof selected.values.fome !== "number" || typeof selected.values.potencia_sangue !== "number";

  async function act(action: string, path: string, body: Record<string, unknown>, done: (result: BloodResponse) => string) {
    // A retry after a lost reply reuses the same operation ID, so the database never rolls twice.
    const key = `${selected.id}:${action}:${JSON.stringify(body)}`;
    const operationId = pending.current.get(key) ?? crypto.randomUUID();
    pending.current.set(key, operationId);
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/api/v1/v5/sheets/${selected.id}/${path}`, { method: "POST", body: { operation_id: operationId, ...body } }) as BloodResponse;
      pending.current.delete(key);
      const sheet = result.sheet;
      if (sheet && sheet.id === selected.id) {
        acceptSavedCharacter({ id: selected.id, name: selected.name, version: sheet.version, values: sheet.values, effects: sheet.effects ?? selected.effects } as SessionCharacter);
      }
      setMessage(`${result.replayed ? "Já registrado: " : ""}${done(result)} Dados: ${result.dice.join(" · ") || "nenhum"}.`);
      await loadEvents(selected.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na ação de Sangue.");
    } finally {
      setBusy(false);
    }
  }

  const describe = (kind: string) => (result: BloodResponse) => `${KIND_LABELS[kind]}: ${describeBloodEvent({ kind, outcome: result.outcome })}.`;
  const disabled = !canEdit || busy || notVampire;
  const potency = state.potency;

  return <section className={`content ${styles.panel}`} aria-busy={busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>V5 · SANGUE</p><h2>{selected.name}</h2></div>
      <p>O servidor rola os dados e grava Fome, Manchas, Humanidade, Compulsão e Torpor numa única operação, com registro de auditoria.</p></header>
    {notVampire && <p role="status" className={styles.message}>Esta ficha não tem Fome e Potência de Sangue: o ciclo do Sangue vale só para fichas de Vampiro V5.</p>}
    <div className={styles.layout}>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Potência de Sangue {potency.potency}</h3>
          <p className={styles.poolLine}>Surto de Sangue <b>+{potency.surge} dados</b> · Remendar <b>{potency.mend} superficial</b> · Bônus de Poder <b>+{potency.power_bonus}</b></p>
          <p className={styles.poolLine}>Rerrolagem de Rouse <b>{potency.rouse_reroll_level ? `poderes até o nível ${potency.rouse_reroll_level}` : "nenhuma"}</b> · Severidade da Perdição <b>{potency.bane_severity}</b></p>
          <p className={styles.poolLine}>Alimentação: <b>{feedingPenaltyLabel(potency)}</b></p>
          <p className={styles.poolLine}>Fome <b>{state.hunger}/5</b> · Humanidade <b>{state.humanity}</b> · Manchas <b>{state.stains}</b> · Vontade atual <b>{state.willpowerCurrent}</b>{state.inTorpor ? <> · <b>Em Torpor</b></> : null}</p>
        </article>
        <article className={styles.card}>
          <h3>Rouse e Despertar</h3>
          <label>Poder de Disciplina (opcional)<select value={power} onChange={(event) => setPower(event.target.value)}>
            <option value="">Sem poder (Surto, Remendar ou outro)</option>
            {powers.map((entry) => <option key={entry.item} value={entry.item}>{entry.item}{entry.meta ? ` · ${describeV5Power(entry.meta)}` : ""}</option>)}
          </select></label>
          <p className={styles.note}>Chance de não aumentar a Fome: {Math.round(rouseSuccessChance(potency.potency, chosen?.level) * 100)}%{chosen && chosen.level <= potency.rouse_reroll_level ? " (rerrolagem pela Potência)" : ""}.</p>
          <div className={styles.quickButtons}>
            <button type="button" disabled={disabled} onClick={() => void act("rouse", "rouse", { discipline_level: chosen?.level ?? null, reason: power ? power.slice(0, 120) : null }, describe("rouse"))}>Rouse Check</button>
            <button type="button" disabled={disabled || state.inTorpor} onClick={() => void act("awaken", "awaken", {}, describe("awaken"))}>Despertar ao anoitecer</button>
          </div>
          {state.hunger === 5 && <p className={styles.penalty}>Fome 5: um Rouse que falhar pede teste de frenesi de fome.</p>}
        </article>
        <article className={styles.card}>
          <h3>Remorso e Frenesi</h3>
          <p className={styles.poolLine}>Teste de Remorso: <b>{state.stains ? `${state.remorsePool} dado(s) · ${Math.round((state.remorseChance ?? 0) * 100)}% de manter a Humanidade` : "sem Manchas"}</b></p>
          <button type="button" disabled={disabled || state.stains === 0} onClick={() => void act("remorse", "remorse", {}, describe("remorse"))}>Teste de Remorso</button>
          <form className={styles.manualForm} onSubmit={(event) => { event.preventDefault(); void act("frenzy", "frenzy", frenzy, describe("frenzy")); }}>
            <label>Tipo<select value={frenzy.kind} onChange={(event) => setFrenzy({ ...frenzy, kind: event.target.value as FrenzyKind })}>
              {(Object.keys(FRENZY_LABELS) as FrenzyKind[]).map((kind) => <option key={kind} value={kind}>{FRENZY_LABELS[kind]}</option>)}
            </select></label>
            <label>Dificuldade<input type="number" min={1} max={10} value={frenzy.difficulty} onChange={(event) => setFrenzy({ ...frenzy, difficulty: Number(event.target.value) })} /></label>
            <button type="submit" disabled={disabled}>Resistir ({state.frenzyPool[frenzy.kind]} dados)</button>
          </form>
          <p className={styles.note}>Parada: Vontade atual + Humanidade ÷ 3{selected.values.cla === "Brujah" ? "; Brujah perdem a Severidade da Perdição contra a fúria" : ""}.</p>
        </article>
        <article className={styles.card}>
          <h3>Compulsão e Torpor</h3>
          <p className={styles.poolLine}>Compulsão atual: <b>{state.compulsion ?? "Nenhuma"}</b>{state.compulsionDetail ? ` · ${state.compulsionDetail.name}: ${state.compulsionDetail.effect}` : ""}</p>
          {state.clanCompulsion && <p className={styles.note}>Do clã: {state.clanCompulsion.name} ({state.clanCompulsion.effect}).</p>}
          <form className={styles.manualForm} onSubmit={(event) => { event.preventDefault(); void act("compulsion", "compulsion", { compulsion: compulsion || null }, describe("compulsion")); }}>
            <label>Compulsão<select value={compulsion} onChange={(event) => setCompulsion(event.target.value)}>
              <option value="">Sortear no d10</option>
              {COMPULSION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select></label>
            <button type="submit" disabled={disabled}>Registrar</button>
          </form>
          <div className={styles.quickButtons} style={{ marginTop: 12 }}>
            <button type="button" disabled={disabled} onClick={() => void act("torpor", "torpor", { in_torpor: !state.inTorpor }, describe("torpor"))}>{state.inTorpor ? "Sair do Torpor" : "Entrar em Torpor"}</button>
          </div>
          <p className={styles.note}>Duração do Torpor com Humanidade {state.humanity}: {state.torporDuration}. O modelo da ficha precisa do campo “Em Torpor”.</p>
        </article>
      </div>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Histórico do Sangue</h3>
          {message && <p role="status" className={styles.message}>{message}</p>}
          {events.length === 0 ? <p>Nenhuma ação de Sangue registrada.</p> : <ol className={styles.history}>
            {events.map((event) => <li key={event.id}>
              <div><b>{KIND_LABELS[event.kind] ?? event.kind}</b>{event.created_at && <time>{new Date(event.created_at).toLocaleString()}</time>}</div>
              {event.dice.length > 0 && <div className={styles.dice}>{event.dice.map((face, index) => <span key={index} className={styles.die} style={{ display: "inline-grid", placeItems: "center" }}>{face}</span>)}</div>}
              <p>{describeBloodEvent(event)}</p>
            </li>)}
          </ol>}
          <p className={styles.note}>Regras para conferir no livro: {[...BLOOD_REVIEW_RULES, V5_POWER_METADATA_REVIEW].join(" ")}</p>
        </article>
      </div>
    </div>
  </section>;
}
