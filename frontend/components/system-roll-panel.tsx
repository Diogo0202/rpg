"use client";

import { useEffect, useRef, useState } from "react";

import { useCharacterSession } from "../lib/character-session";
import { authenticatedPost } from "./character-effects-panel";
import styles from "./system-roll-panel.module.css";

type Trait = { id: string; label: string };
type HunterResult = {
  normal_dice: number[]; desperation_dice: number[]; desperation_ones: number;
  successes: number; difficulty: number; success: boolean; critical_pairs: number;
  critical: boolean; desperation_consequence: "despair" | "table_choice" | null; verdict: string;
};
type OneRingResult = {
  feat_dice: number[]; feat_die: number; success_dice: number[]; counted_success_dice: number[];
  total: number; weary: boolean; automatic_success: boolean; eye_of_sauron: boolean;
  success_icons: number; success: boolean;
};
type HistoryEntry = { title: string; at: string; result: HunterResult | OneRingResult };
type Pending = { id: number; controller: AbortController; characterId: string };
const NO_SKILL = "__none__";

const HUNTER_ATTRIBUTES: Trait[] = [
  { id: "forca", label: "Força" }, { id: "destreza", label: "Destreza" }, { id: "vigor", label: "Vigor" },
  { id: "carisma", label: "Carisma" }, { id: "manipulacao", label: "Manipulação" }, { id: "autocontrole", label: "Autocontrole" },
  { id: "inteligencia", label: "Inteligência" }, { id: "raciocinio", label: "Raciocínio" }, { id: "resolucao", label: "Determinação" },
];
const HUNTER_SKILLS: Trait[] = [
  { id: "atletismo", label: "Atletismo" }, { id: "briga", label: "Briga" }, { id: "furtividade", label: "Furtividade" },
  { id: "persuasao", label: "Persuasão" }, { id: "subterfugio", label: "Subterfúgio" }, { id: "empatia", label: "Empatia" },
  { id: "investigacao", label: "Investigação" }, { id: "ocultismo", label: "Ocultismo" }, { id: "tecnologia", label: "Tecnologia" },
];
const RING_ATTRIBUTES: Trait[] = [
  { id: "forca", label: "Força" }, { id: "coracao", label: "Coração" }, { id: "espirito", label: "Espírito" },
];
const RING_SKILLS: Trait[] = [
  { id: "awe", label: "Presença" }, { id: "athletics", label: "Atletismo" }, { id: "awareness", label: "Percepção" },
  { id: "hunting", label: "Caçada" }, { id: "song", label: "Canção" }, { id: "travel", label: "Viagem" },
];

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function choices(definitions: Trait[], values: Record<string, unknown>) {
  return definitions.flatMap((trait) => {
    const value = integer(values[trait.id]);
    return value === null ? [] : [{ ...trait, value }];
  });
}

