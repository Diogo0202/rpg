"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { useCharacterSession, type SessionCharacter } from "../lib/character-session";
import { CHRONICLE_ACTIVITY_HEADER, chronicleActivityLabel, newRollKey, parseChronicleActivity, type ChronicleActivityStatus } from "../lib/chronicle-context";
import { createClient } from "../lib/supabase/client";
import {
  actionChronicle, attackDamageSplit, attackOperationKey, canApplyAttackDamage, damagePenaltiesFrom,
  describeDamageResult, storedModifierPreview, toggleRerollIndex,
  type AttackResult, type DamageKind, type DamageResult, type ModifierPreview,
} from "../lib/v5-action-roll";
import type { StoredRoll } from "./v5-willpower-reroll";
import styles from "./v5-action-panel.module.css";

type NumericField = { id: string; label: string; value: number };
type TemplateField = { id?: unknown; label?: unknown; kind?: unknown };
// The stored roll (V5-07) also carries the details the API saved with it.
type PanelRoll = StoredRoll & { details?: unknown };
type StoredAttack = { roll_id: string; sheet_id: string; campaign_id: string; rerolled: boolean; attack: AttackResult };
type RerollResponse = { roll: PanelRoll; willpower_spent: boolean; sheet_values: Record<string, unknown> | null };
type HistoryEntry = {
  roll: PanelRoll;
  recordedAt: string;
  actionName: string;
  preview: ModifierPreview | null;
  attackRequested: boolean;
  attack: AttackResult | null;
  attackError: string;
  chronicle: ChronicleActivityStatus | null;
  applied: string[];
};
type Operation = { id: number; controller: AbortController; character: SessionCharacter };
type TargetSheet = { id: string; name: string };

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
const SHEET_COLUMNS = "id,name,version,values,effects";

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

export { describeDamageResult };

function inferredContextTag(attributeId: string): string | null {
  if (["forca", "destreza", "vigor"].includes(attributeId)) return "fisico";
  if (["inteligencia", "raciocinio", "resolucao", "determinacao", "astucia"].includes(attributeId)) return "mental";
  if (["carisma", "manipulacao", "autocontrole"].includes(attributeId)) return "social";
  return null;
}

function responseError(body: unknown, fallback = "A API recusou a rolagem."): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item && typeof item === "object" && "msg" in item ? String(item.msg) : "Confira os campos da rolagem.").join(" ");
  }
  return fallback;
}

async function apiPost(path: string, body: unknown, signal: AbortSignal, fallback?: string): Promise<{ body: unknown; headers: Headers }> {
  if (!API_URL) throw new Error("Configure NEXT_PUBLIC_API_URL para rolar a ação.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre na campanha para rolar a ação.");
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(body),
    signal,
  });
  const parsed = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(responseError(parsed, fallback));
  return { body: parsed, headers: response.headers };
}

const DAMAGE_LABELS: Record<DamageKind, string> = { superficial: "superficial", aggravated: "agravado" };

