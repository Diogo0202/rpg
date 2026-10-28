"use client";

import { useEffect, useRef, useState } from "react";

import { useCharacterSession } from "../lib/character-session";
import { HUNTER_SKILLS as HUNTER_SKILL_LIST } from "../lib/hunter-creation-data";
import { hunterTraitProblems, inDespair, isLegacyHunterSheet, migrateHunterTraits, usableEdges } from "../lib/hunter-traits";
import { ONE_RING_SKILLS, oneRingDerived, oneRingProblems, oneRingStates } from "../lib/one-ring-rules";
import type { FieldValue } from "../lib/sheet-template";
import { buildChronicleContext, chronicleActivityLabel, newRollKey, withChronicle, type ChronicleActivityStatus } from "../lib/chronicle-context";
import { sotdlDice, sotdlFateDice } from "@dice3d/sotdl";
import { authenticatedPost, authenticatedPostWithChronicle } from "./character-effects-panel";
import { DiceTrayOverlay, type TrayRoll } from "./dice-tray";
import { hunterDice } from "@dice3d/hunter";
import { HunterCellsPanel } from "./hunter-cells-panel";
import { HunterConsequencesCard, useHunterState, type HunterRoll } from "./hunter-roll-card";
import styles from "./system-roll-panel.module.css";
import { isV3Sheet } from "../lib/v3-rules";
import { V3VampirePanel } from "./v3-vampire-panel";

type Trait = { id: string; label: string };
type HunterResult = {
  normal_dice: number[]; desperation_dice: number[]; desperation_ones: number;
  successes: number; difficulty: number; success: boolean; critical_pairs: number;
  critical: boolean; desperation_consequence: "despair" | "table_choice" | null; verdict: string;
};
type OneRingResult = {
  feat_dice: number[]; feat_die: number; success_dice: number[]; counted_success_dice: number[];
  total: number; weary: boolean; miserable?: boolean; wounded?: boolean; automatic_success: boolean;
  automatic_failure?: boolean; eye_of_sauron: boolean; success_icons: number; success: boolean; notes?: string[];
};
type ShadowResult = { source: string; trait: string; roll: OneRingResult; shadow_gained: number; shadow_after: number; miserable_after: boolean };
type JourneyResult = {
  region: string; feat_dice: number[]; feat_die: number; role_die: number; event: string; label: string;
  fatigue: number; role_label: string; skill: string; on_success: string; on_failure: string;
};
type SotdlResult = {
  modifier: number; d20: number; net_boons: number; boon_dice: number[]; boon_value: number;
  total: number; target: number; success: boolean; critical: boolean; verdict: string;
};
type SotdlFate = { die: number; outcome: "dying" | "stable" | "recovers"; verdict: string };
type RollResult = HunterResult | HunterRoll | OneRingResult | ShadowResult | JourneyResult | SotdlResult | SotdlFate;
type HistoryEntry = { title: string; at: string; result: RollResult; chronicle?: ChronicleActivityStatus | null };
type Pending = { id: number; controller: AbortController; characterId: string };
type RollKind = "main" | "fate" | "shadow" | "journey";
const NO_SKILL = "__none__";

const HUNTER_ATTRIBUTES: Trait[] = [
  { id: "forca", label: "Força" }, { id: "destreza", label: "Destreza" }, { id: "vigor", label: "Vigor" },
  { id: "carisma", label: "Carisma" }, { id: "manipulacao", label: "Manipulação" }, { id: "autocontrole", label: "Autocontrole" },
  { id: "inteligencia", label: "Inteligência" }, { id: "raciocinio", label: "Raciocínio" }, { id: "resolucao", label: "Determinação" },
];
const HUNTER_SKILLS: Trait[] = HUNTER_SKILL_LIST.map(([id, label]) => ({ id, label }));
// v2 ids first; v1 sheets still carry Força and Espírito.
const RING_ATTRIBUTES: Trait[] = [
  { id: "corpo", label: "Corpo" }, { id: "coracao", label: "Coração" }, { id: "astucia", label: "Astúcia" },
  { id: "forca", label: "Força (v1)" }, { id: "espirito", label: "Espírito (v1)" },
];
const RING_SKILLS: Trait[] = ONE_RING_SKILLS.map(([id, label]) => ({ id, label }));
const SOTDL_ATTRIBUTES: Trait[] = [
  { id: "forca", label: "Força" }, { id: "agilidade", label: "Agilidade" }, { id: "intelecto", label: "Intelecto" },
  { id: "vontade", label: "Vontade" }, { id: "percepcao", label: "Percepção" },
];
const SOTDL_LABEL = "Shadow of the Demon Lord";
const SHADOW_SOURCES = [["pavor", "Pavor (Valor)"], ["ganancia", "Ganância (Sabedoria)"], ["feiticaria", "Feitiçaria (Sabedoria)"]] as const;
const REGIONS = [["fronteira", "Terra de fronteira (favorecido)"], ["selvagem", "Terra selvagem"], ["sombria", "Terra sombria (desfavorecido)"]] as const;

