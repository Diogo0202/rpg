import { V3_ABILITY_GROUPS, V3_ATTRIBUTE_GROUPS, V3_BLOOD_BY_GENERATION, V3_DISCIPLINES, V3_HEALTH_LEVELS, V3_PATHS } from "./v3-creation-data.ts";
import type { FieldValue } from "./sheet-template.ts";

/**
 * Vampiro V3 (Revisado) play rules, mirroring backend/app/services/v3_vampire.py (the API rolls; this
 * module only reads a sheet and explains a result). Numbers are marked for checking in the book.
 * The mobile app needs the same file in mobile/src/lib/v3-rules.ts.
 */

type Values = Record<string, FieldValue>;

const numberOf = (values: Values, id: string) => {
  const value = values[id];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

/** A V3 sheet: the starter's system label, or the Generation background with a Path field. */
export function isV3Sheet(values: Values): boolean {
  return values.sistema === "Vampiro V3" || ("ant_geracao" in values && ("trilha" in values || "forca_vontade" in values));
}

export type V3Outcome = { successes: number; botch: boolean; success: boolean; raw: number; ones: number };

/** Same reading as v3_outcome in the API: 1s cancel, botch without any success, specialty 10 twice, Willpower +1. */
export function v3Outcome(dice: number[], difficulty: number, specialty = false, willpower = false): V3Outcome {
  const raw = dice.reduce((sum, die) => sum + (die >= difficulty ? (specialty && die === 10 ? 2 : 1) : 0), 0);
  const ones = dice.filter((die) => die === 1).length;
  const botch = raw === 0 && ones > 0 && !willpower;
  const successes = Math.max(0, raw - ones) + (willpower ? 1 : 0);
  return { successes, botch, success: successes > 0, raw, ones };
}

/** Penalty for the marked health levels; null when Incapacitado. */
export function v3HealthPenalty(marked: number): number | null {
  if (marked <= 0) return 0;
  return V3_HEALTH_LEVELS[Math.min(marked, 7) - 1]!.penalty;
}

export function v3Derived(values: Values) {
  const background = Math.max(0, Math.min(5, numberOf(values, "ant_geracao")));
  const generation = 13 - background;
  const blood = V3_BLOOD_BY_GENERATION[generation] ?? V3_BLOOD_BY_GENERATION[13]!;
  const marked = Math.min(7, numberOf(values, "dano_contundente") + numberOf(values, "dano_letal") + numberOf(values, "dano_agravado"));
  const path = V3_PATHS.find((item) => item.name === values.trilha) ?? V3_PATHS[0]!;
  return {
    generation, bloodMax: blood.max, perTurn: blood.perTurn, blood: numberOf(values, "pontos_sangue"),
    marked, level: marked ? V3_HEALTH_LEVELS[marked - 1]!.label : "Sem ferimentos", penalty: v3HealthPenalty(marked),
    willpower: numberOf(values, "forca_vontade"), willpowerSpent: numberOf(values, "vontade_gasta"),
    path: path.name, conscience: path.virtues[0], selfControl: path.virtues[1],
  };
}

export type V3Trait = { id: string; label: string; value: number };

/** Traits that build a pool: attributes, abilities, disciplines and the Path's virtues. */
export function v3Traits(values: Values): { attributes: V3Trait[]; abilities: V3Trait[] } {
  const derived = v3Derived(values);
  const pick = (list: Array<[string, string]>) => list.map(([id, label]) => ({ id, label, value: numberOf(values, id) }));
  const virtues: Array<[string, string]> = [
    [derived.conscience, derived.conscience === "conviccao" ? "Convicção" : "Consciência"],
    [derived.selfControl, derived.selfControl === "instintos" ? "Instintos" : "Autocontrole"],
    ["coragem", "Coragem"],
  ];
  return {
    attributes: [...pick(V3_ATTRIBUTE_GROUPS.flatMap((group) => group.fields)), ...pick(virtues)],
    abilities: [...pick(V3_ABILITY_GROUPS.flatMap((group) => group.fields)), ...pick(V3_DISCIPLINES)].filter((trait) => trait.value > 0),
  };
}
