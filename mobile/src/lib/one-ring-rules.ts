import type { CreationRule, FieldValue, GrantCase, MetaCurrency, SheetField } from "./sheet-template.ts";

/**
 * O Um Anel 2ª edição, ficha v2 (mirrors backend/app/services/one_ring.py).
 * Names and numbers only, no book text. Every number is marked for review against the
 * Core Rules (docs/UM_ANEL_FICHA.md): culture bases, TN = 20 - attribute, attributes
 * summing 14, at most three favoured skills and the field limits.
 *
 * States: Cansado when current Endurance <= Load + Fatigue; Miserável when Shadow + Scars
 * >= current Hope; Ferido is a flag with its days; Surto when Shadow + Scars reach max Hope.
 */
export const ONE_RING_ATTRIBUTES: Array<[string, string]> = [["corpo", "Corpo"], ["coracao", "Coração"], ["astucia", "Astúcia"]];
export const ONE_RING_ATTRIBUTE_TOTAL = 14;
export const ONE_RING_TN_BASE = 20;
export const ONE_RING_SKILL_GROUPS: Array<{ attribute: string; skills: Array<[string, string]> }> = [
  { attribute: "corpo", skills: [["awe", "Presença"], ["athletics", "Atletismo"], ["awareness", "Percepção"], ["hunting", "Caçada"], ["song", "Canção"], ["craft", "Ofício"]] },
  { attribute: "coracao", skills: [["enhearten", "Encorajar"], ["travel", "Viagem"], ["insight", "Intuição"], ["healing", "Cura"], ["courtesy", "Cortesia"], ["battle", "Batalha"]] },
  { attribute: "astucia", skills: [["persuade", "Persuasão"], ["stealth", "Furtividade"], ["scan", "Busca"], ["explore", "Exploração"], ["riddle", "Enigmas"], ["lore", "Conhecimento"]] },
];
export const ONE_RING_SKILLS = ONE_RING_SKILL_GROUPS.flatMap((group) => group.skills);
export const ONE_RING_PROFICIENCIES: Array<[string, string]> = [["machados", "Machados"], ["arcos", "Arcos"], ["lancas", "Lanças"], ["espadas", "Espadas"]];
export const ONE_RING_FAVOURED_SKILLS = 3;
/** Culture -> [Endurance base, Hope base, Parry base]. Marked for review. */
export const ONE_RING_CULTURES: Record<string, [number, number, number]> = {
  "Anões do Povo de Durin": [22, 8, 10],
  "Bardeses": [20, 8, 12],
  "Elfos de Lindon": [20, 8, 12],
  "Hobbits do Condado": [18, 10, 12],
  "Homens de Bri": [20, 10, 10],
  "Patrulheiros do Norte": [20, 6, 14],
};
export const ONE_RING_CALLINGS = ["Capitão", "Campeão", "Mensageiro", "Erudito", "Caçador de Tesouros", "Guardião"];
export const ONE_RING_LIVING = ["Pobre", "Frugal", "Comum", "Próspero", "Rico", "Muito rico"];
const BASE_FIELDS = ["base_vigor", "base_esperanca", "base_aparar"] as const;
/** v1 starter ids -> v2 ids. */
export const ONE_RING_LEGACY_IDS: Record<string, string> = { forca: "corpo", espirito: "astucia" };

type Seed = SheetField & { initial?: FieldValue };
const base = (id: string, label: string, kind: SheetField["kind"], extra: Partial<Seed> = {}): Seed =>
  ({ id, label, kind, required: false, options: [], expression: null, ...extra });
const num = (id: string, label: string, min: number, max: number, initial = min, extra: Partial<Seed> = {}) =>
  base(id, label, "number", { min, max, initial, ...extra });
const formula = (id: string, label: string, expression: string) => base(id, label, "formula", { expression });
const list = (id: string, label: string, max_items: number, max_length: number, extra: Partial<Seed> = {}) =>
  base(id, label, "collection", { initial: [], max_items, max_length, ...extra });
const text = (id: string, label: string, max_length?: number, extra: Partial<Seed> = {}) =>
  base(id, label, "text", { initial: "", ...(max_length ? { max_length } : {}), ...extra });

