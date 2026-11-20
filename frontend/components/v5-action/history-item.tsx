"use client";

import { chronicleActivityLabel } from "../../lib/chronicle-context";
import { attackDamageSplit, canApplyAttackDamage, damagePenaltiesFrom, toggleRerollIndex } from "../../lib/v5-action-roll";
import styles from "../v5-action-panel.module.css";
import { DAMAGE_LABELS, outcomeLabel, TRACK_NAMES, type HistoryEntry, type Track } from "./model";
import type { V5Action } from "./use-v5-action";

function AttackTargetForm({ action, entry }: { action: V5Action; entry: HistoryEntry }) {
  const { targets, targetId, setTargetId, targetArmor, setTargetArmor, targetTrack, setTargetTrack, targetPhysical, setTargetPhysical } = action.target;
  const split = attackDamageSplit(entry.attack);
  if (!split) return null;
  const alreadyApplied = targetId !== "" && entry.applied.includes(targetId);
  return <form className={styles.targetForm} onSubmit={(event) => { event.preventDefault(); void action.applyAttackToTarget(entry); }}>
    <label>Alvo do ataque<select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
      <option value="">Escolha a ficha</option>
      {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
    </select></label>
    <button type="submit" disabled={action.busy || !canApplyAttackDamage({ canNarrate: true, attack: entry.attack, targetId }) || alreadyApplied}>
      {alreadyApplied ? "Dano aplicado" : `Aplicar ${split.superficial + split.aggravated} na ${targetTrack === "health" ? "Saúde" : "Vontade"}`}
    </button>
    <label>Trilha do alvo<select value={targetTrack} onChange={(event) => setTargetTrack(event.target.value as Track)}>
      <option value="health">{TRACK_NAMES.health}</option><option value="willpower">{TRACK_NAMES.willpower}</option>
    </select></label>
    <label className={styles.inlineLabel}><input type="checkbox" checked={targetArmor} disabled={targetTrack !== "health"} onChange={(event) => setTargetArmor(event.target.checked)} /> Armadura do alvo absorve dano superficial</label>
    <label className={styles.inlineLabel}><input type="checkbox" checked={targetPhysical} disabled={targetTrack !== "health"} onChange={(event) => setTargetPhysical(event.target.checked)} /> Dano físico: alvo vampiro reduz o superficial à metade</label>
  </form>;
}

/** Uma rolagem do histórico: dados, rerrolagem com Vontade, dano do ataque e efeitos aplicados. */
export function HistoryItem({ action, entry, latest, canNarrate }: { action: V5Action; entry: HistoryEntry; latest: boolean; canNarrate: boolean }) {
  const { busy } = action;
  const { rerollPick, setRerollPick, sessionRollIds } = action.history;
  const roll = entry.roll;
  const canReroll = latest && roll.rerolled_at === null && sessionRollIds.has(roll.id);
  const picked = rerollPick?.rollId === roll.id ? rerollPick.indices : [];
  const chronicleLabel = chronicleActivityLabel(entry.chronicle);

  return <li>
    <div><b>{entry.actionName}{chronicleLabel && <span className={styles.chronicle} title="Esta rolagem virou atividade da crônica.">{chronicleLabel}</span>}</b><time>{entry.recordedAt}</time></div>
    <div className={styles.dice} aria-label="Dados da rolagem">
      {roll.normal_dice.map((face, dieIndex) => <button type="button" key={`n${dieIndex}`} className={styles.die}
        disabled={!canReroll || busy} aria-pressed={canReroll ? picked.includes(dieIndex) : undefined}
        aria-label={`Dado comum ${face}${picked.includes(dieIndex) ? ", marcado para rerrolar" : ""}`}
        onClick={() => setRerollPick({ rollId: roll.id, indices: toggleRerollIndex(picked, dieIndex) })}>{face}</button>)}
      {roll.hunger_dice.map((face, dieIndex) => <button type="button" key={`h${dieIndex}`} className={`${styles.die} ${styles.hungerDie}`} disabled aria-label={`Dado de Fome ${face}`}>{face}</button>)}
    </div>
    <p>{roll.outcome.successes} sucessos / dif. {roll.difficulty} · <strong>{outcomeLabel(roll)}</strong>{roll.rerolled_at ? " · com Vontade" : ""}</p>
    {roll.original_normal_dice && <p>Antes da Vontade: {roll.original_normal_dice.join(" · ")}.</p>}
    {canReroll && <div className={styles.rerollRow}>
      <button type="button" disabled={busy || !roll.recommended_reroll.length} onClick={() => setRerollPick({ rollId: roll.id, indices: roll.recommended_reroll })}>
        {roll.recommended_reroll.length ? `Sugestão: dados ${roll.recommended_reroll.map((item) => item + 1).join(", ")}` : "Rerrolar não melhora"}
      </button>
      <button type="button" disabled={busy || !picked.length} onClick={() => void action.rerollWithWillpower(entry)}>Rerrolar {picked.length || ""} com Vontade</button>
    </div>}
    {entry.preview && <p>Modificadores: {entry.preview.total_delta >= 0 ? "+" : ""}{entry.preview.total_delta}, pool final {entry.preview.adjusted_pool}.</p>}
    {entry.attack && <p className={styles.penalty}>Dano causado: <b>{entry.attack.damage} {DAMAGE_LABELS[entry.attack.damage_type]}</b> ({entry.attack.sources.map((source) => `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`).join(" · ")}){entry.attack.weapon ? "" : " · desarmado"}</p>}
    {!entry.attack && entry.roll.outcome.success && <div className={styles.rerollRow}>
      <button type="button" disabled={busy} onClick={() => void action.calculateStoredAttack(entry)}>Calcular dano do ataque</button>
    </div>}
    {entry.attackError && <p className={styles.penalty}>{entry.attackError}</p>}
    {canNarrate && <AttackTargetForm action={action} entry={entry} />}
    {damagePenaltiesFrom(entry.preview).map((penalty) => <p className={styles.penalty} key={penalty}>−2 por trilha de {TRACK_NAMES[penalty]} cheia.</p>)}
    {entry.preview?.applied.map((effect) => <small key={effect.id}>{effect.label}: {effect.delta >= 0 ? "+" : ""}{effect.delta} dados. </small>)}
    {entry.preview && entry.preview.skipped.length > 0 && <small>Efeitos ignorados: {entry.preview.skipped.map((effect) => `${effect.id} (${effect.reason})`).join(", ")}</small>}
  </li>;
}
