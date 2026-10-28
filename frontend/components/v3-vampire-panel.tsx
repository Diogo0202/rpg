"use client";

import { useEffect, useRef, useState } from "react";

import { buildChronicleContext, newRollKey, withChronicle } from "../lib/chronicle-context";
import type { FieldValue } from "../lib/sheet-template";
import { v3Derived, v3Traits } from "../lib/v3-rules";
import { authenticatedPost, authenticatedPostWithChronicle } from "./character-effects-panel";
import styles from "./system-roll-panel.module.css";

type Character = { id: string; name: string; values: Record<string, unknown> };
type RollResult = {
  dice: number[]; difficulty: number; successes: number; botch: boolean; success: boolean; verdict: string;
  penalty: number; rolled: number; willpower_spent: boolean; specialty: boolean;
};
type ActionResult = { sheet?: { values?: Record<string, unknown> }; test?: { outcome?: string; roll?: { dice?: number[]; successes?: number } }; replayed?: boolean; applied?: number };
type Entry = { title: string; at: string; text: string };
type Action = "sangue" | "cura" | "dano" | "sangue_inicial" | "frenesi" | "rotschreck" | "degeneracao";
const NONE = "__none__";

function describeRoll(result: RollResult): string {
  return `${result.verdict} · ${result.successes} sucesso(s) · dificuldade ${result.difficulty} · dados ${result.dice.join(" · ") || "nenhum"}`
    + `${result.penalty ? ` · Vitalidade ${result.penalty}` : ""}${result.specialty ? " · especialização" : ""}${result.willpower_spent ? " · +1 Vontade" : ""}`;
}

/**
 * Vampiro V3 (Revisado): d10 pool against difficulty 2-10 rolled by the API, health penalty from the
 * sheet, Willpower spent atomically, and blood, damage, healing, frenzy, Rötschreck and degeneration
 * through the v3_* RPCs. Rules are marked for checking in the book.
 */