/** Field seeds in sheet order (the starter adds Sistema, Ativo na sessão and Experiência). */
export const ONE_RING_SEEDS: Seed[] = [
  text("nome", "Nome", undefined, { required: true }), text("conceito", "Conceito", 160),
  base("linhagem", "Cultura", "select", { options: Object.keys(ONE_RING_CULTURES), required: true, initial: "" }),
  base("vocacao", "Vocação", "select", { options: ONE_RING_CALLINGS, initial: "" }),
  ...ONE_RING_ATTRIBUTES.map(([id, label]) => num(id, label, 2, 7, 2, { required: true })),
  ...ONE_RING_ATTRIBUTES.map(([id, label]) => formula(`tn_${id}`, `TN de ${label}`, `${ONE_RING_TN_BASE} - ${id}`)),
  ...ONE_RING_SKILLS.map(([id, label]) => num(id, label, 0, 6)),
  list("pericias_favorecidas", "Perícias favorecidas", ONE_RING_FAVOURED_SKILLS, 40, { item_options: ONE_RING_SKILLS.map(([, label]) => label) }),
  ...ONE_RING_PROFICIENCIES.map(([id, label]) => num(id, label, 0, 6)),
  num("valor", "Valor", 1, 6), num("sabedoria", "Sabedoria", 1, 6),
  list("virtudes", "Virtudes", 12, 120), list("recompensas", "Recompensas", 12, 120),
  list("tracos_distintivos", "Traços distintivos", 4, 80), list("defeitos_sombra", "Defeitos da Sombra", 4, 80),
  text("caminho_sombra", "Caminho da Sombra", 120),
  num("base_vigor", "Base de Vigor da cultura", 0, 30, 0), num("base_esperanca", "Base de Esperança da cultura", 0, 20, 0),
  num("base_aparar", "Base de Aparar da cultura", 0, 20, 0),
  formula("vigor_max", "Vigor máximo", "corpo + base_vigor"), num("vigor_marcha", "Vigor atual", 0, 40, 0),
  formula("esperanca_max", "Esperança máxima", "coracao + base_esperanca"), num("esperanca", "Esperança atual", 0, 40, 0),
  num("bonus_escudo", "Bônus de escudo", 0, 6, 0), formula("aparar", "Aparar", "astucia + base_aparar + bonus_escudo"),
  num("armadura", "Armadura (dados de proteção)", 0, 6, 0),
  num("carga", "Carga", 0, 60, 0), num("cansaco", "Cansaço", 0, 20, 0), formula("carga_total", "Carga com Cansaço", "carga + cansaco"),
  num("sombra", "Pontos de Sombra", 0, 40, 0), num("cicatrizes", "Cicatrizes de Sombra", 0, 20, 0),
  formula("sombra_total", "Sombra total", "sombra + cicatrizes"),
  base("ferido", "Ferido", "checkbox", { initial: false }), num("ferimento_dias", "Dias de ferimento", 0, 30, 0),
  num("pontos_aventura", "Pontos de aventura", 0, 999, 0), num("pontos_habilidade", "Pontos de perícia", 0, 999, 0),
  num("tesouro", "Tesouro", 0, 9999, 0), base("padrao_vida", "Padrão de vida", "select", { options: ONE_RING_LIVING, initial: "" }),
  list("equipamento", "Equipamento", 40, 120), text("ambicao", "Ambição", 240), text("desejo", "Desejo", 240), text("notas", "Notas"),
];

export const ONE_RING_META_CURRENCIES: MetaCurrency[] = [{ id: "esperanca", label: "Esperança", field: "esperanca", mode: "pool", max_field: "esperanca_max" }];

export const ONE_RING_CULTURE_CASES: GrantCase[] = Object.entries(ONE_RING_CULTURES).map(([equals, numbers]) =>
  ({ equals, add: Object.fromEntries(BASE_FIELDS.map((id, index) => [id, numbers[index]])) }));

export const ONE_RING_CREATION_RULES: CreationRule[] = [
  { type: "group_sum", id: "atributos", label: "Corpo, Coração e Astúcia", fields: ONE_RING_ATTRIBUTES.map(([id]) => id), min: ONE_RING_ATTRIBUTE_TOTAL, max: ONE_RING_ATTRIBUTE_TOTAL },
  { type: "select_grants", id: "cultura", label: "Cultura", field: "linhagem", fields: [...BASE_FIELDS], cases: ONE_RING_CULTURE_CASES },
];

export const ONE_RING_STEPS = {
  identity: ["nome", "conceito", "linhagem", "vocacao"],
  attributes: [...ONE_RING_ATTRIBUTES.map(([id]) => id), ...ONE_RING_ATTRIBUTES.map(([id]) => `tn_${id}`)],
  skills: [...ONE_RING_SKILLS.map(([id]) => id), "pericias_favorecidas", ...ONE_RING_PROFICIENCIES.map(([id]) => id)],
  traits: ["valor", "sabedoria", "virtudes", "recompensas", "tracos_distintivos", "defeitos_sombra", "caminho_sombra"],
  resources: ["base_vigor", "base_esperanca", "base_aparar", "vigor_max", "vigor_marcha", "esperanca_max", "esperanca", "bonus_escudo", "aparar", "armadura",
    "carga", "cansaco", "carga_total", "sombra", "cicatrizes", "sombra_total", "ferido", "ferimento_dias", "pontos_aventura", "pontos_habilidade", "tesouro", "padrao_vida", "equipamento", "experiencia"],
  story: ["ambicao", "desejo", "notas"],
};

