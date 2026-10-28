// V5-07 + INV-06 + DRA-05: regras puras do painel de ações V5 (rolagem guardada,
// ataque calculado no servidor, atividade da crônica e dano aplicado no alvo).
// Sem rede e sem React, para testar no domínio.

import { buildChronicleContext, type ChronicleContext } from "./chronicle-context.ts";

export type DamageKind = "superficial" | "aggravated";

export type AttackResult = {
  weapon: { id: string; name: string; damage_bonus: number; damage_type: DamageKind } | null;
  margin: number;
  weapon_bonus: number;
  damage: number;
  damage_type: DamageKind;
  sources: { label: string; value: number }[];
};

export type ModifierPreview = {
  base_pool: number;
  total_delta: number;
  adjusted_pool: number;
  applied: { id: string; label: string; delta: number; source_note: string | null }[];
  skipped: { id: string; reason: string }[];
  clipped: boolean;
};

export type DamageResult = {
  sheet: { id: string; name: string; version: number; values: Record<string, unknown>; effects: unknown[] } & Record<string, unknown>;
  replayed: boolean;
  superficial?: number;
  aggravated?: number;
  maximum?: number;
  absorbed_by_armor?: number;
  /** F1: Superficial points a V5 vampire halved away (physical damage to Health). */
  halved?: number;
  armor?: { id: string; name: string; protection: number } | null;
  converted?: number;
  overflow?: number;
  impaired?: boolean;
  incapacitated?: boolean;
};

const DAMAGE_EFFECT_TRACKS: Record<string, "health" | "willpower"> = {
  __damage_health_full: "health",
  __damage_willpower_full: "willpower",
};

/** Contexto da crônica de uma rolagem do painel: atributo + habilidade, chave única. */
export function actionChronicle(input: {
  sheetId: string;
  campaignId: string;
  attributeId?: string | null;
  skillId?: string | null;
  rollKey: string;
}): ChronicleContext | undefined {
  return buildChronicleContext({
    sheetId: input.sheetId,
    campaignId: input.campaignId,
    traitIds: [input.attributeId, input.skillId],
    rollKey: input.rollKey,
  });
}

/** Penalidades de trilha cheia que o servidor aplicou, lidas da prévia guardada. */
export function damagePenaltiesFrom(preview: ModifierPreview | null | undefined): ("health" | "willpower")[] {
  if (!preview) return [];
  const tracks = preview.applied.map((effect) => DAMAGE_EFFECT_TRACKS[effect.id]).filter(Boolean);
  return [...new Set(tracks)];
}

/** Lê a prévia de modificadores guardada nos detalhes da rolagem, se tiver o formato esperado. */
export function storedModifierPreview(details: unknown): ModifierPreview | null {
  if (!details || typeof details !== "object") return null;
  const preview = (details as { modifier_preview?: unknown }).modifier_preview;
  if (!preview || typeof preview !== "object") return null;
  const value = preview as Partial<ModifierPreview>;
  if (typeof value.total_delta !== "number" || typeof value.adjusted_pool !== "number"
    || !Array.isArray(value.applied) || !Array.isArray(value.skipped)) return null;
  return value as ModifierPreview;
}

/** Dano do ataque nos dois tipos que a RPC apply_v5_damage recebe. */
export function attackDamageSplit(attack: AttackResult | null | undefined): { superficial: number; aggravated: number } | null {
  if (!attack || !Number.isInteger(attack.damage) || attack.damage <= 0) return null;
  const damage = Math.min(30, attack.damage);
  return attack.damage_type === "aggravated" ? { superficial: 0, aggravated: damage } : { superficial: damage, aggravated: 0 };
}

/** Só o narrador (dono/mestre) aplica dano de ataque, e só com dano positivo e alvo escolhido. */
export function canApplyAttackDamage(input: { canNarrate: boolean; attack: AttackResult | null | undefined; targetId: string | null | undefined }): boolean {
  return input.canNarrate && Boolean(input.targetId) && attackDamageSplit(input.attack) !== null;
}

/** Uma chave por ataque e alvo: repetir o clique reaproveita o mesmo operation_id. */
export function attackOperationKey(rollId: string, targetId: string): string {
  return `${rollId}:${targetId}`;
}

export function describeDamageResult(result: DamageResult, targetName?: string): string {
  if (result.replayed) return `${targetName ? `${targetName}: ` : ""}este dano já tinha sido aplicado; nada mudou.`;
  const parts = [`${targetName ? `${targetName} · ` : ""}Trilha: ${result.superficial ?? 0} superficial e ${result.aggravated ?? 0} agravado de ${result.maximum ?? 0}.`];
  if (result.absorbed_by_armor) parts.push(`${result.armor?.name ?? "Armadura"} absorveu ${result.absorbed_by_armor}.`);
  if (result.halved) parts.push(`Vampiro reduziu ${result.halved} superficial à metade.`);
  if (result.converted) parts.push(`${result.converted} superficial convertido em agravado.`);
  if (result.overflow) parts.push(`${result.overflow} ponto(s) além da trilha.`);
  if (result.incapacitated) parts.push("Trilha toda agravada.");
  else if (result.impaired) parts.push("Trilha cheia: penalidade de −2.");
  return parts.join(" ");
}

/**
 * F1: junta o histórico desta sessão do navegador com o histórico remoto
 * (GET /api/v1/v5/sheets/{id}/rolls). A versão da sessão vence quando a mesma
 * rolagem aparece nos dois; o resto segue do mais novo para o mais antigo.
 */
export function mergeRollHistory<T extends { roll: { id: string; created_at: string } }>(session: readonly T[], remote: readonly T[], limit = 20): T[] {
  const seen = new Set(session.map((entry) => entry.roll.id));
  const extra = remote.filter((entry) => !seen.has(entry.roll.id));
  return [...session, ...extra]
    .sort((a, b) => b.roll.created_at.localeCompare(a.roll.created_at))
    .slice(0, limit);
}

/** Argumentos da RPC apply_v5_damage com o alvo e a marca de dano físico (vampiro reduz à metade). */
export function damageRpcArgs(input: {
  sheetId: string; track: "health" | "willpower"; superficial: number; aggravated: number;
  armor: boolean; operationId: string; reason?: string | null; physical: boolean;
}) {
  return {
    p_sheet_id: input.sheetId,
    p_track: input.track,
    p_superficial: input.superficial,
    p_aggravated: input.aggravated,
    p_apply_armor: input.track === "health" && input.armor,
    p_operation_id: input.operationId,
    p_reason: input.reason ? input.reason.slice(0, 120) : null,
    p_halve_superficial: input.track === "health" && input.physical,
  };
}

/** Seleção de até três dados comuns para a rerrolagem de Vontade. */
export function toggleRerollIndex(selected: readonly number[], index: number): number[] {
  if (selected.includes(index)) return selected.filter((item) => item !== index);
  return selected.length < 3 ? [...selected, index] : [...selected];
}