export function V5ActionPanel({ campaignId, canEdit, canNarrate = false }: { campaignId: string; canEdit: boolean; canNarrate?: boolean }) {
  const { character, contextTags, acceptSavedCharacter } = useCharacterSession();
  const selectedRef = useRef(character);
  selectedRef.current = character;
  const operationId = useRef(0);
  const pendingOperation = useRef<Operation | null>(null);
  const historyRef = useRef(new Map<string, HistoryEntry[]>());
  const damageOperations = useRef(new Map<string, string>());
  const [historyRevision, setHistoryRevision] = useState(0);
  const [fieldData, setFieldData] = useState<{ characterId: string; fields: NumericField[]; error: string } | null>(null);
  const [attributeId, setAttributeId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [manualPool, setManualPool] = useState(6);
  const [difficulty, setDifficulty] = useState(3);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attackMode, setAttackMode] = useState(false);
  const [rerollPick, setRerollPick] = useState<{ rollId: string; indices: number[] } | null>(null);
  const [targets, setTargets] = useState<TargetSheet[]>([]);
  const [targetId, setTargetId] = useState("");
  const [targetArmor, setTargetArmor] = useState(true);
  const [incoming, setIncoming] = useState<{ track: "health" | "willpower"; superficial: number; aggravated: number; armor: boolean }>(
    { track: "health", superficial: 1, aggravated: 0, armor: true },
  );

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
    setRerollPick(null);
  }, [character?.id, campaignId]);

  // Narrator only: the campaign sheets that can receive attack damage. RLS still decides on apply.
  useEffect(() => {
    if (!canNarrate) {
      setTargets([]);
      setTargetId("");
      return;
    }
    const controller = new AbortController();
    void (async () => {
      const { data, error } = await createClient().from("character_sheets")
        .select("id,name").eq("campaign_id", campaignId).order("name")
        .abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (error || !Array.isArray(data)) {
        setTargets([]);
        return;
      }
      const rows = (data as { id: unknown; name: unknown }[])
        .filter((row): row is TargetSheet => typeof row.id === "string" && typeof row.name === "string");
      setTargets(rows);
      setTargetId((current) => rows.some((row) => row.id === current) ? current : "");
    })();
    return () => controller.abort();
  }, [campaignId, canNarrate]);

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

  function updateEntry(sheetId: string, rollId: string, update: (entry: HistoryEntry) => HistoryEntry) {
    const entries = historyRef.current.get(sheetId) ?? [];
    historyRef.current.set(sheetId, entries.map((entry) => entry.roll.id === rollId ? update(entry) : entry));
    setHistoryRevision((value) => value + 1);
  }

  async function fetchAttack(rollId: string, signal: AbortSignal): Promise<AttackResult> {
    const { body } = await apiPost(`/api/v1/v5/rolls/${rollId}/attack`, { use_equipped_weapon: true }, signal, "Não foi possível calcular o dano do ataque.");
    return (body as StoredAttack).attack;
  }

  async function refreshSheet(selected: SessionCharacter, signal: AbortSignal) {
    const { data } = await createClient().from("character_sheets").select(SHEET_COLUMNS)
      .eq("id", selected.id).eq("campaign_id", campaignId).abortSignal(signal).maybeSingle();
    if (data) acceptSavedCharacter(data as SessionCharacter);
  }

  async function performRoll(pool: number, actionName: string, actionTags: string[] = contextTags, traits: { attributeId: string; skillId: string } | null = null) {
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
    const chronicle = actionChronicle({
      sheetId: selected.id, campaignId, attributeId: traits?.attributeId, skillId: traits?.skillId, rollKey: newRollKey("v5-action"),
    });
    try {
      // V5-07: the database rolls the dice and stores them; Hunger, effects and damage come from the saved sheet.
      const { body, headers } = await apiPost(`/api/v1/v5/sheets/${selected.id}/rolls`, {
        pool, difficulty, context_tags: actionTags, ...(chronicle ? { chronicle } : {}),
      }, operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      const roll = body as PanelRoll;
      const preview = storedModifierPreview(roll.details);
      const entry: HistoryEntry = {
        roll, preview, recordedAt: new Date().toLocaleTimeString(),
        actionName: attackMode ? `Ataque · ${actionName}` : actionName,
        attackRequested: attackMode, attack: null, attackError: "",
        chronicle: parseChronicleActivity(headers.get(CHRONICLE_ACTIVITY_HEADER)),
        applied: [],
      };
      historyRef.current.set(selected.id, [entry, ...(historyRef.current.get(selected.id) ?? [])].slice(0, 8));
      setHistoryRevision((value) => value + 1);
      setRerollPick(null);
      if (attackMode) {
        try {
          const attack = await fetchAttack(roll.id, operation.controller.signal);
          if (operationIsCurrent(operation)) updateEntry(selected.id, roll.id, (item) => ({ ...item, attack }));
        } catch (error) {
          if (operationIsCurrent(operation)) updateEntry(selected.id, roll.id, (item) => ({ ...item, attackError: error instanceof Error ? error.message : "Falha ao calcular o dano." }));
        }
      }
    } catch (error) {
      if (operationIsCurrent(operation)) setMessage(error instanceof Error ? error.message : "Falha ao rolar a ação.");
    } finally {
      endOperation(operation);
    }
  }

  async function rerollWithWillpower(entry: HistoryEntry) {
    const selected = character;
    if (!selected || !rerollPick || rerollPick.rollId !== entry.roll.id || !rerollPick.indices.length) return;
    const operation = beginOperation(selected);
    try {
      const { body } = await apiPost(`/api/v1/v5/rolls/${entry.roll.id}/willpower-reroll`, { normal_indices: rerollPick.indices }, operation.controller.signal, "Não foi possível rerrolar.");
      if (!operationIsCurrent(operation)) return;
      const result = body as RerollResponse;
      updateEntry(selected.id, entry.roll.id, (item) => ({ ...item, roll: { ...result.roll, details: result.roll.details ?? item.roll.details } }));
      setRerollPick(null);
      setMessage(result.willpower_spent ? "Rerrolagem feita. 1 dano superficial de Vontade foi marcado na ficha." : "Rerrolagem feita. Este modelo de ficha não tem trilha de Vontade.");
      if (entry.attackRequested) {
        try {
          const attack = await fetchAttack(entry.roll.id, operation.controller.signal);
          if (operationIsCurrent(operation)) updateEntry(selected.id, entry.roll.id, (item) => ({ ...item, attack, attackError: "" }));
        } catch (error) {
          if (operationIsCurrent(operation)) updateEntry(selected.id, entry.roll.id, (item) => ({ ...item, attackError: error instanceof Error ? error.message : "Falha ao recalcular o dano." }));
        }
      }
      if (result.willpower_spent && operationIsCurrent(operation)) await refreshSheet(selected, operation.controller.signal);
    } catch (error) {
      if (operationIsCurrent(operation)) setMessage(error instanceof Error ? error.message : "Falha ao rerrolar.");
    } finally {
      endOperation(operation);
    }
  }

  async function applyAttackToTarget(entry: HistoryEntry) {
    const selected = character;
    const target = targets.find((item) => item.id === targetId);
    const split = attackDamageSplit(entry.attack);
    if (!selected || !target || !split || !canApplyAttackDamage({ canNarrate, attack: entry.attack, targetId })) return;
    const key = attackOperationKey(entry.roll.id, target.id);
    const operationUuid = damageOperations.current.get(key) ?? crypto.randomUUID();
    damageOperations.current.set(key, operationUuid);
    const operation = beginOperation(selected);
    try {
      const { data, error } = await createClient().rpc("apply_v5_damage", {
        p_sheet_id: target.id,
        p_track: "health",
        p_superficial: split.superficial,
        p_aggravated: split.aggravated,
        p_apply_armor: targetArmor,
        p_operation_id: operationUuid,
        p_reason: `Ataque de ${selected.name}`.slice(0, 120),
      }).abortSignal(operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if (error || !data) throw new Error("O servidor recusou o dano. Confira a trilha de Saúde do alvo e o acesso à ficha.");
      const result = data as DamageResult;
      if (result.sheet?.id === selected.id) {
        const { id, name, version, values, effects } = result.sheet;
        acceptSavedCharacter({ id, name, version, values, effects } as SessionCharacter);
      }
      updateEntry(selected.id, entry.roll.id, (item) => ({ ...item, applied: [...new Set([...item.applied, target.id])] }));
      setMessage(describeDamageResult(result, target.name));
    } catch (error) {
      if (operationIsCurrent(operation)) setMessage(error instanceof Error ? error.message : "Falha ao aplicar o dano no alvo.");
    } finally {
      endOperation(operation);
    }
  }

  async function applyDamage(track: "health" | "willpower", superficial: number, aggravated: number, armor: boolean) {
    const selected = character;
    if (!selected || !canEdit) return;
    if (![superficial, aggravated].every((value) => Number.isInteger(value) && value >= 0 && value <= 30) || superficial + aggravated === 0) {
      setMessage("Informe de 0 a 30 pontos de cada tipo, com pelo menos um ponto de dano.");
      return;
    }
    const operation = beginOperation(selected);
    try {
      const { data, error } = await createClient().rpc("apply_v5_damage", {
        p_sheet_id: selected.id,
        p_track: track,
        p_superficial: superficial,
        p_aggravated: aggravated,
        p_apply_armor: armor,
        p_operation_id: crypto.randomUUID(),
      }).abortSignal(operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if (error || !data) throw new Error("O servidor recusou o dano. Confira a trilha e o acesso à ficha.");
      const result = data as DamageResult;
      const { id, name, version, values, effects } = result.sheet;
      acceptSavedCharacter({ id, name, version, values, effects } as SessionCharacter);
      setMessage(describeDamageResult(result));
    } catch (error) {
      if (operationIsCurrent(operation)) setMessage(error instanceof Error ? error.message : "Falha ao aplicar dano.");
    } finally {
      endOperation(operation);
    }
  }

  async function changeDamage(track: "health" | "willpower", kind: "superficial" | "aggravated", amount: -1 | 1) {
    const selected = character;
    if (!selected || !canEdit) return;
    const maximum = maxTrack(selected.values, track);
    if (maximum === 0) return;
    // Adding goes through the atomic RPC so a full track converts Superficial into Aggravated.
    if (amount > 0) return applyDamage(track, kind === "superficial" ? 1 : 0, kind === "aggravated" ? 1 : 0, false);
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
        .select(SHEET_COLUMNS)
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
    const currentSkillId = kind === "skill" ? field.id : skillId;
    const inferredTag = inferredContextTag(currentAttributeId);
    const actionTags = inferredTag
      ? [inferredTag, ...contextTags.filter((tag) => tag !== inferredTag).slice(0, 19)]
      : contextTags;
    setAttributeId(currentAttributeId);
    setSkillId(currentSkillId);
    void performRoll(total, name, actionTags, { attributeId: currentAttributeId, skillId: currentSkillId });
  }

  function outcome(entry: HistoryEntry): string {
    const result = entry.roll.outcome;
    if (result.messy_critical) return "Crítico sujo";
    if (result.clean_critical) return "Crítico limpo";
    if (result.bestial_failure) return "Falha bestial";
    return result.success ? "Sucesso" : "Falha";
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
            <button type="button" disabled={!canEdit || busy || damage.aggravated >= damage.max} onClick={() => void changeDamage(track, kind, 1)} aria-label={`Adicionar dano ${label.toLowerCase()} a ${title}`}>+</button>
          </div>;
        })}
      </div>}
      <small>{track === "health" ? "Máximo calculado por Vigor + 3." : "Máximo calculado por Autocontrole + Resolução."}</small>
    </article>;
  }

  function renderEntry(entry: HistoryEntry, index: number) {
    const roll = entry.roll;
    const canReroll = index === 0 && roll.rerolled_at === null;
    const picked = rerollPick?.rollId === roll.id ? rerollPick.indices : [];
    const penalties = damagePenaltiesFrom(entry.preview);
    const chronicleLabel = chronicleActivityLabel(entry.chronicle);
    const split = attackDamageSplit(entry.attack);
    const alreadyApplied = targetId !== "" && entry.applied.includes(targetId);
    return <li key={roll.id}>
      <div><b>{entry.actionName}{chronicleLabel && <span className={styles.chronicle} title="Esta rolagem virou atividade da crônica.">{chronicleLabel}</span>}</b><time>{entry.recordedAt}</time></div>
      <div className={styles.dice} aria-label="Dados da rolagem">
        {roll.normal_dice.map((face, dieIndex) => <button type="button" key={`n${dieIndex}`} className={styles.die}
          disabled={!canReroll || busy} aria-pressed={canReroll ? picked.includes(dieIndex) : undefined}
          aria-label={`Dado comum ${face}${picked.includes(dieIndex) ? ", marcado para rerrolar" : ""}`}
          onClick={() => setRerollPick({ rollId: roll.id, indices: toggleRerollIndex(picked, dieIndex) })}>{face}</button>)}
        {roll.hunger_dice.map((face, dieIndex) => <button type="button" key={`h${dieIndex}`} className={`${styles.die} ${styles.hungerDie}`} disabled aria-label={`Dado de Fome ${face}`}>{face}</button>)}
      </div>
      <p>{roll.outcome.successes} sucessos / dif. {roll.difficulty} · <strong>{outcome(entry)}</strong>{roll.rerolled_at ? " · com Vontade" : ""}</p>
      {roll.original_normal_dice && <p>Antes da Vontade: {roll.original_normal_dice.join(" · ")}.</p>}
      {canReroll && <div className={styles.rerollRow}>
        <button type="button" disabled={busy || !roll.recommended_reroll.length} onClick={() => setRerollPick({ rollId: roll.id, indices: roll.recommended_reroll })}>
          {roll.recommended_reroll.length ? `Sugestão: dados ${roll.recommended_reroll.map((item) => item + 1).join(", ")}` : "Rerrolar não melhora"}
        </button>
        <button type="button" disabled={busy || !picked.length} onClick={() => void rerollWithWillpower(entry)}>Rerrolar {picked.length || ""} com Vontade</button>
      </div>}
      {entry.preview && <p>Modificadores: {entry.preview.total_delta >= 0 ? "+" : ""}{entry.preview.total_delta}, pool final {entry.preview.adjusted_pool}.</p>}
      {entry.attack && <p className={styles.penalty}>Dano causado: <b>{entry.attack.damage} {DAMAGE_LABELS[entry.attack.damage_type]}</b> ({entry.attack.sources.map((source) => `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`).join(" · ")}){entry.attack.weapon ? "" : " · desarmado"}</p>}
      {entry.attackError && <p className={styles.penalty}>{entry.attackError}</p>}
      {canNarrate && split && <form className={styles.targetForm} onSubmit={(event) => { event.preventDefault(); void applyAttackToTarget(entry); }}>
        <label>Alvo do ataque<select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">Escolha a ficha</option>
          {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select></label>
        <button type="submit" disabled={busy || !canApplyAttackDamage({ canNarrate, attack: entry.attack, targetId }) || alreadyApplied}>
          {alreadyApplied ? "Dano aplicado" : `Aplicar ${split.superficial + split.aggravated} na Saúde`}
        </button>
        <label className={styles.inlineLabel}><input type="checkbox" checked={targetArmor} onChange={(event) => setTargetArmor(event.target.checked)} /> Armadura do alvo absorve dano superficial</label>
      </form>}
      {penalties.map((penalty) => <p className={styles.penalty} key={penalty}>−2 por trilha de {penalty === "health" ? "Saúde" : "Força de Vontade"} cheia.</p>)}
      {entry.preview?.applied.map((effect) => <small key={effect.id}>{effect.label}: {effect.delta >= 0 ? "+" : ""}{effect.delta} dados. </small>)}
      {entry.preview && entry.preview.skipped.length > 0 && <small>Efeitos ignorados: {entry.preview.skipped.map((effect) => `${effect.id} (${effect.reason})`).join(", ")}</small>}
    </li>;
  }

  return <section className={`content ${styles.panel}`} aria-busy={busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>V5 · AÇÃO E INTEGRIDADE</p><h2>{character.name}</h2></div><p>O servidor rola e guarda os dados com a Fome e as condições salvas da ficha. Depois, até 3 dados comuns podem ser rerrolados uma vez com Vontade.</p></header>
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
          <label className={styles.inlineLabel}><input type="checkbox" checked={attackMode} onChange={(event) => setAttackMode(event.target.checked)} /> Ataque: somar dano da arma equipada</label>
          <p className={styles.note}>Fome da ficha: {hungerValue ?? "inválida"} · Tags de contexto: {contextTags.join(", ") || "nenhuma"}</p>
          <p className={styles.note}>Rolagens rápidas registram o atributo e a habilidade usados como atividade da crônica.</p>
        </article>
        <article className={styles.card}>
          <h3>Integridade</h3>
          <div className={styles.tracks}>{renderTrack("Saúde", "health", health)}{renderTrack("Força de Vontade", "willpower", willpower)}</div>
          <p className={styles.note}>Adicionar dano passa pelo servidor: com a trilha cheia, cada novo ponto converte um superficial em agravado. A penalidade de −2 entra no servidor quando a trilha relevante está cheia.</p>
          <form className={styles.manualForm} onSubmit={(event) => { event.preventDefault(); void applyDamage(incoming.track, incoming.superficial, incoming.aggravated, incoming.armor); }}>
            <label>Trilha<select value={incoming.track} onChange={(event) => setIncoming({ ...incoming, track: event.target.value as "health" | "willpower" })}>
              <option value="health">Saúde</option><option value="willpower">Força de Vontade</option>
            </select></label>
            <label>Superficial<input type="number" min={0} max={30} value={incoming.superficial} onChange={(event) => setIncoming({ ...incoming, superficial: Number(event.target.value) })} /></label>
            <label>Agravado<input type="number" min={0} max={30} value={incoming.aggravated} onChange={(event) => setIncoming({ ...incoming, aggravated: Number(event.target.value) })} /></label>
            <label className={styles.inlineLabel}><input type="checkbox" checked={incoming.armor} disabled={incoming.track !== "health"} onChange={(event) => setIncoming({ ...incoming, armor: event.target.checked })} /> Aplicar armadura equipada</label>
            <button type="submit" disabled={!canEdit || busy}>Receber dano</button>
          </form>
          <p className={styles.note}>A proteção da armadura equipada reduz apenas dano superficial à Saúde e é lida pelo servidor.</p>
        </article>
      </div>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Histórico desta ficha</h3>
          <p className={styles.note}>As rolagens ficam guardadas no servidor; esta lista mostra as desta sessão do navegador.</p>
          {visibleHistory.length === 0 ? <p>Nenhuma rolagem ainda.</p> : <ol className={styles.history}>{visibleHistory.map(renderEntry)}</ol>}
          {!canNarrate && visibleHistory.some((entry) => attackDamageSplit(entry.attack)) && <p className={styles.note}>O narrador aplica o dano do ataque na ficha do alvo.</p>}
          {message && <p role="status" className={styles.message}>{message}</p>}
        </article>
      </div>
    </div>
  </section>;
}