export function V3VampirePanel({ character, campaignId, onSheet }: { character: Character; campaignId?: string; onSheet?: (values: Record<string, unknown>) => void }) {
  const values = character.values as Record<string, FieldValue>;
  const derived = v3Derived(values);
  const traits = v3Traits(values);
  const [attributeId, setAttributeId] = useState("");
  const [abilityId, setAbilityId] = useState(NONE);
  const [difficulty, setDifficulty] = useState(6);
  const [specialty, setSpecialty] = useState(false);
  const [willpower, setWillpower] = useState(false);
  const [amount, setAmount] = useState(1);
  const [damageKind, setDamageKind] = useState<"contundente" | "letal" | "agravado">("letal");
  const [turn, setTurn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    setAttributeId(""); setAbilityId(NONE); setHistory([]); setMessage(""); setWillpower(false); setSpecialty(false);
  }, [character.id]);

  const attribute = traits.attributes.find((trait) => trait.id === attributeId) ?? traits.attributes[0];
  const ability = traits.abilities.find((trait) => trait.id === abilityId);
  const pool = (attribute?.value ?? 0) + (ability?.value ?? 0);
  const willpowerLeft = derived.willpower - derived.willpowerSpent;

  function push(title: string, text: string) {
    setHistory((current) => [{ title, at: new Date().toLocaleTimeString(), text }, ...current].slice(0, 8));
  }

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setMessage("");
    try { await task(current.signal); } catch (error) {
      if (!current.signal.aborted) setMessage(error instanceof Error ? error.message : "Falha na ação.");
    } finally { if (controller.current === current) setBusy(false); }
  }

  const roll = () => run(async (signal) => {
    if (pool < 1 || pool > 30) throw new Error("A parada precisa ficar entre 1 e 30 dados.");
    if (derived.penalty === null) throw new Error("Incapacitado não pode agir.");
    if (willpower && willpowerLeft < 1) throw new Error("Sem Força de Vontade disponível.");
    const title = `${attribute?.label ?? ""}${ability ? ` + ${ability.label}` : ""}`;
    const chronicle = buildChronicleContext({ sheetId: character.id, campaignId, traitIds: [attribute?.id, ability?.id], rollKey: newRollKey("v3") });
    const payload = withChronicle({
      pool, difficulty, specialty, use_willpower: willpower, damage_levels: derived.marked,
      ...(willpower ? { sheet_id: character.id, operation_id: crypto.randomUUID() } : {}),
    }, chronicle);
    const { data } = await authenticatedPostWithChronicle("/api/v1/system-rolls/vampire-v3", payload, signal);
    push(title, describeRoll(data as RollResult));
    setWillpower(false);
  });

  const act = (action: Action, title: string, extra: Record<string, unknown> = {}) => run(async (signal) => {
    const result = await authenticatedPost(`/api/v1/system-rolls/vampire-v3/sheets/${character.id}/actions`,
      { operation_id: crypto.randomUUID(), action, ...extra }, signal) as ActionResult;
    const test = result.test;
    const sheet = result.sheet?.values ?? {};
    const parts = [
      test?.outcome, test?.roll?.dice?.length ? `dados ${test.roll.dice.join(" · ")}` : null,
      typeof result.applied === "number" ? `${result.applied} nível(is) marcado(s)` : null,
      "pontos_sangue" in sheet ? `sangue ${String(sheet.pontos_sangue)}` : null,
    ].filter(Boolean);
    push(title, parts.join(" · ") || "Aplicado.");
    if (result.sheet?.values) onSheet?.(result.sheet.values);
  });

  const turnKey = turn.trim() || undefined;
  return <article className={styles.card}>
    <h3>Vampiro V3 · {character.name}</h3>
    <p className={styles.poolLine}>
      Geração <b>{derived.generation}ª</b> · Sangue <b>{derived.blood}/{derived.bloodMax}</b> (até {derived.perTurn} por turno) ·
      Vontade <b>{willpowerLeft}/{derived.willpower}</b> · Vitalidade <b>{derived.level}</b>{derived.penalty ? ` (${derived.penalty})` : ""} · {derived.path}
    </p>
    <div className={styles.selectGrid}>
      <label>Atributo ou virtude<select value={attribute?.id ?? ""} onChange={(event) => setAttributeId(event.target.value)}>{traits.attributes.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}</select></label>
      <label>Habilidade ou disciplina<select value={ability?.id ?? NONE} onChange={(event) => setAbilityId(event.target.value)}><option value={NONE}>Nenhuma</option>{traits.abilities.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}</select></label>
      <label>Dificuldade<input type="number" min={2} max={10} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></label>
    </div>
    <div className={styles.checks}>
      <label><input type="checkbox" checked={specialty} onChange={(event) => setSpecialty(event.target.checked)} /> Especialização (10 vale dois)</label>
      <label><input type="checkbox" checked={willpower} disabled={willpowerLeft < 1} onChange={(event) => setWillpower(event.target.checked)} /> Gastar 1 Vontade (+1 sucesso)</label>
    </div>
    <p className={styles.poolLine}>Parada: <b>{Math.max(0, pool + (derived.penalty ?? 0))} dados</b>{derived.penalty ? ` (${pool} ${derived.penalty})` : ""}. Cada 1 anula um sucesso; sem sucessos e com um 1 é falha crítica.</p>
    {message && <p className={styles.message} role="status">{message}</p>}
    <button className={styles.rollButton} type="button" disabled={busy || !attribute || derived.penalty === null} onClick={() => void roll()}>{busy ? "Rolando…" : "Rolar"}</button>

    <h3>Sangue, dano e testes</h3>
    <div className={styles.selectGrid}>
      <label>Quantidade<input type="number" min={1} max={20} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
      <label>Tipo de dano<select value={damageKind} onChange={(event) => setDamageKind(event.target.value as typeof damageKind)}><option value="contundente">Contundente (vampiro: metade)</option><option value="letal">Letal</option><option value="agravado">Agravado</option></select></label>
      <label>Turno (opcional)<input value={turn} maxLength={80} placeholder="combate:rodada" onChange={(event) => setTurn(event.target.value)} /></label>
    </div>
    <div className={styles.checks}>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => void act("sangue", "Gasto de sangue", { amount, turn: turnKey })}>Gastar sangue</button>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => void act("cura", "Cura com sangue", { amount, turn: turnKey })}>Curar (1 sangue por nível)</button>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => void act("dano", "Dano", { amount, kind: damageKind })}>Marcar dano</button>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => void act("sangue_inicial", "Sangue inicial")}>Rolar sangue inicial (1d10)</button>
    </div>
    <div className={styles.checks}>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => void act("frenesi", "Teste de Frenesi", { difficulty })}>Frenesi ({derived.selfControl === "instintos" ? "Instintos" : "Autocontrole"})</button>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => void act("rotschreck", "Rötschreck", { difficulty })}>Rötschreck (Coragem)</button>
      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => void act("degeneracao", "Degeneração", { difficulty })}>Degeneração ({derived.conscience === "conviccao" ? "Convicção" : "Consciência"})</button>
    </div>
    <p className={styles.note}>Os testes usam a dificuldade acima e são rolados pelo banco. O limite por turno vale para gastos com a mesma chave de turno. Regras marcadas para conferência no livro.</p>
    {history.length ? <ol className={styles.history}>{history.map((entry, index) => <li key={`${entry.at}-${index}`}><div><b>{entry.title}</b><time>{entry.at}</time></div><p>{entry.text}</p></li>)}</ol> : <p>Nenhuma ação nesta sessão.</p>}
  </article>;
}
