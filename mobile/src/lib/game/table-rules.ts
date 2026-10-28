/**
 * Pure helpers for the mobile table screens. They only read server answers and build request
 * bodies with the same shape as the web app (frontend/components/v3-vampire-panel.tsx,
 * hunter-roll-card.tsx, v5-blood-panel.tsx, v5-sanguine-panel.tsx, experience-panel.tsx).
 */

import { BOND_DEGREE_LABELS, V5_INTENSITIES, V5_RESONANCES } from "@/lib/v5-sanguine";
import { COMPULSION_OPTIONS as V5_BLOOD_COMPULSIONS } from "@/lib/v5-blood";

// ---------------------------------------------------------------------------------- shared
export const int = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isSafeInteger(value) ? value : fallback);
export const clampInt = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.trunc(Number.isFinite(value) ? value : min)));

/** Toggle a die for a Willpower reroll: at most `limit` distinct dice. */
export function toggleDie(selected: number[], index: number, limit = 3): number[] {
  if (selected.includes(index)) return selected.filter((item) => item !== index);
  return selected.length >= limit ? selected : [...selected, index].sort((a, b) => a - b);
}

export type TableRole = "owner" | "master" | "player" | "guest" | null | undefined;
export const canNarrate = (role: TableRole): boolean => role === "owner" || role === "master";

export type GameSystem = "vampire-v3" | "vampire-v5" | "hunter" | null;
/** Which table screens a sheet gets: the starter key first, then the old system label. */
export function gameSystem(systemKey: string | null | undefined, values: Record<string, unknown>): GameSystem {
  if (systemKey === "vampire-v3" || systemKey === "vampire-v5" || systemKey === "hunter") return systemKey;
  if (values.sistema === "Vampiro V3" || ("ant_geracao" in values && ("trilha" in values || "forca_vontade" in values))) return "vampire-v3";
  if (values.sistema === "Caçador: A Revanche" || "em_desespero" in values) return "hunter";
  if (values.sistema === "Vampiro V5" || (typeof values.fome === "number" && "potencia_sangue" in values)) return "vampire-v5";
  return null;
}

// ---------------------------------------------------------------------------------- V3
export type V3RollResult = {
  dice: number[]; difficulty: number; successes: number; botch: boolean; success: boolean; verdict?: string;
  penalty: number; rolled: number; pool?: number; willpower_spent: boolean; specialty?: boolean;
};
export type V3Action = "sangue" | "cura" | "dano" | "sangue_inicial" | "frenesi" | "rotschreck" | "degeneracao";
export type V3DamageKind = "contundente" | "letal" | "agravado";

/** Adjustments are applied without dice and may wait offline; tests roll on the server. */
export const V3_QUEUEABLE: ReadonlySet<V3Action> = new Set(["sangue", "cura", "dano"]);

export function v3EffectivePool(pool: number, penalty: number | null): number {
  return penalty === null ? 0 : Math.max(0, pool + penalty);
}

export function v3RollBody(input: { pool: number; difficulty: number; specialty: boolean; willpower: boolean; damageLevels: number; sheetId: string; operationId: string }): Record<string, unknown> {
  if (input.pool < 1 || input.pool > 30) throw new Error("A parada precisa ficar entre 1 e 30 dados.");
  if (input.difficulty < 2 || input.difficulty > 10) throw new Error("A dificuldade vai de 2 a 10.");
  return {
    pool: input.pool, difficulty: input.difficulty, specialty: input.specialty, use_willpower: input.willpower,
    damage_levels: clampInt(input.damageLevels, 0, 7),
    ...(input.willpower ? { sheet_id: input.sheetId, operation_id: input.operationId } : {}),
  };
}

