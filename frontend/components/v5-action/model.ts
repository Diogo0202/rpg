/** Regras de tela da rolagem V5: campos da ficha, trilhas de dano e rótulos. Sem React. */

import type { ChronicleActivityStatus } from "../../lib/chronicle-context";
import type { AttackResult, DamageKind, ModifierPreview } from "../../lib/v5-action-roll";
import type { StoredRoll } from "../v5-willpower-reroll";

export type Track = "health" | "willpower";
export type NumericField = { id: string; label: string; value: number };
// The stored roll (V5-07) also carries the details the API saved with it.
export type PanelRoll = StoredRoll & { details?: unknown };
export type StoredAttack = { roll_id: string; sheet_id: string; campaign_id: string; rerolled: boolean; attack: AttackResult };
export type RerollResponse = { roll: PanelRoll; willpower_spent: boolean; sheet_values: Record<string, unknown> | null };
export type HistoryEntry = {
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
export type TargetSheet = { id: string; name: string };
export type TrackDamage = { superficial: number; aggravated: number; max: number };
export type IncomingDamage = { track: Track; superficial: number; aggravated: number; armor: boolean; physical: boolean };

type TemplateField = { id?: unknown; label?: unknown; kind?: unknown };

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

export const SHEET_COLUMNS = "id,name,version,values,effects";
export const DAMAGE_LABELS: Record<DamageKind, string> = { superficial: "superficial", aggravated: "agravado" };
export const TRACK_NAMES: Record<Track, string> = { health: "Saúde", willpower: "Força de Vontade" };

export function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** Campos numéricos do modelo que têm valor inteiro na ficha, sem as trilhas e a Fome. */
export function buildNumericFields(templateSchema: unknown, values: Record<string, unknown>): NumericField[] {
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

/** Atributos e habilidades conhecidos; sem eles, os campos livres servem para os dois. */
export function traitChoices(fields: NumericField[]): { attributes: NumericField[]; skills: NumericField[] } {
  const attributes = fields.filter((field) => ATTRIBUTE_IDS.has(field.id));
  const skills = fields.filter((field) => SKILL_IDS.has(field.id));
  const custom = fields.filter((field) => !ATTRIBUTE_IDS.has(field.id) && !SKILL_IDS.has(field.id));
  return { attributes: attributes.length ? attributes : custom, skills: skills.length ? skills : custom };
}

/** Saúde = Vigor + 3; Vontade = Autocontrole + Resolução; limitado a 30. */
export function maxTrack(values: Record<string, unknown>, track: Track): number {
  const first = integerValue(values[track === "health" ? "vigor" : "autocontrole"]);
  const second = track === "health" ? 3 : integerValue(values.resolucao);
  if (first === null || second === null) return 0;
  return Math.max(0, Math.min(30, first + second));
}

export function damageKey(track: Track, kind: DamageKind): string {
  return `${track === "health" ? "saude" : "vontade"}_${kind === "superficial" ? "superficial" : "agravada"}`;
}

export function trackDamage(values: Record<string, unknown>, track: Track): TrackDamage {
  return {
    superficial: integerValue(values[damageKey(track, "superficial")]) ?? 0,
    aggravated: integerValue(values[damageKey(track, "aggravated")]) ?? 0,
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

export function inferredContextTag(attributeId: string): string | null {
  if (["forca", "destreza", "vigor"].includes(attributeId)) return "fisico";
  if (["inteligencia", "raciocinio", "resolucao", "determinacao", "astucia"].includes(attributeId)) return "mental";
  if (["carisma", "manipulacao", "autocontrole"].includes(attributeId)) return "social";
  return null;
}

/** Põe a tag inferida do atributo na frente, sem repetir e sem passar de 20 tags. */
export function actionTagsFor(attributeId: string, contextTags: string[]): string[] {
  const inferred = inferredContextTag(attributeId);
  return inferred ? [inferred, ...contextTags.filter((tag) => tag !== inferred).slice(0, 19)] : contextTags;
}

export function outcomeLabel(roll: PanelRoll): string {
  const result = roll.outcome;
  if (result.messy_critical) return "Crítico sujo";
  if (result.clean_critical) return "Crítico limpo";
  if (result.bestial_failure) return "Falha bestial";
  return result.success ? "Sucesso" : "Falha";
}

/** Bônus de Surto de Sangue que o servidor guardou nos detalhes da rolagem (0 sem Surto). */
export function surgeBonusUsed(details: unknown): number {
  const surge = details && typeof details === "object" ? (details as Record<string, unknown>).blood_surge : null;
  return surge && typeof surge === "object" && typeof (surge as Record<string, unknown>).bonus_dice === "number"
    ? Number((surge as Record<string, unknown>).bonus_dice) : 0;
}

export function storedEntry(roll: PanelRoll, preview: ModifierPreview | null): HistoryEntry {
  return {
    roll, preview, recordedAt: new Date(roll.created_at).toLocaleString(),
    actionName: "Rolagem guardada", attackRequested: false, attack: null, attackError: "", chronicle: null, applied: [],
  };
}