export function SystemRollPanel() {
  const { character } = useCharacterSession();
  const selectedRef = useRef(character);
  selectedRef.current = character;
  const operationId = useRef(0);
  const pending = useRef<Pending | null>(null);
  const history = useRef(new Map<string, HistoryEntry[]>());
  const [historyRevision, setHistoryRevision] = useState(0);
  const [attributeId, setAttributeId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [target, setTarget] = useState(14);
  const [difficulty, setDifficulty] = useState(3);
  const [favored, setFavored] = useState(false);
  const [illFavored, setIllFavored] = useState(false);
  const [useDesperation, setUseDesperation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    operationId.current += 1;
    pending.current?.controller.abort();
    pending.current = null;
    setBusy(false);
    setMessage("");
    setAttributeId("");
    setSkillId("");
    setTarget(14);
    setDifficulty(3);
    setFavored(false);
    setIllFavored(false);
    setUseDesperation(false);
  }, [character?.id]);

  const values = character?.values ?? {};
  const isHunter = "desespero" in values || "desperation" in values;
  const isOneRing = "vigor_marcha" in values || "carga" in values;
  const system = isHunter ? "hunter" : isOneRing ? "one-ring" : null;
  const attributeChoices = choices(system === "hunter" ? HUNTER_ATTRIBUTES : RING_ATTRIBUTES, values);
  const skillChoices = choices(system === "hunter" ? HUNTER_SKILLS : RING_SKILLS, values);
  const selectedAttribute = attributeChoices.find((item) => item.id === attributeId) ?? attributeChoices[0];
  const selectedSkill = skillId === NO_SKILL ? undefined : skillChoices.find((item) => item.id === skillId) ?? (skillId ? undefined : skillChoices[0]);
  const currentHistory = character ? history.current.get(character.id) ?? [] : [];
  void historyRevision;

  async function roll() {
    const selected = character;
    if (!selected || !system || !selectedAttribute) return;
    const operation: Pending = { id: ++operationId.current, controller: new AbortController(), characterId: selected.id };
    pending.current?.controller.abort();
    pending.current = operation;
    setBusy(true);
    setMessage("");
    try {
      let result: HunterResult | OneRingResult;
      let title: string;
      if (system === "hunter") {
        const desperation = integer(selected.values.desespero ?? selected.values.desperation);
        if (desperation === null || desperation < 0 || desperation > 5) throw new Error("A ficha precisa ter Desespero entre 0 e 5.");
        const basePool = selectedAttribute.value + (selectedSkill?.value ?? 0);
        if (basePool < 1 || basePool > 30) throw new Error("A parada precisa ficar entre 1 e 30 dados.");
        if (!Number.isSafeInteger(difficulty) || difficulty < 1 || difficulty > 69) throw new Error("Informe uma dificuldade de 1 a 69.");
        title = `${selectedAttribute.label}${selectedSkill ? ` + ${selectedSkill.label}` : ""}`;
        result = await authenticatedPost("/api/v1/system-rolls/hunter", {
          base_pool: basePool, difficulty, desperation, use_desperation: useDesperation,
        }, operation.controller.signal) as HunterResult;
      } else {
        const endurance = integer(selected.values.vigor_marcha);
        const load = integer(selected.values.carga);
        if (endurance === null || load === null || endurance < 0 || load < 0) throw new Error("A ficha precisa ter Vigor (Endurance) e Carga numéricos.");
        const targetValue = Number.isSafeInteger(target) && target >= 1 && target <= 99 ? target : null;
        if (targetValue === null) throw new Error("Informe uma dificuldade de 1 a 99.");
        title = `${selectedAttribute.label}${selectedSkill ? ` + ${selectedSkill.label}` : ""}`;
        result = await authenticatedPost("/api/v1/system-rolls/one-ring", {
          target: targetValue, skill_dice: selectedSkill?.value ?? 0, endurance, load, favored, ill_favored: illFavored,
        }, operation.controller.signal) as OneRingResult;
      }
      if (operation.id !== operationId.current || selectedRef.current?.id !== operation.characterId) return;
      history.current.set(selected.id, [{ title, at: new Date().toLocaleTimeString(), result }, ...(history.current.get(selected.id) ?? [])].slice(0, 8));
      setHistoryRevision((revision) => revision + 1);
    } catch (error) {
      if (operation.id === operationId.current && selectedRef.current?.id === operation.characterId && !operation.controller.signal.aborted) {
        setMessage(error instanceof Error ? error.message : "Falha ao rolar.");
      }
    } finally {
      if (operation.id === operationId.current) { pending.current = null; setBusy(false); }
    }
  }

  if (!character) return <section className={`content ${styles.panel}`}><h2>Roladores de Caçador e O Um Anel</h2><p>Selecione uma ficha da sessão.</p></section>;
  if (!system) return <section className={`content ${styles.panel}`}><h2>Roladores de Caçador e O Um Anel</h2><p>A ficha selecionada não tem campos reconhecidos desses sistemas.</p></section>;

  return <section className={`content ${styles.panel}`}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{system === "hunter" ? "CAÇADOR · 5ª EDIÇÃO" : "O UM ANEL · 2ª EDIÇÃO"}</p><h2>{character.name}</h2></div><p>Rolagens vinculadas à ficha ativa. Os recursos da ficha não mudam.</p></header>
    <div className={styles.layout}>
      <article className={styles.card}>
        <h3>Montar a rolagem</h3>
        <div className={styles.selectGrid}>
          <label>Atributo<select value={selectedAttribute?.id ?? ""} onChange={(event) => setAttributeId(event.target.value)}>{attributeChoices.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}</select></label>
          <label>{system === "hunter" ? "Habilidade" : "Perícia"}<select value={selectedSkill?.id ?? NO_SKILL} onChange={(event) => setSkillId(event.target.value)}><option value={NO_SKILL}>Sem perícia</option>{skillChoices.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}</select></label>
        </div>
        {system === "hunter" ? <>
          <label className={styles.target}>Dificuldade<input type="number" min={1} max={69} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></label>
          <p className={styles.poolLine}>Reserva base: <b>{Math.max(0, (selectedAttribute?.value ?? 0) + (selectedSkill?.value ?? 0))} dados</b>. Desespero da célula: <b>{String(values.desespero ?? values.desperation ?? "?")}</b>.</p>
          <div className={styles.checks}><label><input type="checkbox" checked={useDesperation} onChange={(event) => setUseDesperation(event.target.checked)} /> Somar dados de Desespero</label></div>
          <p className={styles.note}>Esses dados são adicionais e opcionais, quando a ação corresponde ao Credo. Cada 1 de Desespero pede resolução pela mesa; eles não são dados de Fome.</p>
        </> : <>
          <label className={styles.target}>Dificuldade<input type="number" min={1} max={99} value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label>
          <div className={styles.checks}><label><input type="checkbox" checked={favored} onChange={(event) => { setFavored(event.target.checked); if (event.target.checked) setIllFavored(false); }} /> Favorecido</label><label><input type="checkbox" checked={illFavored} onChange={(event) => { setIllFavored(event.target.checked); if (event.target.checked) setFavored(false); }} /> Desfavorecido</label></div>
          <p className={styles.note}>Alvo e atributo de referência são separados. Informe o TN usado pela mesa; o atributo só identifica o contexto da rolagem. Cansado segue o recorte Atlas: Vigor (Endurance) ≤ Carga anula resultados 1 a 3 dos dados de perícia.</p>
          <p className={styles.note}>Este recorte está em revisão. Miserável, Sombra e os eventos de jornada ainda dependem da decisão da mesa.</p>
        </>}
        {message && <p className={styles.message} role="status">{message}</p>}
        <button className={styles.rollButton} type="button" disabled={busy || !selectedAttribute} onClick={() => void roll()}>{busy ? "Rolando…" : "Rolar"}</button>
      </article>
      <article className={styles.card}>
        <h3>Histórico desta ficha</h3>
        {currentHistory.length ? <ol className={styles.history}>{currentHistory.map((entry, index) => <li key={`${entry.at}-${index}`}><div><b>{entry.title}</b><time>{entry.at}</time></div>{"normal_dice" in entry.result ? <p>{entry.result.verdict} · {entry.result.successes}/{entry.result.difficulty} sucessos · base {entry.result.normal_dice.join(" · ")} · Desespero {entry.result.desperation_dice.join(" · ") || "não usado"}{entry.result.desperation_ones ? ` · ${entry.result.desperation_ones} resultado(s) 1, ${entry.result.desperation_consequence === "despair" ? "Despair" : "escolha Despair ou Overreach pela mesa"}` : ""}{entry.result.critical ? " · crítico" : ""}</p> : <p>{entry.result.success ? "Sucesso" : "Falha"}{entry.result.automatic_success ? " · Runa de Gandalf" : entry.result.eye_of_sauron ? " · Olho de Sauron" : ""} · total {entry.result.total} · Feito {entry.result.feat_dice.join(" / ")} · perícia {entry.result.success_dice.join(" · ") || "nenhum dado"}{entry.result.weary ? " · Cansado" : ""}{entry.result.success_icons ? ` · ${entry.result.success_icons} ícone(s)` : ""}</p>}</li>)}</ol> : <p>Nenhuma rolagem nesta sessão.</p>}
      </article>
    </div>
  </section>;
}