export function v3ActionBody(action: V3Action, options: { amount?: number; kind?: V3DamageKind; difficulty?: number; turn?: string }): Record<string, unknown> {
  const turn = options.turn?.trim();
  if (turn && !/^[A-Za-z0-9:._-]{1,80}$/.test(turn)) throw new Error("Turno: use letras, números e : . _ - (até 80).");
  if (action === "sangue" || action === "cura") return { action, amount: clampInt(options.amount ?? 1, 1, 50), ...(turn ? { turn } : {}) };
  if (action === "dano") return { action, amount: clampInt(options.amount ?? 1, 1, 50), kind: options.kind ?? "letal" };
  if (action === "sangue_inicial") return { action };
  return { action, difficulty: clampInt(options.difficulty ?? 6, 2, 10) };
}

export function v3Verdict(result: Pick<V3RollResult, "botch" | "success" | "verdict">): string {
  return result.verdict ?? (result.botch ? "Falha crítica" : result.success ? "Sucesso" : "Falha");
}

export function describeV3Roll(result: V3RollResult): string {
  return `${v3Verdict(result)} · ${result.successes} sucesso(s) · dificuldade ${result.difficulty} · dados ${result.dice.join(" · ") || "nenhum"}`
    + `${result.penalty ? ` · Vitalidade ${result.penalty}` : ""}${result.specialty ? " · especialização" : ""}${result.willpower_spent ? " · +1 Vontade" : ""}`;
}

