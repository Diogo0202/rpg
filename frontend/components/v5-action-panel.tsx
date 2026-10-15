"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { useCharacterSession, type SessionCharacter } from "../lib/character-session";
import { createClient } from "../lib/supabase/client";
import styles from "./v5-action-panel.module.css";

type NumericField = { id: string; label: string; value: number };
type TemplateField = { id?: unknown; label?: unknown; kind?: unknown };
type ActionRoll = {
  normal_dice: number[];
  hunger_dice: number[];
  hunger_count: number;
  successes: number;
  difficulty: number;
  success: boolean;
  critical_pairs: number;
  clean_critical: boolean;
  messy_critical: boolean;
  bestial_failure: boolean;
  modifier_preview: {
    base_pool: number;
    total_delta: number;
    adjusted_pool: number;
    applied: { id: string; label: string; delta: number; source_note: string | null }[];
    skipped: { id: string; reason: string }[];
    clipped: boolean;
  };
  damage_penalties: ("health" | "willpower")[];
};
type HistoryEntry = ActionRoll & { recordedAt: string; actionName: string };
type Operation = { id: number; controller: AbortController; character: SessionCharacter };

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const METRIC_FIELDS = new Set([
  "fome", "humanidade", "manchas", "saude_superficial", "saude_agravada",
  "vontade_superficial", "vontade_agravada", "saude_max", "vontade_max",
]);
const ATTRIBUTE_IDS = new Set([
  "forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole",
  "inteligencia", "raciocinio", "resolucao", "determinacao", "astucia",
]);
const SKILL_IDS = new Set([
  "armas_de_fogo", "armas_brancas", "atletismo", "briga", "conducao", "furtividade",
  "ladroagem", "oficios", "sobrevivencia", "etiqueta", "empatia", "intimidacao",
  "lideranca", "manha", "performance", "persuasao", "subterfugio", "trato_com_animais",
  "academicos", "ciencia", "consciencia", "financas", "investigacao", "medicina",
  "ocultismo", "percepcao", "tecnologia",
]);

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function buildNumericFields(templateSchema: unknown, values: Record<string, unknown>): NumericField[] {
  if (!templateSchema || typeof templateSchema !== "object" || !("fields" in templateSchema)) return [];
  const fields = (templateSchema as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    if (!field || typeof field !== "object") return [];
    const item = field as TemplateField;
    if (item.kind !== "number" || typeof item.id !== "string" || typeof item.label !== "string" || METRIC_FIELDS.has(item.id)) return [];
    const value = integerValue(values[item.id]);
    return value === null ? [] : [{ id: item.id, label: item.label, value }];
  });
}

function maxTrack(values: Record<string, unknown>, track: "health" | "willpower"): number {
  const first = integerValue(values[track === "health" ? "vigor" : "autocontrole"]);
  const second = track === "health" ? 3 : integerValue(values.resolucao);
  if (first === null || second === null) return 0;
  return Math.max(0, Math.min(30, first + second));
}

function trackDamage(values: Record<string, unknown>, track: "health" | "willpower") {
  const prefix = track === "health" ? "saude" : "vontade";
  return {
    superficial: integerValue(values[`${prefix}_superficial`]) ?? 0,
    aggravated: integerValue(values[`${prefix}_agravada`]) ?? 0,
    max: maxTrack(values, track),
  };
}

export function deriveDamageState(values: Record<string, unknown>) {
  const health = trackDamage(values, "health");
  const willpower = trackDamage(values, "willpower");
  return {
    health_max: health.max,
    health_superficial: health.superficial,
    health_aggravated: health.aggravated,
    willpower_max: willpower.max,
    willpower_superficial: willpower.superficial,
    willpower_aggravated: willpower.aggravated,
  };
}

function inferredContextTag(attributeId: string): string | null {
  if (["forca", "destreza", "vigor"].includes(attributeId)) return "fisico";
  if (["inteligencia", "raciocinio", "resolucao", "determinacao", "astucia"].includes(attributeId)) return "mental";
  if (["carisma", "manipulacao", "autocontrole"].includes(attributeId)) return "social";
  return null;
}