function signed(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}

function describeRing(result: OneRingResult): string {
  const mark = result.automatic_success ? " · Runa de Gandalf" : result.automatic_failure ? " · Olho de Sauron, falha automática" : result.eye_of_sauron ? " · Olho de Sauron" : "";
  return `${result.success ? "Sucesso" : "Falha"}${mark} · total ${result.total} · Feito ${result.feat_dice.join(" / ")} · perícia ${result.success_dice.join(" · ") || "nenhum dado"}${result.weary ? " · Cansado" : ""}${result.miserable ? " · Miserável" : ""}${result.wounded ? " · Ferido" : ""}${result.success_icons ? ` · ${result.success_icons} ícone(s)` : ""}`;
}

function describe(result: RollResult): string {
  if ("normal_dice" in result) {
    const resolved = "resolution" in result && result.resolution ? ` · mesa: ${result.resolution === "overreach" ? "Overreach (Perigo +1)" : "Despair"}` : "";
    return `${result.verdict} · ${result.successes}/${result.difficulty} sucessos · base ${result.normal_dice.join(" · ")} · Desesperação ${result.desperation_dice.join(" · ") || "não usada"}${result.desperation_ones && !resolved ? ` · ${result.desperation_ones} resultado(s) 1, ${result.desperation_consequence === "despair" ? "Despair" : "escolha Despair ou Overreach pela mesa"}` : ""}${result.critical ? " · crítico" : ""}${resolved}`;
  }
  if ("shadow_gained" in result) return `${describeRing(result.roll)} · Sombra +${result.shadow_gained} (fica ${result.shadow_after})${result.miserable_after ? " · Miserável" : ""}`;
  if ("role_die" in result) return `${result.label} · Feito ${result.feat_dice.join(" / ")} · Cansaço +${result.fatigue} · teste de ${result.role_label} (d6 ${result.role_die}) · sucesso: ${result.on_success} · falha: ${result.on_failure}`;
  if ("feat_dice" in result) return describeRing(result);
  if ("outcome" in result) return `Destino: ${result.verdict} · d6 ${result.die}`;
  const boons = result.net_boons === 0 ? "sem dádivas" : `${Math.abs(result.net_boons)} ${result.net_boons > 0 ? "dádiva(s)" : "perdição(ões)"} [${result.boon_dice.join(" · ")}] ${signed(result.boon_value)}`;
  return `${result.verdict} · total ${result.total} contra ${result.target} · d20 ${result.d20} ${signed(result.modifier)} · ${boons}`;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function choices(definitions: Trait[], values: Record<string, unknown>) {
  return definitions.flatMap((trait) => {
    const value = integer(values[trait.id]);
    return value === null ? [] : [{ ...trait, value }];
  });
}

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

export function SystemRollPanel({ campaignId, canManage = false }: { campaignId?: string; canManage?: boolean } = {}) {
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
  const [miserableFlag, setMiserableFlag] = useState(false);
  const [useDesperation, setUseDesperation] = useState(false);
  const [hunterEdge, setHunterEdge] = useState("");
  const [hunterRevision, setHunterRevision] = useState(0);
  const [boons, setBoons] = useState(0);
  const [banes, setBanes] = useState(0);
  const [shadowSource, setShadowSource] = useState<(typeof SHADOW_SOURCES)[number][0]>("pavor");
  const [shadowPoints, setShadowPoints] = useState(1);
  const [shadowTarget, setShadowTarget] = useState(14);
  const [region, setRegion] = useState<(typeof REGIONS)[number][0]>("selvagem");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tray, setTray] = useState<TrayRoll | null>(null);

  function addHistory(characterId: string, entry: HistoryEntry) {
    history.current.set(characterId, [entry, ...(history.current.get(characterId) ?? [])].slice(0, 8));
    setHistoryRevision((revision) => revision + 1);
  }

  function closeTray() {
    setTray(null);
  }

  useEffect(() => {
    operationId.current += 1;
    pending.current?.controller.abort();
    pending.current = null;
    setBusy(false);
    setTray(null);
    setMessage("");
    setAttributeId("");
    setSkillId("");
    setTarget(selectedRef.current?.values.sistema === SOTDL_LABEL ? 10 : 14);
    setDifficulty(3);
    setFavored(false);
    setIllFavored(false);
    setMiserableFlag(false);
    setUseDesperation(false);
    setHunterEdge("");
    setBoons(0);
    setBanes(0);
    setShadowPoints(1);
    setShadowTarget(14);
  }, [character?.id]);

  const values = (character?.values ?? {}) as Record<string, FieldValue>;
  const isSotdl = values.sistema === SOTDL_LABEL || ("agilidade" in values && "corrupcao" in values);
  // F4: v4 sheets have no `desespero` (Desperation lives in the cell); the Despair state marks them.
  const isHunter = values.sistema === "Caçador: A Revanche" || "em_desespero" in values || "desespero" in values || "desperation" in values;
  const isOneRing = "vigor_marcha" in values || "carga" in values;
  const system = isSotdl ? "shadow-demon-lord" : isHunter ? "hunter" : isOneRing ? "one-ring" : null;
  const attributeChoices = choices(system === "shadow-demon-lord" ? SOTDL_ATTRIBUTES : system === "hunter" ? HUNTER_ATTRIBUTES : RING_ATTRIBUTES, values);
  const skillChoices = system === "shadow-demon-lord" ? [] : choices(system === "hunter" ? HUNTER_SKILLS : RING_SKILLS, values);
  const selectedAttribute = attributeChoices.find((item) => item.id === attributeId) ?? attributeChoices[0];
  const selectedSkill = skillId === NO_SKILL ? undefined : skillChoices.find((item) => item.id === skillId) ?? (skillId ? undefined : skillChoices[0]);
  const currentHistory = character ? history.current.get(character.id) ?? [] : [];
  void historyRevision;
  const ring = system === "one-ring" ? { derived: oneRingDerived(values), states: oneRingStates(values), problems: "corpo" in values ? oneRingProblems(values) : [] } : null;
  const hunterLegacy = system === "hunter" && isLegacyHunterSheet(values);
  const hunterProblems = system === "hunter" ? hunterTraitProblems(hunterLegacy ? migrateHunterTraits(values).values : values) : [];
  const hunterWarnings = hunterLegacy ? migrateHunterTraits(values).warnings : [];
  const hunterState = useHunterState(system === "hunter" ? character?.id : null, hunterRevision);
  const hunterDespair = hunterState?.in_despair ?? inDespair(values);
  const hunterEdges = system === "hunter" ? usableEdges(values) : [];
  const hunterLatest = system === "hunter" ? currentHistory.map((entry) => entry.result).find((result): result is HunterRoll => "roll_id" in result) ?? null : null;

  function replaceHunterRoll(updated: HunterRoll) {
    if (!character) return;
    const entries = history.current.get(character.id) ?? [];
    history.current.set(character.id, entries.map((entry) => "roll_id" in entry.result && entry.result.roll_id === updated.roll_id ? { ...entry, result: updated } : entry));
    setHistoryRevision((revision) => revision + 1);
  }

  function ringContext(selected: NonNullable<typeof character>) {
    const sheet = selected.values as Record<string, FieldValue>;
    const endurance = integer(sheet.vigor_marcha);
    if (endurance === null || endurance < 0) throw new Error("A ficha precisa ter Vigor atual numérico.");
    const derived = oneRingDerived(sheet);
    return {
      endurance: clamp(endurance, 40),
      load: clamp(derived.carga_total, 80),
      hope: clamp(integer(sheet.esperanca) ?? 0, 40),
      shadow: clamp(derived.sombra_total, 40),
      wounded: sheet.ferido === true,
    };
  }

  async function roll(kind: RollKind = "main") {
    const selected = character;
    if (!selected || !system || (!selectedAttribute && kind === "main")) return;
    const operation: Pending = { id: ++operationId.current, controller: new AbortController(), characterId: selected.id };
    pending.current?.controller.abort();
    pending.current = operation;
    setBusy(true);
    setMessage("");
    // DRA-05: só as rolagens principais aceitam `chronicle`; trait_ids são os campos da ficha que compõem a parada.
    let chronicle: ChronicleActivityStatus | null = null;
    const chronicleFor = (prefix: string, traitIds: (string | undefined)[]) => buildChronicleContext({ sheetId: selected.id, campaignId, traitIds, rollKey: newRollKey(prefix) });
    const postWithChronicle = async (path: string, payload: Record<string, unknown>, prefix: string, traitIds: (string | undefined)[]) => {
      const response = await authenticatedPostWithChronicle(path, withChronicle(payload, chronicleFor(prefix, traitIds)), operation.controller.signal);
      chronicle = response.chronicle;
      return response.data;
    };
    try {
      let result: RollResult;
      let title: string;
      if (system === "shadow-demon-lord" && kind === "fate") {
        title = "Teste de destino";
        result = await authenticatedPost("/api/v1/system-rolls/shadow-demon-lord/fate", {}, operation.controller.signal) as SotdlFate;
      } else if (system === "one-ring" && kind === "journey") {
        title = "Evento de jornada";
        result = await authenticatedPost("/api/v1/system-rolls/one-ring/journey-event", { region }, operation.controller.signal) as JourneyResult;
      } else if (system === "one-ring" && kind === "shadow") {
        const context = ringContext(selected);
        const trait = shadowSource === "pavor" ? "valor" : "sabedoria";
        const rating = integer(selected.values[trait]) ?? 0;
        if (!Number.isSafeInteger(shadowPoints) || shadowPoints < 1 || shadowPoints > 10) throw new Error("Informe de 1 a 10 pontos de Sombra.");
        if (!Number.isSafeInteger(shadowTarget) || shadowTarget < 1 || shadowTarget > 99) throw new Error("Informe um TN de 1 a 99.");
        title = `Teste de Sombra · ${SHADOW_SOURCES.find(([id]) => id === shadowSource)?.[1]}`;
        result = await authenticatedPost("/api/v1/system-rolls/one-ring/shadow-test", {
          source: shadowSource, points: shadowPoints, target: shadowTarget, rating: clamp(rating, 6),
          endurance: context.endurance, load: context.load, hope: context.hope, shadow: context.shadow, favored, ill_favored: illFavored,
        }, operation.controller.signal) as ShadowResult;
      } else if (system === "shadow-demon-lord") {
        const attribute = selectedAttribute;
        if (!attribute) return;
        if (attribute.value < 1 || attribute.value > 20) throw new Error("O atributo precisa ficar entre 1 e 20.");
        const counts = [boons, banes];
        if (counts.some((count) => !Number.isSafeInteger(count) || count < 0 || count > 10)) throw new Error("Dádivas e perdições vão de 0 a 10.");
        const targetValue = Number.isSafeInteger(target) && target >= 1 && target <= 40 ? target : null;
        if (targetValue === null) throw new Error("Informe um alvo de 1 a 40.");
        title = `${attribute.label} contra ${targetValue}`;
        result = await postWithChronicle("/api/v1/system-rolls/shadow-demon-lord", {
          attribute: attribute.value, boons, banes, target: targetValue,
        }, "sotdl", [attribute.id]) as SotdlResult;
      } else if (!selectedAttribute) {
        return;
      } else if (system === "hunter") {
        // F4: the server reads the cell's Desperation and stores the dice (record_hunter_roll).
        const basePool = selectedAttribute.value + (selectedSkill?.value ?? 0);
        if (basePool < 1 || basePool > 30) throw new Error("A parada precisa ficar entre 1 e 30 dados.");
        if (!Number.isSafeInteger(difficulty) || difficulty < 1 || difficulty > 69) throw new Error("Informe uma dificuldade de 1 a 69.");
        const edge = hunterDespair ? "" : hunterEdge;
        title = `${selectedAttribute.label}${selectedSkill ? ` + ${selectedSkill.label}` : ""}${edge ? ` · ${edge}` : ""}`;
        result = await postWithChronicle(`/api/v1/hunter/sheets/${selected.id}/rolls`, {
          base_pool: basePool, difficulty, use_desperation: useDesperation && !hunterDespair, ...(edge ? { edge } : {}),
        }, "hunter", [selectedAttribute.id, selectedSkill?.id]) as HunterRoll;
        if ((result as HunterRoll).cell !== undefined) setHunterRevision((value) => value + 1);
      } else {
        const context = ringContext(selected);
        const targetValue = Number.isSafeInteger(target) && target >= 1 && target <= 99 ? target : null;
        if (targetValue === null) throw new Error("Informe um TN de 1 a 99.");
        title = `${selectedAttribute.label}${selectedSkill ? ` + ${selectedSkill.label}` : ""}`;
        result = await postWithChronicle("/api/v1/system-rolls/one-ring", {
          target: targetValue, skill_dice: clamp(selectedSkill?.value ?? 0, 6), endurance: context.endurance, load: context.load,
          favored, ill_favored: illFavored, miserable: miserableFlag, wounded: context.wounded, hope: context.hope, shadow: context.shadow,
        }, "one-ring", [selectedAttribute.id, selectedSkill?.id]) as OneRingResult;
      }
      if (operation.id !== operationId.current || selectedRef.current?.id !== operation.characterId) return;
      const entry: HistoryEntry = { title, at: new Date().toLocaleTimeString(), result, chronicle };
      addHistory(selected.id, entry);
      if (system === "shadow-demon-lord") {
        const requests = "outcome" in result ? sotdlFateDice(result.die)
          : "d20" in result ? sotdlDice({ d20: result.d20, boonDice: result.boon_dice, netBoons: result.net_boons }) : null;
        if (requests) {
          setTray({ id: `${selected.id}-${operation.id}-${entry.at}`, systemKey: system, requests, summary: `${title} · ${describe(result)}` });
          return;
        }
      }
      if (system === "hunter" && "normal_dice" in result) {
        const { requests, omitted } = hunterDice(result.normal_dice, result.desperation_dice);
        setTray({
          id: `${selected.id}-${operation.id}-${entry.at}`, systemKey: system, requests,
          summary: `${title} · ${describe(result)}${omitted ? ` · ${omitted} dado(s) comuns fora da animação` : ""}`,
          interactive: true,
        });
        return;
      }
    } catch (error) {
      if (operation.id === operationId.current && selectedRef.current?.id === operation.characterId && !operation.controller.signal.aborted) {
        setMessage(error instanceof Error ? error.message : "Falha ao rolar.");
      }
    } finally {
      if (operation.id === operationId.current) { pending.current = null; setBusy(false); }
    }
  }

  const title = "Roladores de Caçador, O Um Anel e Shadow of the Demon Lord";
  const cells = campaignId ? <HunterCellsPanel campaignId={campaignId} canManage={canManage} /> : null;
  if (!character) return <><section className={`content ${styles.panel}`}><h2>{title}</h2><p>Selecione uma ficha da sessão.</p></section>{cells}</>;
  // Vampiro V3 (frente F3): its own roller and sheet actions.
  if (!system && isV3Sheet(values)) return <section className={`content ${styles.panel}`}><h2>Rolador de Vampiro V3</h2><V3VampirePanel character={character} campaignId={campaignId} /></section>;
  if (!system) return <><section className={`content ${styles.panel}`}><h2>{title}</h2><p>A ficha selecionada não tem campos reconhecidos desses sistemas.</p></section>{cells}</>;
  const eyebrow = system === "shadow-demon-lord" ? "SHADOW OF THE DEMON LORD · d20" : system === "hunter" ? "CAÇADOR · 5ª EDIÇÃO" : "O UM ANEL · 2ª EDIÇÃO";
  const tnKey = selectedAttribute ? `tn_${selectedAttribute.id}` as const : null;
  const attributeTn = ring && tnKey && tnKey in ring.derived ? ring.derived[tnKey as keyof typeof ring.derived] : null;
  const favorChecks = <div className={styles.checks}><label><input type="checkbox" checked={favored} onChange={(event) => { setFavored(event.target.checked); if (event.target.checked) setIllFavored(false); }} /> Favorecido</label><label><input type="checkbox" checked={illFavored} onChange={(event) => { setIllFavored(event.target.checked); if (event.target.checked) setFavored(false); }} /> Desfavorecido</label></div>;

  return <section className={`content ${styles.panel}`}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{eyebrow}</p><h2>{character.name}</h2></div><p>Rolagens vinculadas à ficha ativa. Os recursos da ficha não mudam.</p></header>
    <div className={styles.layout}>
      <article className={styles.card}>
        <h3>Montar a rolagem</h3>
        <div className={styles.selectGrid}>
          <label>Atributo<select value={selectedAttribute?.id ?? ""} onChange={(event) => setAttributeId(event.target.value)}>{attributeChoices.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}</select></label>
          {system !== "shadow-demon-lord" && <label>{system === "hunter" ? "Habilidade" : "Perícia"}<select value={selectedSkill?.id ?? NO_SKILL} onChange={(event) => setSkillId(event.target.value)}><option value={NO_SKILL}>Sem perícia</option>{skillChoices.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}</select></label>}
        </div>
        {system === "shadow-demon-lord" ? <>
          <div className={styles.selectGrid}>
            <label>Dádivas<input type="number" min={0} max={10} value={boons} onChange={(event) => setBoons(Number(event.target.value))} /></label>
            <label>Perdições<input type="number" min={0} max={10} value={banes} onChange={(event) => setBanes(Number(event.target.value))} /></label>
          </div>
          <label className={styles.target}>Alvo (10 ou a Defesa)<input type="number" min={1} max={40} value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label>
          <p className={styles.poolLine}>d20 {signed((selectedAttribute?.value ?? 10) - 10)}. Dádivas e perdições se anulam; das que sobram vale o maior d6. Defesa da ficha: <b>{String(values.defesa ?? "?")}</b>.</p>
          <button className={styles.rollButton} type="button" disabled={busy} onClick={() => void roll("fate")}>Teste de destino (1d6)</button>
          <p className={styles.note}>Para personagens incapacitados ao fim da rodada: 1 morrendo, 2 a 5 estável, 6 recupera 1 de dano.</p>
        </> : system === "hunter" ? <>
          <label className={styles.target}>Dificuldade<input type="number" min={1} max={69} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></label>
          <p className={styles.poolLine}>Reserva base: <b>{Math.max(0, (selectedAttribute?.value ?? 0) + (selectedSkill?.value ?? 0))} dados</b>. {hunterState?.cell
            ? <>Célula {hunterState.cell.name}: Desesperação <b>{hunterState.cell.desperation}</b> · Perigo <b>{hunterState.cell.danger}</b></>
            : "Sem célula vinculada"}{hunterDespair ? " · em Desespero" : ""}.</p>
          <div className={styles.checks}><label><input type="checkbox" checked={useDesperation && !hunterDespair} disabled={hunterDespair || !hunterState?.cell?.desperation} onChange={(event) => setUseDesperation(event.target.checked)} /> Somar {hunterState?.cell?.desperation ?? 0} dado(s) de Desesperação</label></div>
          <label>Triunfo usado<select value={hunterDespair ? "" : hunterEdge} disabled={hunterDespair || !hunterEdges.length} onChange={(event) => setHunterEdge(event.target.value)}><option value="">Nenhum</option>{hunterEdges.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <p className={styles.note}>Dados de Desesperação são adicionais e opcionais, quando a ação corresponde ao Credo ({String(values.credo ?? "sem credo")}); o servidor lê o valor da célula. Um 1 neles pede a escolha da mesa. Em Desespero, nem dados de Desesperação nem Triunfos.</p>
        </> : <>
          <div className={styles.selectGrid}>
            <label>TN<input type="number" min={1} max={99} value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label>
            {attributeTn !== null && <button className={styles.ghostButton} type="button" onClick={() => setTarget(attributeTn)}>Usar TN de {selectedAttribute?.label} ({attributeTn})</button>}
          </div>
          {favorChecks}
          <div className={styles.checks}><label><input type="checkbox" checked={miserableFlag} onChange={(event) => setMiserableFlag(event.target.checked)} /> Miserável pela mesa</label></div>
          <p className={styles.note}>Cansado: Vigor atual ≤ Carga + Cansaço; dados de Sucesso de 1 a 3 valem 0. Miserável: Sombra + Cicatrizes ≥ Esperança atual (ou marcado pela mesa); o Olho de Sauron vira falha automática. Ferido não muda os dados.</p>
        </>}
        {message && <p className={styles.message} role="status">{message}</p>}
        <button className={styles.rollButton} type="button" disabled={busy || !selectedAttribute} onClick={() => void roll()}>{busy ? "Rolando…" : "Rolar"}</button>
      </article>
      <article className={styles.card}>
        <h3>Histórico desta ficha</h3>
        {currentHistory.length ? <ol className={styles.history}>{currentHistory.map((entry, index) => <li key={`${entry.at}-${index}`}><div><b>{entry.title}</b><time>{entry.at}</time></div><p>{describe(entry.result)}</p>{chronicleActivityLabel(entry.chronicle ?? null) && <small className={styles.chronicle}>{chronicleActivityLabel(entry.chronicle ?? null)}</small>}</li>)}</ol> : <p>Nenhuma rolagem nesta sessão.</p>}
      </article>
      {ring && <article className={styles.card}>
        <h3>Estado do herói</h3>
        <ul className={styles.stateList}>
          <li data-on={ring.states.cansado}>Cansado · Vigor {String(values.vigor_marcha ?? "?")} de {ring.derived.vigor_max}, Carga {ring.derived.carga_total}</li>
          <li data-on={ring.states.miseravel}>Miserável · Sombra {ring.derived.sombra_total}, Esperança {String(values.esperanca ?? "?")} de {ring.derived.esperanca_max}</li>
          <li data-on={ring.states.ferido}>Ferido{values.ferido === true ? ` · ${String(values.ferimento_dias ?? 0)} dia(s)` : ""}</li>
          <li data-on={ring.states.surto}>Surto de loucura · Sombra alcança a Esperança máxima</li>
        </ul>
        <p className={styles.poolLine}>TN: Corpo <b>{ring.derived.tn_corpo}</b> · Coração <b>{ring.derived.tn_coracao}</b> · Astúcia <b>{ring.derived.tn_astucia}</b> · Aparar <b>{ring.derived.aparar}</b></p>
        {ring.problems.length > 0 && <ul className={styles.problems}>{ring.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        <h3>Teste de Sombra</h3>
        <div className={styles.selectGrid}>
          <label>Origem<select value={shadowSource} onChange={(event) => setShadowSource(event.target.value as typeof shadowSource)}>{SHADOW_SOURCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Pontos em jogo<input type="number" min={1} max={10} value={shadowPoints} onChange={(event) => setShadowPoints(Number(event.target.value))} /></label>
          <label>TN<input type="number" min={1} max={99} value={shadowTarget} onChange={(event) => setShadowTarget(Number(event.target.value))} /></label>
        </div>
        <button className={styles.rollButton} type="button" disabled={busy} onClick={() => void roll("shadow")}>Rolar teste de Sombra</button>
        <p className={styles.note}>Rola {shadowSource === "pavor" ? "Valor" : "Sabedoria"} da ficha. Sucesso evita os pontos; falha soma todos à Sombra. A ficha não é alterada.</p>
        <h3>Evento de jornada</h3>
        <label>Região<select value={region} onChange={(event) => setRegion(event.target.value as typeof region)}>{REGIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <button className={styles.rollButton} type="button" disabled={busy} onClick={() => void roll("journey")}>Sortear evento</button>
        <p className={styles.note}>O dado de Feito escolhe o evento e o Cansaço; um d6 escolhe o papel testado. Tabela resumida, marcada para conferência.</p>
      </article>}
      {system === "hunter" && <article className={styles.card}>
        <h3>Traços do caçador</h3>
        <p className={styles.poolLine}>Credo <b>{String(values.credo ?? "—")}</b> · Ímpeto <b>{String(values.impulso ?? "—")}</b></p>
        {hunterLegacy && <p className={styles.note}>Ficha do modelo anterior: Pilares em texto livre. Ao recriar no modelo v3, os pares abaixo seriam montados automaticamente.</p>}
        {[...hunterWarnings, ...hunterProblems].length > 0
          ? <ul className={styles.problems}>{[...new Set([...hunterWarnings, ...hunterProblems])].map((item) => <li key={item}>{item}</li>)}</ul>
          : <p className={styles.note}>Credo, Ímpeto e pares de Convicção e Pedra de Toque completos.</p>}
      </article>}
      {system === "hunter" && <HunterConsequencesCard latest={hunterLatest} state={hunterState} canManage={canManage}
        onRoll={replaceHunterRoll} onChanged={() => setHunterRevision((value) => value + 1)} />}
    </div>
    {cells}
    <DiceTrayOverlay roll={tray} onDone={closeTray} />
  </section>;
}
