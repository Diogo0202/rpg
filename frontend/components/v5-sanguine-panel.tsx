"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useCharacterSession, type SessionCharacter } from "../lib/character-session";
import { createClient } from "../lib/supabase/client";
import {
  BOND_DEGREE_LABELS, V5_CLAN_BANES, V5_INTENSITIES, V5_RESONANCES, baneSeverity, hungerAfterHunt, resonanceEffectPreview,
  type V5Intensity, type V5Resonance,
} from "../lib/v5-sanguine";
import styles from "./v5-sanguine-panel.module.css";

/**
 * SAN-01/02/03 do V5: caçada (Fome e Ressonância), Vínculo de Sangue e ações contra o Regente.
 * O ciclo do Sangue (Rouse, Remorso, Frenesi) fica no painel "Sangue" da frente F1.
 */

type Hunt = { id: string; prey: string; resonance: string; intensity: string; dyscrasia: string | null; hunger_before: number; hunger_after: number; killed: boolean; created_at: string };
type Drink = { id: string; drank_at: string; notes: string | null };
type Bond = { id: string; regnant_label: string; regnant_sheet_id: string | null; regnant_entity_id: string | null; decay_days: number; degree: number; drinks: Drink[] };
type RegnantAction = { id: string; bond_id: string; action: string; bond_degree: number; pool: number | null; difficulty: number | null; successes: number | null; passed: boolean | null; status: "pendente" | "permitida" | "negada"; decision_note: string | null; created_at: string };
type StoredRoll = { id: string; pool: number; difficulty: number; outcome: { successes?: number; success?: boolean }; created_at: string };
type Option = { id: string; name: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

function errorDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item && typeof item === "object" && "msg" in item ? String(item.msg) : fallback).join(" ");
  }
  return fallback;
}

