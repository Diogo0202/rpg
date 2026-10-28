"use client";

import { useEffect, useState } from "react";

import { useCharacterSession } from "../lib/character-session";
import { inDespair } from "../lib/hunter-traits";
import type { FieldValue } from "../lib/sheet-template";
import { createClient } from "../lib/supabase/client";
import { authenticatedPost } from "./character-effects-panel";
import styles from "./system-roll-panel.module.css";

/**
 * F4: Caçador at the table. The roll itself is built in system-roll-panel.tsx and goes to
 * POST /api/v1/hunter/sheets/{id}/rolls (dice and the cell's Desperation come from the database).
 * This card shows the cell, resolves a Desperation 1 (Overreach: cell Danger +1; Despair: marks the
 * sheet), the one Willpower reroll of up to 3 ordinary dice, the Edges (blocked in Despair) and the
 * Redemption by the Drive with the narrator's decision. Rules marked in docs/CACADOR_CRIACAO_GUIADA.md.
 */
export type HunterCell = { id: string; name: string; danger: number; desperation: number; version: number };
export type HunterRedemption = { id: string; drive: string; redemption: string; note: string; status: string };
export type HunterState = { cell: HunterCell | null; in_despair: boolean; edges_blocked: boolean; pending_redemption: HunterRedemption | null };
export type HunterRoll = {
  roll_id: string; normal_dice: number[]; desperation_dice: number[]; desperation_ones: number; successes: number;
  difficulty: number; success: boolean; critical_pairs: number; critical: boolean; desperation_consequence: "despair" | "table_choice" | null;
  resolution: "overreach" | "despair" | null; choices: Array<"overreach" | "despair">; can_reroll: boolean; verdict: string;
  cell?: HunterCell | null;
};

const CHOICE_LABEL = { overreach: "Overreach: mantém o sucesso, Perigo da célula +1", despair: "Despair: o teste falha e o caçador entra em Desespero" };

/** The cell, Despair state and pending Redemption of a sheet (RPC hunter_sheet_state); null id skips the read. */
export function useHunterState(sheetId: string | null | undefined, revision: number): HunterState | null {
  const [state, setState] = useState<{ id: string; value: HunterState | null } | null>(null);
  useEffect(() => {
    if (!sheetId) return;
    let active = true;
    void createClient().rpc("hunter_sheet_state", { p_sheet_id: sheetId }).then(({ data, error }) => {
      if (active) setState({ id: sheetId, value: error ? null : data as HunterState });
    });
    return () => { active = false; };
  }, [sheetId, revision]);
  return sheetId && state?.id === sheetId ? state.value : null;
}