function responseError(body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item && typeof item === "object" && "msg" in item ? String(item.msg) : "Confira os campos da rolagem.").join(" ");
  }
  return "A API recusou a rolagem.";
}

export function V5ActionPanel({ campaignId, canEdit }: { campaignId: string; canEdit: boolean }) {
  const { character, contextTags, acceptSavedCharacter } = useCharacterSession();
  const selectedRef = useRef(character);
  selectedRef.current = character;
  const operationId = useRef(0);
  const pendingOperation = useRef<Operation | null>(null);
  const historyRef = useRef(new Map<string, HistoryEntry[]>());
  const [historyRevision, setHistoryRevision] = useState(0);
  const [fieldData, setFieldData] = useState<{ characterId: string; fields: NumericField[]; error: string } | null>(null);
  const [attributeId, setAttributeId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [manualPool, setManualPool] = useState(6);
  const [difficulty, setDifficulty] = useState(3);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const selected = character;
    if (!selected) {
      setFieldData(null);
      setMessage("");
      return;
    }
    const controller = new AbortController();
    let active = true;
    const isCurrent = () => active && !controller.signal.aborted && selectedRef.current === selected;
    setFieldData(null);
    void (async () => {
      try {
        const client = createClient();
        const { data: sheet, error: sheetError } = await client.from("character_sheets")
          .select("template_id").eq("id", selected.id).eq("campaign_id", campaignId)
          .abortSignal(controller.signal).maybeSingle();
        if (!isCurrent()) return;
        if (sheetError || !sheet) throw new Error("A ficha não pertence a esta campanha ou não está acessível.");
        const { data: template, error: templateError } = await client.from("system_templates")
          .select("schema").eq("id", sheet.template_id).eq("campaign_id", campaignId).eq("status", "approved")
          .abortSignal(controller.signal).maybeSingle();
        if (!isCurrent()) return;
        if (templateError || !template) throw new Error("Não foi possível ler o modelo da ficha.");
        setFieldData({ characterId: selected.id, fields: buildNumericFields(template.schema, selected.values), error: "" });
      } catch (error) {
        if (isCurrent()) setFieldData({ characterId: selected.id, fields: [], error: error instanceof Error ? error.message : "Falha ao ler os campos do modelo." });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [campaignId, character]);

  useEffect(() => {
    operationId.current += 1;
    pendingOperation.current?.controller.abort();
    pendingOperation.current = null;
    setBusy(false);
    setMessage("");
    setAttributeId("");
    setSkillId("");
    setManualPool(6);
    setDifficulty(3);
  }, [character?.id, campaignId]);

  const fields = fieldData && fieldData.characterId === character?.id ? fieldData.fields : [];
  const attributes = fields.filter((field) => ATTRIBUTE_IDS.has(field.id));
  const skills = fields.filter((field) => SKILL_IDS.has(field.id));
  const customNumericFields = fields.filter((field) => !ATTRIBUTE_IDS.has(field.id) && !SKILL_IDS.has(field.id));
  const attributeChoices = attributes.length ? attributes : customNumericFields;
  const skillChoices = skills.length ? skills : customNumericFields;

  useEffect(() => {
    if (!attributeChoices.some((field) => field.id === attributeId)) setAttributeId(attributeChoices[0]?.id ?? "");
    if (!skillChoices.some((field) => field.id === skillId)) setSkillId(skillChoices[0]?.id ?? "");
  }, [fields, attributeChoices, skillChoices, attributeId, skillId]);

  function beginOperation(selected: SessionCharacter): Operation {
    pendingOperation.current?.controller.abort();
    const next = { id: ++operationId.current, controller: new AbortController(), character: selected };
    pendingOperation.current = next;
    setBusy(true);
    setMessage("");
    return next;
  }

  function operationIsCurrent(operation: Operation): boolean {
    return !operation.controller.signal.aborted
      && operation.id === operationId.current
      && selectedRef.current === operation.character;
  }

  function endOperation(operation: Operation) {
    if (operation.id !== operationId.current) return;
    pendingOperation.current = null;
    setBusy(false);
  }

  async function performRoll(pool: number, actionName: string, actionTags: string[] = contextTags) {
    const selected = character;
    if (!selected) return;
    if (!Number.isInteger(pool) || pool < 0 || pool > 30 || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 100) {
      setMessage("Use uma parada de 0 a 30 dados e dificuldade de 1 a 100.");
      return;
    }
    const hunger = integerValue(selected.values.fome);
    if (hunger === null || hunger < 0 || hunger > 5) {
      setMessage("A ficha precisa ter Fome entre 0 e 5 antes da rolagem.");
      return;
    }
    const operation = beginOperation(selected);
    try {
      if (!API_URL) throw new Error("Configure NEXT_PUBLIC_API_URL para rolar a ação.");
      const { data, error } = await createClient().auth.getSession();
      if (!operationIsCurrent(operation)) return;
      if (error || !data.session) throw new Error("Entre na campanha para rolar a ação.");
      const damage = deriveDamageState(selected.values);
      const response = await fetch(`${API_URL}/api/v1/v5/roll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({
          pool,
          hunger,
          difficulty,
          effects: selected.effects,
          context_tags: actionTags,
          damage,
        }),
        signal: operation.controller.signal,
      });
      const body = await response.json() as unknown;
      if (!operationIsCurrent(operation)) return;
      if (!response.ok) throw new Error(responseError(body));
      const result = body as ActionRoll;
      const entry = { ...result, recordedAt: new Date().toLocaleTimeString(), actionName };
      historyRef.current.set(selected.id, [entry, ...(historyRef.current.get(selected.id) ?? [])].slice(0, 8));
      setHistoryRevision((value) => value + 1);
    } catch (error) {
      if (operationIsCurrent(operation)) setMessage(error instanceof Error ? error.message : "Falha ao rolar a ação.");
    } finally {
      endOperation(operation);
    }
  }

  async function changeDamage(track: "health" | "willpower", kind: "superficial" | "aggravated", amount: -1 | 1) {
    const selected = character;
    if (!selected || !canEdit) return;
    const maximum = maxTrack(selected.values, track);
    if (maximum === 0) return;
    const prefix = track === "health" ? "saude" : "vontade";
    const key = `${prefix}_${kind === "superficial" ? "superficial" : "agravada"}`;
    const damage = trackDamage(selected.values, track);
    const current = kind === "superficial" ? damage.superficial : damage.aggravated;
    const next = current + amount;
    if (next < 0 || damage.superficial + damage.aggravated + amount > maximum) {
      setMessage(amount > 0 ? "A trilha já está cheia. Remova dano antes de adicionar outro ponto." : "Não há dano desse tipo para remover.");
      return;
    }
    const operation = beginOperation(selected);
    const updatedValues = { ...selected.values, [key]: next };
    try {
      const { data, error } = await createClient().from("character_sheets")
        .update({ values: updatedValues })
        .eq("id", selected.id).eq("campaign_id", campaignId).eq("version", selected.version)
        .select("id,name,version,values,effects")
        .abortSignal(operation.controller.signal).maybeSingle();
      if (!operationIsCurrent(operation)) return;
      if (error || !data) throw new Error("A ficha mudou em outra sessão. Atualize a sessão antes de ajustar o dano.");
      acceptSavedCharacter(data as SessionCharacter);
      setMessage("Dano atualizado na ficha.");
    } catch (error) {
      if (operationIsCurrent(operation)) setMessage(error instanceof Error ? error.message : "Falha ao atualizar dano.");
    } finally {
      endOperation(operation);
    }
  }

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void performRoll(manualPool, "Rolagem manual");
  }

  function quickRoll(field: NumericField, kind: "attribute" | "skill") {
    const otherId = kind === "attribute" ? skillId : attributeId;
    const other = fields.find((item) => item.id === otherId);
    const total = field.value + (other?.value ?? 0);
    const name = kind === "attribute" ? `${field.label} + ${other?.label ?? "0"}` : `${other?.label ?? "0"} + ${field.label}`;
    const currentAttributeId = kind === "attribute" ? field.id : attributeId;
    const inferredTag = inferredContextTag(currentAttributeId);
    const actionTags = inferredTag
      ? [inferredTag, ...contextTags.filter((tag) => tag !== inferredTag).slice(0, 19)]
      : contextTags;
    setAttributeId(kind === "attribute" ? field.id : attributeId);
    setSkillId(kind === "skill" ? field.id : skillId);
    void performRoll(total, name, actionTags);
  }

  function outcome(entry: HistoryEntry): string {
    if (entry.messy_critical) return "Crítico sujo";
    if (entry.clean_critical) return "Crítico limpo";
    if (entry.bestial_failure) return "Falha bestial";
    return entry.success ? "Sucesso" : "Falha";
  }

  if (!character) return <section className={`content ${styles.panel}`}><h2>Rolagem V5 e integridade</h2><p>Selecione uma ficha salva para rolar ações e acompanhar dano.</p></section>;

  const visibleHistory = historyRef.current.get(character.id) ?? [];
  void historyRevision;
  const hungerValue = integerValue(character.values.fome);
  const health = trackDamage(character.values, "health");
  const willpower = trackDamage(character.values, "willpower");

  function renderTrack(title: string, track: "health" | "willpower", damage: ReturnType<typeof trackDamage>) {
    return <article className={styles.trackCard}>
      <div className={styles.trackHeading}><div><span>{title}</span><b>{damage.superficial + damage.aggravated}/{damage.max || "sem trilha"}</b></div>
        {damage.max > 0 && <div className={styles.boxes} aria-label={`${title}: ${damage.superficial} superficial e ${damage.aggravated} agravado de ${damage.max}`}>
          {Array.from({ length: damage.max }, (_, index) => {
            const filled = index < damage.superficial + damage.aggravated;
            const severe = filled && index >= damage.superficial;
            return <i key={index} className={severe ? styles.aggravatedBox : filled ? styles.superficialBox : ""} />;
          })}
        </div>}
      </div>
      {damage.max === 0 ? <p>Esta ficha não tem valores para calcular a trilha.</p> : <div className={styles.damageControls}>
        {(["superficial", "aggravated"] as const).map((kind) => {
          const count = kind === "superficial" ? damage.superficial : damage.aggravated;
          const label = kind === "superficial" ? "Superficial" : "Agravado";
          return <div className={styles.damageKind} key={kind}><span>{label}: {count}</span>
            <button type="button" disabled={!canEdit || busy || count === 0} onClick={() => void changeDamage(track, kind, -1)} aria-label={`Remover dano ${label.toLowerCase()} de ${title}`}>−</button>
            <button type="button" disabled={!canEdit || busy || damage.superficial + damage.aggravated >= damage.max} onClick={() => void changeDamage(track, kind, 1)} aria-label={`Adicionar dano ${label.toLowerCase()} a ${title}`}>+</button>
          </div>;
        })}
      </div>}
      <small>{track === "health" ? "Máximo calculado por Vigor + 3." : "Máximo calculado por Autocontrole + Resolução."}</small>
    </article>;
  }

  return <section className={`content ${styles.panel}`} aria-busy={busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>V5 · AÇÃO E INTEGRIDADE</p><h2>{character.name}</h2></div><p>Dados comuns e de Fome são rolados separadamente. Vontade não rerrola sem estado confirmado.</p></header>
    <div className={styles.layout}>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Rolagem guiada</h3>
          {fieldData && fieldData.characterId === character.id && fieldData.error && <p role="status" className={styles.message}>{fieldData.error}</p>}
          <div className={styles.selectGrid}>
            <label>Atributo<select value={attributeId} onChange={(event) => setAttributeId(event.target.value)} disabled={!attributeChoices.length}>
              {attributeChoices.map((field) => <option key={field.id} value={field.id}>{field.label} · {field.value}</option>)}
            </select></label>
            <label>Habilidade<select value={skillId} onChange={(event) => setSkillId(event.target.value)} disabled={!skillChoices.length}>
              {skillChoices.map((field) => <option key={field.id} value={field.id}>{field.label} · {field.value}</option>)}
            </select></label>
          </div>
          {fieldData?.characterId === character.id && !fieldData.error && skillChoices.length === 0 && <p className={styles.note}>Esta ficha não tem campos numéricos de habilidade. Use o pool manual ou acrescente habilidades ao modelo.</p>}
          <p className={styles.poolLine}>Parada selecionada: <b>{(fields.find((field) => field.id === attributeId)?.value ?? 0) + (fields.find((field) => field.id === skillId)?.value ?? 0)} dados</b></p>
          <label className={styles.inlineLabel}>Dificuldade<input type="number" min={1} max={100} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></label>
          <div className={styles.quickGroups}>
            <div><h4>Rolagem rápida · atributos</h4><div className={styles.quickButtons}>{attributeChoices.map((field) => <button type="button" key={field.id} disabled={busy || hungerValue === null} onClick={() => quickRoll(field, "attribute")}>{field.label} {field.value}</button>)}</div></div>
            <div><h4>Rolagem rápida · habilidades</h4><div className={styles.quickButtons}>{skillChoices.map((field) => <button type="button" key={field.id} disabled={busy || hungerValue === null} onClick={() => quickRoll(field, "skill")}>{field.label} {field.value}</button>)}</div></div>
          </div>
          <form onSubmit={submitManual} className={styles.manualForm}>
            <label>Pool manual<input type="number" min={0} max={30} value={manualPool} onChange={(event) => setManualPool(Number(event.target.value))} /></label>
            <button type="submit" disabled={busy || hungerValue === null}>Rolar pool manual</button>
          </form>
          <p className={styles.note}>Fome da ficha: {hungerValue ?? "inválida"} · Tags de contexto: {contextTags.join(", ") || "nenhuma"}</p>
        </article>
        <article className={styles.card}>
          <h3>Integridade</h3>
          <div className={styles.tracks}>{renderTrack("Saúde", "health", health)}{renderTrack("Força de Vontade", "willpower", willpower)}</div>
          <p className={styles.note}>Cada clique altera somente o campo de dano escolhido. A penalidade de −2 entra no servidor quando a trilha relevante está cheia.</p>
        </article>
      </div>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Histórico desta ficha</h3>
          <p className={styles.note}>O histórico existe apenas nesta sessão do navegador.</p>
          {visibleHistory.length === 0 ? <p>Nenhuma rolagem ainda.</p> : <ol className={styles.history}>{visibleHistory.map((entry, index) => <li key={`${entry.recordedAt}-${index}`}>
            <div><b>{entry.actionName}</b><time>{entry.recordedAt}</time></div>
            <p className={styles.diceLine}><span>Normais</span> {entry.normal_dice.join(" · ") || "—"} <span>Fome</span> {entry.hunger_dice.join(" · ") || "—"}</p>
            <p>{entry.successes} sucessos / dif. {entry.difficulty} · <strong>{outcome(entry)}</strong></p>
            <p>Modificadores: {entry.modifier_preview.total_delta >= 0 ? "+" : ""}{entry.modifier_preview.total_delta}, pool final {entry.modifier_preview.adjusted_pool}.</p>
            {entry.damage_penalties.map((penalty) => <p className={styles.penalty} key={penalty}>−2 por trilha de {penalty === "health" ? "Saúde" : "Força de Vontade"} cheia.</p>)}
            {entry.modifier_preview.applied.map((effect) => <small key={effect.id}>{effect.label}: {effect.delta >= 0 ? "+" : ""}{effect.delta} dados. </small>)}
            {entry.modifier_preview.skipped.length > 0 && <small>Efeitos ignorados: {entry.modifier_preview.skipped.map((effect) => `${effect.id} (${effect.reason})`).join(", ")}</small>}
          </li>)}</ol>}
          {message && <p role="status" className={styles.message}>{message}</p>}
        </article>
      </div>
    </div>
  </section>;
}