export type V3ActionResult = { sheet?: { values?: Record<string, unknown> }; test?: { outcome?: string; roll?: { dice?: number[] } }; replayed?: boolean; applied?: number };
export function describeV3Action(result: V3ActionResult | null | undefined): string {
  const body = result ?? {};
  const sheet = body.sheet?.values ?? {};
  const parts = [
    body.replayed ? "já registrado" : null,
    body.test?.outcome ?? null,
    body.test?.roll?.dice?.length ? `dados ${body.test.roll.dice.join(" · ")}` : null,
    typeof body.applied === "number" ? `${body.applied} nível(is) marcado(s)` : null,
    "pontos_sangue" in sheet ? `sangue ${String(sheet.pontos_sangue)}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Aplicado.";
}

// ---------------------------------------------------------------------------------- Caçador
export type HunterCell = { id: string; name: string; danger: number; desperation: number; version?: number };
export type HunterRedemption = { id: string; drive: string; redemption?: string; note: string; status: string };
export type HunterState = { cell: HunterCell | null; in_despair: boolean; edges_blocked: boolean; pending_redemption: HunterRedemption | null };
export type HunterChoice = "overreach" | "despair";
export type HunterRoll = {
  roll_id: string; normal_dice: number[]; desperation_dice: number[]; desperation_ones: number; successes: number;
  difficulty: number; success: boolean; critical_pairs: number; critical: boolean; desperation_consequence: "despair" | "table_choice" | null;
  resolution: HunterChoice | null; choices: HunterChoice[]; can_reroll: boolean; verdict: string; cell?: HunterCell | null;
};

export const HUNTER_ATTRIBUTES: Array<[string, string]> = [
  ["forca", "Força"], ["destreza", "Destreza"], ["vigor", "Vigor"], ["carisma", "Carisma"], ["manipulacao", "Manipulação"],
  ["autocontrole", "Autocontrole"], ["inteligencia", "Inteligência"], ["raciocinio", "Raciocínio"], ["resolucao", "Determinação"],
];

export const HUNTER_CHOICE_LABEL: Record<HunterChoice, string> = {
  overreach: "Overreach: mantém o sucesso, Perigo da célula +1",
  despair: "Despair: o teste falha e o caçador entra em Desespero",
};

export function hunterRollBody(input: { basePool: number; difficulty: number; useDesperation: boolean; edge: string; despair: boolean }): Record<string, unknown> {
  if (input.basePool < 1 || input.basePool > 30) throw new Error("A reserva precisa ficar entre 1 e 30 dados.");
  if (input.difficulty < 1 || input.difficulty > 69) throw new Error("Dificuldade inválida.");
  // In Despair there are no Desperation dice and Edges are blocked (the server checks again).
  const edge = input.despair ? "" : input.edge.trim().slice(0, 80);
  return { base_pool: input.basePool, difficulty: input.difficulty, use_desperation: input.useDesperation && !input.despair, ...(edge ? { edge } : {}) };
}

export function isHunterRoll(value: unknown): value is HunterRoll {
  if (!value || typeof value !== "object") return false;
  const roll = value as Record<string, unknown>;
  return typeof roll.roll_id === "string" && Array.isArray(roll.normal_dice) && Array.isArray(roll.desperation_dice) && Array.isArray(roll.choices);
}

export function describeHunterRoll(result: HunterRoll): string {
  const resolved = result.resolution ? ` · mesa: ${result.resolution === "overreach" ? "Overreach (Perigo +1)" : "Despair"}` : "";
  return `${result.verdict} · ${result.successes}/${result.difficulty} sucessos · base ${result.normal_dice.join(" · ") || "—"} · Desesperação ${result.desperation_dice.join(" · ") || "não usada"}`
    + `${result.desperation_ones && !resolved ? ` · ${result.desperation_ones} resultado(s) 1, ${result.desperation_consequence === "despair" ? "Despair" : "escolha Despair ou Overreach"}` : ""}`
    + `${result.critical ? " · crítico" : ""}${resolved}`;
}

/** Cell adjustment body (danger/desperation step of ±1, at least one non-zero). */
export function cellAdjustBody(dangerDelta: number, desperationDelta: number, reason?: string): Record<string, unknown> {
  const danger = clampInt(dangerDelta, -5, 5), desperation = clampInt(desperationDelta, -5, 5);
  if (!danger && !desperation) throw new Error("Informe uma mudança de Perigo ou Desesperação.");
  return { danger_delta: danger, desperation_delta: desperation, ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}) };
}

// ---------------------------------------------------------------------------------- V5
export type V5Outcome = { successes: number; success: boolean; critical_pairs?: number; messy_critical: boolean; clean_critical: boolean; bestial_failure: boolean };
export type V5StoredRoll = {
  id: string; pool: number; hunger: number; difficulty: number; normal_dice: number[]; hunger_dice: number[]; outcome: V5Outcome;
  original_normal_dice?: number[] | null; rerolled_indices?: number[] | null; created_at: string; rerolled_at: string | null; recommended_reroll: number[];
};
export type BloodPotency = { potency: number; surge: number; mend: number; power_bonus: number; rouse_reroll_level: number; bane_severity: number; human_slake_penalty?: number; kill_to_reduce_below?: number | null };
export type FrenzyKind = "fury" | "hunger" | "terror";
export type BloodState = {
  potency: BloodPotency; hunger: number; humanity: number; stains: number; remorse_pool: number; remorse_success: number | null;
  willpower_current: number; frenzy_pool: Record<FrenzyKind, number>; rouse_success: number; in_torpor: boolean; torpor_duration: string;
  compulsion: string | null; compulsion_detail: { name: string; effect: string } | null; clan_compulsion: { name: string; effect: string } | null;
};
export type BloodEvent = { id: number; kind: string; dice: number[]; outcome: Record<string, unknown>; created_at?: string };
export type BloodResponse = { replayed: boolean; outcome: Record<string, unknown>; dice: number[]; event_id: number | null; sheet: Record<string, unknown> | null; state: BloodState | null };

/** Same list as backend COMPULSION_OPTIONS (app/services/v5_blood.py), from the shared lib. */
export const COMPULSION_OPTIONS: readonly string[] = V5_BLOOD_COMPULSIONS;
export const FRENZY_LABELS: Record<FrenzyKind, string> = { fury: "Fúria", hunger: "Fome", terror: "Terror (Rötschreck)" };
export const BLOOD_KIND_LABELS: Record<string, string> = { rouse: "Rouse", awaken: "Despertar", remorse: "Remorso", frenzy: "Frenesi", compulsion: "Compulsão", torpor: "Torpor" };
/** Blood actions without dice (sheet adjustments) may wait offline; the others roll on the server. A
 * compulsion is queueable only when chosen (no d10). */
export const BLOOD_QUEUEABLE: ReadonlySet<string> = new Set(["torpor"]);
export const bloodQueueable = (kind: string, body: Record<string, unknown>): boolean =>
  BLOOD_QUEUEABLE.has(kind) || (kind === "compulsion" && typeof body.compulsion === "string" && body.compulsion.length > 0);

export function v5OutcomeLabel(outcome: V5Outcome): string {
  if (outcome.messy_critical) return "Crítico sujo";
  if (outcome.clean_critical) return "Crítico limpo";
  if (outcome.bestial_failure) return "Falha bestial";
  return outcome.success ? "Sucesso" : "Falha";
}

export function describeStoredRoll(roll: V5StoredRoll): string {
  return `${v5OutcomeLabel(roll.outcome)} · ${roll.outcome.successes} sucesso(s) / dif. ${roll.difficulty}${roll.rerolled_at ? " · com Vontade" : ""}`;
}

export function isStoredRoll(value: unknown): value is V5StoredRoll {
  if (!value || typeof value !== "object") return false;
  const roll = value as Record<string, unknown>;
  return typeof roll.id === "string" && Array.isArray(roll.normal_dice) && Array.isArray(roll.hunger_dice) && Boolean(roll.outcome) && typeof roll.outcome === "object";
}

export function describeBloodEvent(event: Pick<BloodEvent, "kind" | "outcome">): string {
  const o = event.outcome;
  switch (event.kind) {
    case "rouse":
    case "awaken":
      return `${o.success ? "sem aumento" : "falhou"} · Fome ${String(o.hunger_before)} → ${String(o.hunger_after)}${o.hunger_frenzy_test ? " · teste de frenesi de fome" : ""}${o.rerolled ? " · rerrolado pela Potência" : ""}`;
    case "remorse":
      return `${o.success ? "manteve" : "perdeu 1"} Humanidade (${String(o.humanity_before)} → ${String(o.humanity_after)}) · Manchas limpas`;
    case "frenzy":
      return `${FRENZY_LABELS[o.kind as FrenzyKind] ?? String(o.kind)}: ${String(o.successes)} sucessos / dif. ${String(o.difficulty)} · ${o.frenzy ? "entra em frenesi" : "resistiu"}`;
    case "compulsion":
      return `${String(o.compulsion)}${o.clan_compulsion ? ` (${String(o.clan_compulsion)})` : ""}${o.rolled ? " · sorteada" : ""}`;
    case "torpor":
      return o.in_torpor ? `entrou em Torpor · duração ${String(o.duration)}` : "saiu do Torpor";
    default:
      return "";
  }
}

export { V5_RESONANCES, V5_INTENSITIES, BOND_DEGREE_LABELS };

export type HuntForm = { prey: string; resonance: string; intensity: string; dyscrasia: string; slake: number; killed: boolean; notes?: string };
/** Same checks as HuntRequest in backend/app/routes/v5_sanguine.py; returns the error or the body. */
export function huntBody(form: HuntForm): { error: string } | { body: Record<string, unknown> } {
  const prey = form.prey.trim();
  if (!prey) return { error: "Informe a presa." };
  if (!(V5_RESONANCES as readonly string[]).includes(form.resonance) || !(V5_INTENSITIES as readonly string[]).includes(form.intensity)) return { error: "Ressonância ou intensidade inválida." };
  if ((form.resonance === "Nenhuma") !== (form.intensity === "Nenhuma")) return { error: "Ressonância e intensidade andam juntas." };
  const dyscrasia = form.dyscrasia.trim();
  if (dyscrasia && form.intensity !== "Aguda") return { error: "Discrasia só com Ressonância aguda." };
  return { body: {
    prey: prey.slice(0, 120), resonance: form.resonance, intensity: form.intensity, dyscrasia: dyscrasia ? dyscrasia.slice(0, 160) : null,
    slake: clampInt(form.slake, 0, 5), killed: form.killed, notes: form.notes?.trim() ? form.notes.trim().slice(0, 500) : null,
  } };
}

export type BloodBond = { id: string; regnant_label?: string; regnant_sheet_id: string | null; regnant_entity_id: string | null; decay_days: number; degree: number; drinks: Array<{ id: string; drank_at: string; notes: string | null }> };
export type RegnantAction = { id: string; bond_id: string; action: string; bond_degree: number; pool: number | null; difficulty: number | null; successes: number | null; passed: boolean | null; status: "pendente" | "permitida" | "negada"; decision_note: string | null; created_at: string };
export type Hunt = { id: string; prey: string; resonance: string; intensity: string; dyscrasia: string | null; hunger_before: number; hunger_after: number; killed: boolean; created_at: string };

export function bondDegreeLabel(degree: number): string {
  return BOND_DEGREE_LABELS[clampInt(degree, 0, 3)] ?? String(degree);
}

// ---------------------------------------------------------------------------------- XP
export type AdvanceStatus = "pending" | "applied" | "rejected" | "refunded";
export type CharacterAdvance = {
  id: string; actor_id: string | null; trait: string; category?: string; item_name: string | null; item_value: string | null;
  from_level: number; to_level: number; cost: number; status: AdvanceStatus; xp_before: number | null; xp_after: number | null;
  reason: string | null; review_note: string | null; created_at: string;
};
export type ServerQuote = {
  category: string; label: string; from_level: number; to_level: number; cost: number;
  xp_available: number | null; sheet_version: number; requires_approval: boolean; needs_book_check?: boolean;
};
export const ADVANCE_STATUS_LABEL: Record<AdvanceStatus, string> = { pending: "Aguardando narrador", applied: "Aplicado", rejected: "Recusado", refunded: "Estornado" };

export type AdvanceRequest = { trait: string; target_level: number; item_name: string | null };
export function advanceRequest(trait: string, target: number, itemName: string, isCollection: boolean): AdvanceRequest {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(trait)) throw new Error("Escolha um traço.");
  if (!Number.isInteger(target) || target < 1 || target > 20) throw new Error("Nível desejado inválido.");
  const name = itemName.trim();
  if (isCollection && !name) throw new Error("Informe o nome do item.");
  return { trait, target_level: target, item_name: isCollection ? name.slice(0, 120) : null };
}

export function purchaseBody(request: AdvanceRequest, expectedVersion: number, operationId: string, reason: string): Record<string, unknown> {
  return { ...request, expected_version: expectedVersion, operation_id: operationId, reason: reason.trim() ? reason.trim().slice(0, 200) : null };
}

export function describeAdvance(advance: CharacterAdvance, label: string): string {
  return advance.item_value ? `${label}: ${advance.item_value}` : `${label} ${advance.from_level} → ${advance.to_level}`;
}

export const XP_FIELD = "experiencia";
type FieldLike = { id: string; label: string; kind: string; max?: number | null };
/** Traits a sheet may raise with XP: number and collection fields with a cost table on the server. */
export function advanceTraitOptions(fields: FieldLike[], allowed?: ReadonlySet<string> | null): Array<{ id: string; label: string; collection: boolean; max: number }> {
  return fields
    .filter((field) => (field.kind === "number" || field.kind === "collection") && field.id !== XP_FIELD && (!allowed || allowed.has(field.id)))
    .map((field) => ({ id: field.id, label: field.label, collection: field.kind === "collection", max: Math.min(10, typeof field.max === "number" && field.max > 0 ? field.max : field.kind === "collection" ? 5 : 10) }));
}

export function canAffordQuote(quote: ServerQuote): boolean {
  return (quote.xp_available ?? 0) >= quote.cost;
}

/** Narrator/player actions on one history row. */
export function advanceActions(advance: CharacterAdvance, viewerId: string | null | undefined, narrator: boolean): Array<"approve" | "reject" | "cancel" | "refund"> {
  if (advance.status === "pending") return narrator ? ["approve", "reject"] : advance.actor_id && advance.actor_id === viewerId ? ["cancel"] : [];
  if (advance.status === "applied" && narrator) return ["refund"];
  return [];
}