export function HunterConsequencesCard({ latest, state, canManage, onRoll, onChanged }: {
  latest: HunterRoll | null; state: HunterState | null; canManage: boolean;
  onRoll: (roll: HunterRoll) => void; onChanged: () => void;
}) {
  const { character, acceptSavedCharacter } = useCharacterSession();
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const rollId = latest?.roll_id;
  useEffect(() => { setSelected([]); setMessage(""); }, [rollId, character?.id]);
  if (!character) return null;
  const values = character.values as Record<string, FieldValue>;
  const despair = state?.in_despair ?? inDespair(values);
  const edges = Array.isArray(values.triunfos) ? values.triunfos.filter((item): item is string => typeof item === "string") : [];
  const perks = Array.isArray(values.distincoes) ? values.distincoes.filter((item): item is string => typeof item === "string") : [];

  async function refreshSheet() {
    const sheetId = character!.id;
    const { data } = await createClient().from("character_sheets").select("id,name,version,values").eq("id", sheetId).maybeSingle();
    if (data) acceptSavedCharacter({ ...character!, ...data });
    onChanged();
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "A ação falhou."); } finally { setBusy(false); }
  }

  const reroll = () => void run(async () => {
    onRoll(await authenticatedPost(`/api/v1/hunter/rolls/${rollId}/reroll`, { indices: selected }) as HunterRoll);
    setSelected([]);
    await refreshSheet();
  });
  const resolve = (choice: "overreach" | "despair") => void run(async () => {
    onRoll(await authenticatedPost(`/api/v1/hunter/rolls/${rollId}/resolve`, { choice }) as HunterRoll);
    await refreshSheet();
  });
  const requestRedemption = () => void run(async () => {
    await authenticatedPost(`/api/v1/hunter/sheets/${character.id}/redemption`, { note: note.trim().slice(0, 500) });
    setNote(""); setMessage("Redenção registrada; o narrador decide.");
    onChanged();
  });
  const decide = (approve: boolean) => void run(async () => {
    await authenticatedPost(`/api/v1/hunter/redemptions/${state?.pending_redemption?.id}/decision`, { approve, note: "" });
    setMessage(approve ? "Redenção aprovada: o Desespero terminou." : "Redenção recusada.");
    await refreshSheet();
  });
  const toggleDie = (index: number) => setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : current.length >= 3 ? current : [...current, index]);

  return <article className={styles.card} aria-label="Consequências do Caçador">
    <h3>Célula e consequências</h3>
    <p className={styles.poolLine}>{state?.cell
      ? <>Célula <b>{state.cell.name}</b>: Desesperação <b>{state.cell.desperation}</b> · Perigo <b>{state.cell.danger}</b></>
      : "Ficha sem célula vinculada: o narrador inclui a ficha no painel de células."}</p>
    {latest && <>
      {latest.resolution && <p className={styles.note}>Mesa escolheu {latest.resolution === "overreach" ? "Overreach (Perigo +1)" : "Despair"}.</p>}
      {latest.choices.length > 0 && <div className={styles.checks}>{latest.choices.map((choice) =>
        <button key={choice} className={styles.rollButton} type="button" disabled={busy} onClick={() => resolve(choice)}>{CHOICE_LABEL[choice]}</button>)}</div>}
      {latest.can_reroll && <>
        <p className={styles.note}>Rerrolagem de Vontade: até 3 dados comuns, uma vez por teste, gasta 1 de Vontade.</p>
        <div className={styles.checks}>{latest.normal_dice.map((face, index) => <label key={index}><input type="checkbox" checked={selected.includes(index)} onChange={() => toggleDie(index)} /> {face}</label>)}</div>
        <button className={styles.ghostButton} type="button" disabled={busy || !selected.length} onClick={reroll}>Rerrolar {selected.length} dado(s) com Vontade</button>
      </>}
    </>}
    <ul className={styles.stateList}>
      <li data-on={despair}>Em Desespero (Despair){despair ? ": sem dados de Desesperação e Triunfos bloqueados" : ""}</li>
      <li data-on={Boolean(edges.length) && !despair}>Triunfos: {edges.join(", ") || "nenhum"}</li>
      <li data-on={Boolean(perks.length) && !despair}>Distinções: {perks.join(", ") || "nenhuma"}</li>
    </ul>
    <p className={styles.poolLine}>Ímpeto <b>{String(values.impulso ?? "—")}</b> · Redenção: {String(values.redencao || "não registrada")}</p>
    {despair && !state?.pending_redemption && <>
      <label>Como o Ímpeto foi cumprido<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={requestRedemption}>Registrar Redenção</button>
    </>}
    {state?.pending_redemption && <>
      <p className={styles.note}>Redenção pendente ({state.pending_redemption.drive}): {state.pending_redemption.note || "sem nota"}.</p>
      {canManage && <div className={styles.checks}>
        <button className={styles.rollButton} type="button" disabled={busy} onClick={() => decide(true)}>Aprovar e encerrar o Desespero</button>
        <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => decide(false)}>Recusar</button>
      </div>}
    </>}
    {message && <p className={styles.message} role="status">{message}</p>}
  </article>;
}