const int = (values: Record<string, FieldValue>, id: string) => {
  const value = values[id];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
};

export type OneRingDerived = Record<"tn_corpo" | "tn_coracao" | "tn_astucia" | "vigor_max" | "esperanca_max" | "aparar" | "carga_total" | "sombra_total", number>;
export function oneRingDerived(values: Record<string, FieldValue>): OneRingDerived {
  return {
    tn_corpo: ONE_RING_TN_BASE - int(values, "corpo"),
    tn_coracao: ONE_RING_TN_BASE - int(values, "coracao"),
    tn_astucia: ONE_RING_TN_BASE - int(values, "astucia"),
    vigor_max: int(values, "corpo") + int(values, "base_vigor"),
    esperanca_max: int(values, "coracao") + int(values, "base_esperanca"),
    aparar: int(values, "astucia") + int(values, "base_aparar") + int(values, "bonus_escudo"),
    carga_total: int(values, "carga") + int(values, "cansaco"),
    sombra_total: int(values, "sombra") + int(values, "cicatrizes"),
  };
}

export type OneRingStates = { cansado: boolean; miseravel: boolean; ferido: boolean; surto: boolean; inconsciente: boolean };
export function oneRingStates(values: Record<string, FieldValue>): OneRingStates {
  const numbers = oneRingDerived(values);
  const endurance = int(values, "vigor_marcha");
  return {
    cansado: endurance <= numbers.carga_total,
    miseravel: numbers.sombra_total >= int(values, "esperanca"),
    ferido: values.ferido === true,
    surto: numbers.esperanca_max > 0 && numbers.sombra_total >= numbers.esperanca_max,
    inconsciente: "vigor_marcha" in values && endurance === 0,
  };
}

export function oneRingProblems(values: Record<string, FieldValue>): string[] {
  const numbers = oneRingDerived(values);
  const found: string[] = [];
  const total = ONE_RING_ATTRIBUTES.reduce((sum, [id]) => sum + int(values, id), 0);
  if (total !== ONE_RING_ATTRIBUTE_TOTAL) found.push(`Corpo, Coração e Astúcia somam ${total}; a criação pede ${ONE_RING_ATTRIBUTE_TOTAL}`);
  const culture = values.linhagem;
  if (typeof culture === "string" && ONE_RING_CULTURES[culture]) {
    BASE_FIELDS.forEach((id, index) => {
      const expected = ONE_RING_CULTURES[culture][index];
      if (int(values, id) !== expected) found.push(`${id} deve ser ${expected} para ${culture}`);
    });
  }
  if (int(values, "vigor_marcha") > numbers.vigor_max) found.push(`Vigor atual passa do máximo ${numbers.vigor_max}`);
  if (int(values, "esperanca") > numbers.esperanca_max) found.push(`Esperança atual passa do máximo ${numbers.esperanca_max}`);
  const favoured = values.pericias_favorecidas;
  if (Array.isArray(favoured)) {
    if (favoured.length > ONE_RING_FAVOURED_SKILLS) found.push(`Até ${ONE_RING_FAVOURED_SKILLS} perícias favorecidas`);
    const labels = ONE_RING_SKILLS.map(([, label]) => label);
    const unknown = favoured.find((item) => !labels.includes(item));
    if (unknown !== undefined) found.push(`Perícia favorecida desconhecida: ${unknown}`);
  }
  if (values.ferido !== true && int(values, "ferimento_dias") > 0) found.push("Dias de ferimento sem a marca Ferido");
  return found;
}

/** v1 values (Força/Espírito, six skills) to the v2 ids; same output as the backend. */
export function migrateOneRing(values: Record<string, FieldValue>): { values: Record<string, FieldValue>; warnings: string[] } {
  const result: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(values)) result[ONE_RING_LEGACY_IDS[key] ?? key] = value;
  const warnings = Object.entries(ONE_RING_LEGACY_IDS).filter(([old]) => old in values).map(([old, next]) => `${old} passou a ${next}`);
  const culture = result.linhagem;
  if (typeof culture === "string" && ONE_RING_CULTURES[culture]) BASE_FIELDS.forEach((id, index) => { result[id] = ONE_RING_CULTURES[culture][index]; });
  else warnings.push("Escolha a cultura para calcular Vigor, Esperança e Aparar");
  return { values: result, warnings };
}