async function api<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new Error("Configure NEXT_PUBLIC_API_URL para usar este painel.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre na campanha para continuar.");
  const response = await fetch(`${API_URL}/api/v1/v5${path}`, {
    method,
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(errorDetail(parsed, "A API recusou o pedido."));
  return parsed as T;
}

const integer = (value: unknown, fallback = 0) => typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function V5SanguinePanel({ campaignId, canEdit, canNarrate }: { campaignId: string; canEdit: boolean; canNarrate: boolean }) {
  const { character, acceptSavedCharacter } = useCharacterSession();
  const characterId = character?.id;
  const currentId = useRef(characterId);
  currentId.current = characterId;
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [actions, setActions] = useState<RegnantAction[]>([]);
  const [rolls, setRolls] = useState<StoredRoll[]>([]);
  const [sheets, setSheets] = useState<Option[]>([]);
  const [npcs, setNpcs] = useState<Option[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Hunt form; the operation ID survives a failed send so a retry cannot apply twice.
  const [prey, setPrey] = useState("");
  const [resonance, setResonance] = useState<V5Resonance>("Nenhuma");
  const [intensity, setIntensity] = useState<V5Intensity>("Nenhuma");
  const [dyscrasia, setDyscrasia] = useState("");
  const [slake, setSlake] = useState(1);
  const [killed, setKilled] = useState(false);
  const huntOperation = useRef<string | null>(null);

  // Drink form (narrator).
  const [donorKind, setDonorKind] = useState<"sheet" | "npc">("sheet");
  const [donorId, setDonorId] = useState("");
  const [drankAt, setDrankAt] = useState("");
  const [drinkNotes, setDrinkNotes] = useState("");
  const drinkOperation = useRef<string | null>(null);

  // Regnant action form.
  const [actionBond, setActionBond] = useState("");
  const [actionText, setActionText] = useState("");
  const [actionRoll, setActionRoll] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const load = useCallback(async (sheetId: string) => {
    try {
      const [nextHunts, nextBonds, nextActions, nextRolls] = await Promise.all([
        api<Hunt[]>("GET", `/sheets/${sheetId}/hunts?limit=10`),
        api<Bond[]>("GET", `/sheets/${sheetId}/blood-bonds`),
        api<RegnantAction[]>("GET", `/sheets/${sheetId}/regnant-actions`),
        api<StoredRoll[]>("GET", `/sheets/${sheetId}/rolls?limit=10`).catch(() => []),
      ]);
      if (currentId.current !== sheetId) return;
      setHunts(nextHunts); setBonds(nextBonds); setActions(nextActions); setRolls(nextRolls);
    } catch (error) {
      if (currentId.current === sheetId) setMessage(error instanceof Error ? error.message : "Falha ao ler caçadas e vínculos.");
    }
  }, []);

  useEffect(() => {
    setHunts([]); setBonds([]); setActions([]); setRolls([]); setMessage("");
    if (characterId) void load(characterId);
  }, [characterId, load]);

  useEffect(() => {
    if (!canNarrate) return;
    let active = true;
    (async () => {
      try {
        const client = createClient();
        const [sheetRows, npcRows] = await Promise.all([
          client.from("character_sheets").select("id,name").eq("campaign_id", campaignId).order("name"),
          client.from("world_entities").select("id,name").eq("campaign_id", campaignId).eq("kind", "npc").order("name"),
        ]);
        if (!active) return;
        setSheets((sheetRows.data ?? []) as Option[]);
        setNpcs((npcRows.data ?? []) as Option[]);
      } catch { /* the donor list stays empty without Supabase */ }
    })();
    return () => { active = false; };
  }, [campaignId, canNarrate]);

  const values = character?.values ?? {};
  const hunger = integer(values.fome);
  const potency = integer(values.potencia_sangue);
  const clan = typeof values.cla === "string" ? values.cla : "";
  const bane = V5_CLAN_BANES[clan];
  const effectPreview = useMemo(() => resonanceEffectPreview(resonance, intensity, prey || "presa"), [resonance, intensity, prey]);

  async function run<T>(work: () => Promise<T>, done: string): Promise<T | null> {
    setBusy(true); setMessage("");
    try {
      const result = await work();
      setMessage(done);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao gravar.");
      return null;
    } finally { setBusy(false); }
  }

  async function submitHunt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!character) return;
    const selected = character;
    huntOperation.current ??= crypto.randomUUID();
    const result = await run(() => api<{ sheet_values: Record<string, unknown> | null; effects: SessionCharacter["effects"] | null; sheet_version: number | null }>(
      "POST", `/sheets/${selected.id}/hunts`, {
        operation_id: huntOperation.current, prey: prey.trim(), resonance, intensity,
        dyscrasia: intensity === "Aguda" && dyscrasia.trim() ? dyscrasia.trim() : null, slake, killed,
      }), "Caçada registrada na ficha.");
    if (!result) return;
    huntOperation.current = null;
    if (result.sheet_values && result.effects && result.sheet_version) {
      acceptSavedCharacter({ ...selected, values: result.sheet_values, effects: result.effects, version: result.sheet_version });
    }
    setPrey(""); setDyscrasia(""); setKilled(false);
    void load(selected.id);
  }

  async function submitDrink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!character || !donorId) return;
    const selected = character;
    drinkOperation.current ??= crypto.randomUUID();
    const result = await run(() => api("POST", `/sheets/${selected.id}/blood-bonds/drinks`, {
      operation_id: drinkOperation.current,
      ...(donorKind === "sheet" ? { regnant_sheet_id: donorId } : { regnant_entity_id: donorId }),
      ...(drankAt ? { drank_at: new Date(drankAt).toISOString() } : {}),
      notes: drinkNotes.trim() || null,
    }), "Ingestão registrada no Vínculo.");
    if (result === null) return;
    drinkOperation.current = null;
    setDrinkNotes(""); setDrankAt("");
    void load(selected.id);
  }

  async function changeDecay(bond: Bond, days: number) {
    if (!character || !Number.isInteger(days) || days < 1 || days > 3650) return;
    const selected = character;
    if (await run(() => api("PATCH", `/blood-bonds/${bond.id}`, { decay_days: days }), "Decaimento do Vínculo atualizado.") !== null) void load(selected.id);
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!character || !actionBond || !actionText.trim()) return;
    const selected = character;
    const result = await run(() => api("POST", `/blood-bonds/${actionBond}/regnant-actions`, { action: actionText.trim(), roll_id: actionRoll || null }),
      "Teste registrado. O narrador decide se a ação acontece.");
    if (result === null) return;
    setActionText(""); setActionRoll("");
    void load(selected.id);
  }

  async function decide(action: RegnantAction, decision: "permitida" | "negada") {
    if (!character) return;
    const selected = character;
    if (await run(() => api("POST", `/regnant-actions/${action.id}/decision`, { decision, note: decisionNotes[action.id]?.trim() || null }),
      decision === "permitida" ? "Ação permitida." : "Ação negada.") !== null) void load(selected.id);
  }

  if (!character) return <section className={`content ${styles.panel}`}><h2>Caçada e Vínculos</h2><p>Selecione uma ficha V5 salva na barra da sessão.</p></section>;

  return <section className={`content ${styles.panel}`} aria-busy={busy}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>VAMPIRO V5 · {character.name.toUpperCase()}</p><h2>Caçada, Vínculo e Regente</h2></div>
      <p>Fome {hunger} · Potência {potency}{bane ? ` · Perdição ${bane.name} (Severidade ${baneSeverity(potency)})` : ""}. Regras resumidas, a conferir no livro.</p>
    </header>
    <div className={styles.layout}>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Caçada e alimentação</h3>
          <form className={styles.form} onSubmit={submitHunt}>
            <label>Presa<input value={prey} maxLength={120} required onChange={(event) => setPrey(event.target.value)} placeholder="Tipo de presa e lugar" /></label>
            <div className={styles.grid}>
              <label>Ressonância<select value={resonance} onChange={(event) => { const next = event.target.value as V5Resonance; setResonance(next); setIntensity(next === "Nenhuma" ? "Nenhuma" : intensity === "Nenhuma" ? "Fugaz" : intensity); }}>
                {V5_RESONANCES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Intensidade<select value={intensity} disabled={resonance === "Nenhuma"} onChange={(event) => setIntensity(event.target.value as V5Intensity)}>
                {V5_INTENSITIES.filter((item) => (resonance === "Nenhuma") === (item === "Nenhuma")).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Fome saciada<input type="number" min={0} max={5} value={slake} onChange={(event) => setSlake(Math.max(0, Math.min(5, Number(event.target.value) || 0)))} /></label>
              <label className={styles.check}><input type="checkbox" checked={killed} onChange={(event) => setKilled(event.target.checked)} /> A presa morreu</label>
            </div>
            {intensity === "Aguda" && <label>Discrasia<input value={dyscrasia} maxLength={160} onChange={(event) => setDyscrasia(event.target.value)} placeholder="Nome aprovado pela mesa" /></label>}
            <p className={styles.preview}>Fome {hunger} → {hungerAfterHunt(hunger, slake, killed, potency)}.{" "}
              {effectPreview ? `Efeito: +${effectPreview.delta} dado em ${effectPreview.applies_to_tags.join(", ")} (use essas tags na rolagem).` : "Sem bônus de Ressonância; o efeito anterior sai da ficha."}</p>
            <button className={styles.primary} type="submit" disabled={busy || !canEdit || !prey.trim()}>Registrar caçada</button>
          </form>
          <h4>Últimas caçadas</h4>
          <ul className={styles.list}>
            {hunts.map((hunt) => <li key={hunt.id}><b>{hunt.prey}</b><small>{when(hunt.created_at)} · {hunt.resonance}{hunt.resonance !== "Nenhuma" ? ` (${hunt.intensity})` : ""}{hunt.dyscrasia ? ` · Discrasia: ${hunt.dyscrasia}` : ""} · Fome {hunt.hunger_before} → {hunt.hunger_after}{hunt.killed ? " · presa morta" : ""}</small></li>)}
            {!hunts.length && <li><small>Nenhuma caçada registrada.</small></li>}
          </ul>
        </article>
        {bane && <article className={styles.card}>
          <h3>Perdição do clã</h3>
          <p><b>{bane.name}</b> · Severidade {baneSeverity(potency)}</p>
          <p className={styles.note}>{bane.effect}</p>
        </article>}
      </div>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Vínculo de Sangue</h3>
          <ul className={styles.list}>
            {bonds.map((bond) => <li key={bond.id}>
              <span><b>{bond.regnant_label}</b><span className={styles.degree}>{BOND_DEGREE_LABELS[bond.degree] ?? bond.degree}</span></span>
              <small>{bond.drinks.length} ingestões: {bond.drinks.map((drink) => when(drink.drank_at)).join(", ") || "nenhuma"}</small>
              <small>Perde um grau a cada {bond.decay_days} dias sem beber.</small>
              {canNarrate && <label>Decaimento em dias<input type="number" min={1} max={3650} defaultValue={bond.decay_days} onBlur={(event) => { const days = Number(event.target.value); if (days !== bond.decay_days) void changeDecay(bond, days); }} /></label>}
            </li>)}
            {!bonds.length && <li><small>Nenhum vínculo registrado para esta ficha.</small></li>}
          </ul>
          {canNarrate && <form className={styles.form} onSubmit={submitDrink}>
            <h4>Registrar ingestão (narrador)</h4>
            <div className={styles.grid}>
              <label>Doador<select value={donorKind} onChange={(event) => { setDonorKind(event.target.value as "sheet" | "npc"); setDonorId(""); }}>
                <option value="sheet">Ficha da campanha</option><option value="npc">NPC da campanha</option></select></label>
              <label>Quem deu o sangue<select value={donorId} required onChange={(event) => setDonorId(event.target.value)}>
                <option value="">Escolha</option>
                {(donorKind === "sheet" ? sheets.filter((sheet) => sheet.id !== character.id) : npcs).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
              <label>Quando<input type="datetime-local" value={drankAt} onChange={(event) => setDrankAt(event.target.value)} /></label>
              <label>Notas<input value={drinkNotes} maxLength={300} onChange={(event) => setDrinkNotes(event.target.value)} /></label>
            </div>
            <button className={styles.primary} type="submit" disabled={busy || !donorId}>Registrar ingestão</button>
          </form>}
          {!canNarrate && <p className={styles.note}>Só o narrador registra ingestões. Você vê os vínculos da sua ficha.</p>}
        </article>
        <article className={styles.card}>
          <h3>Agir contra o Regente</h3>
          <form className={styles.form} onSubmit={submitAction}>
            <div className={styles.grid}>
              <label>Vínculo<select value={actionBond} required onChange={(event) => setActionBond(event.target.value)}>
                <option value="">Escolha</option>{bonds.map((bond) => <option key={bond.id} value={bond.id}>{bond.regnant_label} ({BOND_DEGREE_LABELS[bond.degree]})</option>)}</select></label>
              <label>Teste de resistência<select value={actionRoll} onChange={(event) => setActionRoll(event.target.value)}>
                <option value="">Sem rolagem guardada</option>
                {rolls.map((roll) => <option key={roll.id} value={roll.id}>{when(roll.created_at)} · {roll.pool} dados, dif. {roll.difficulty}: {roll.outcome.successes ?? 0} sucessos</option>)}</select></label>
            </div>
            <label>Ação<input value={actionText} maxLength={300} required onChange={(event) => setActionText(event.target.value)} placeholder="O que a personagem tenta fazer contra o Regente" /></label>
            <p className={styles.note}>Role o teste em Ações V5 e escolha a rolagem aqui. O resultado fica registrado, mas quem permite ou nega a ação é o narrador.</p>
            <button className={styles.primary} type="submit" disabled={busy || !actionBond || !actionText.trim() || !(canEdit || canNarrate)}>Registrar teste</button>
          </form>
          <ul className={styles.list}>
            {actions.map((action) => <li key={action.id}>
              <b>{action.action}</b>
              <small>{when(action.created_at)} · grau {action.bond_degree}{action.pool ? ` · ${action.pool} dados, dif. ${action.difficulty}: ${action.successes} sucessos (${action.passed ? "passou" : "não passou"})` : " · sem rolagem"}</small>
              <small>Decisão: {action.status}{action.decision_note ? ` · ${action.decision_note}` : ""}</small>
              {canNarrate && action.status === "pendente" && <div className={styles.row}>
                <label>Nota<input value={decisionNotes[action.id] ?? ""} maxLength={500} onChange={(event) => setDecisionNotes((current) => ({ ...current, [action.id]: event.target.value }))} /></label>
                <button type="button" disabled={busy} onClick={() => void decide(action, "permitida")}>Permitir</button>
                <button type="button" disabled={busy} onClick={() => void decide(action, "negada")}>Negar</button>
              </div>}
            </li>)}
            {!actions.length && <li><small>Nenhuma ação contra o Regente registrada.</small></li>}
          </ul>
        </article>
      </div>
    </div>
    <p className={styles.status} role="status" aria-live="polite">{message}</p>
  </section>;
}
