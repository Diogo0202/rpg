/**
 * EXP-02: custos de XP por sistema. Espelho exato das tabelas
 * experience_cost_rules e experience_trait_categories da migration
 * supabase/migrations/20261029140000_experience_advances.sql — o banco
 * recalcula o custo em purchase_advance e este arquivo só serve para a prévia.
 * tests/experience-math.test.mjs compara as duas listas.
 *
 * TODOS os números estão marcados para conferência no livro.
 */

export type ExperienceSystem = "vampire-v5" | "vampire-v3" | "hunter";
export type CostBasis = "new" | "current" | "flat" | "level" | "per_dot";
export type AdvanceCategory =
  | "attribute" | "skill" | "specialty" | "clan_discipline" | "out_of_clan_discipline" | "caitiff_discipline"
  | "ritual" | "formula" | "advantage" | "blood_potency" | "virtue" | "humanity" | "willpower" | "edge" | "perk";
export type CostRule = { basis: CostBasis; multiplier: number; newCost: number | null; label: string };

const rule = (basis: CostBasis, multiplier: number, label: string, newCost: number | null = null): CostRule => ({ basis, multiplier, newCost, label });

export const EXPERIENCE_COST_TABLES: Record<ExperienceSystem, Partial<Record<AdvanceCategory, CostRule>>> = {
  // Vampiro: A Máscara 5ª edição — conferir.
  "vampire-v5": {
    attribute: rule("new", 5, "Atributo"),
    skill: rule("new", 3, "Habilidade"),
    specialty: rule("flat", 3, "Especialização"),
    clan_discipline: rule("new", 5, "Disciplina de clã"),
    out_of_clan_discipline: rule("new", 7, "Disciplina externa"),
    caitiff_discipline: rule("new", 6, "Disciplina de Caitiff"),
    ritual: rule("level", 3, "Ritual de Feitiçaria do Sangue"),
    formula: rule("level", 3, "Fórmula de Alquimia do Sangue-Ralo"),
    advantage: rule("per_dot", 3, "Vantagem"),
    blood_potency: rule("new", 10, "Potência de Sangue"),
  },
  // Vampiro: A Máscara 3ª edição revisada — conferir (Caitiff ×6 vem do V20).
  "vampire-v3": {
    attribute: rule("current", 4, "Atributo"),
    skill: rule("current", 2, "Habilidade", 3),
    clan_discipline: rule("current", 5, "Disciplina de clã", 10),
    out_of_clan_discipline: rule("current", 7, "Disciplina externa", 10),
    caitiff_discipline: rule("current", 6, "Disciplina de Caitiff", 10),
    virtue: rule("current", 2, "Virtude"),
    humanity: rule("current", 2, "Humanidade / Trilha"),
    willpower: rule("current", 1, "Força de Vontade"),
  },
  // Caçador: A Revanche 5ª edição — conferir.
  hunter: {
    attribute: rule("new", 5, "Atributo"),
    skill: rule("new", 3, "Habilidade"),
    specialty: rule("flat", 3, "Especialização"),
    edge: rule("flat", 7, "Edge"),
    perk: rule("flat", 3, "Perk"),
    advantage: rule("per_dot", 3, "Vantagem"),
  },
};

const V5_ATTRIBUTES = ["forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole", "inteligencia", "raciocinio", "resolucao"];
const V5_SKILLS = ["atletismo", "briga", "conducao", "furtividade", "ladroagem", "oficios", "sobrevivencia", "armas_brancas", "armas_de_fogo",
  "etiqueta", "empatia", "intimidacao", "lideranca", "manha", "performance", "persuasao", "subterfugio", "trato_com_animais",
  "academicos", "ciencia", "consciencia", "financas", "investigacao", "medicina", "ocultismo", "percepcao", "tecnologia"];
const V5_DISCIPLINES = ["disc_animalismo", "disc_auspicios", "disc_dominacao", "disc_fortitude", "disc_ofuscacao", "disc_potencia", "disc_presenca",
  "disc_metamorfose", "disc_rapidez", "disc_feiticaria", "disc_oblivio", "disc_alquimia"];
const V3_ATTRIBUTES = ["forca", "destreza", "vigor", "carisma", "manipulacao", "aparencia", "percepcao", "inteligencia", "raciocinio"];
const V3_SKILLS = ["prontidao", "esportes", "briga", "esquiva", "empatia", "expressao", "intimidacao", "lideranca", "manha", "labia",
  "empatia_animais", "oficios", "conducao", "etiqueta", "armas_de_fogo", "armas_brancas", "performance", "seguranca", "furtividade", "sobrevivencia",
  "academicos", "computador", "financas", "investigacao", "direito", "linguistica", "medicina", "ocultismo", "politica", "ciencia"];
const V3_DISCIPLINES = ["disc_animalismo", "disc_auspicios", "disc_rapidez", "disc_quimerismo", "disc_dementacao", "disc_dominacao", "disc_fortitude",
  "disc_necromancia", "disc_ofuscacao", "disc_obtenebracao", "disc_potencia", "disc_presenca", "disc_metamorfose", "disc_quietus",
  "disc_serpentis", "disc_taumaturgia", "disc_vicissitude"];
const HUNTER_SKILLS = ["armas_brancas", "armas_de_fogo", "atletismo", "briga", "ciencia", "conducao", "trato_com_animais", "academicos", "etiqueta",
  "financas", "furtividade", "intimidacao", "investigacao", "ladroagem", "lideranca", "manha", "medicina", "ocultismo", "oficios",
  "percepcao", "performance", "persuasao", "politica", "empatia", "sobrevivencia", "subterfugio", "tecnologia"];

/** "discipline" é resolvida pelo clã da ficha em clan / out_of_clan / caitiff. */
export type TraitCategory = AdvanceCategory | "discipline";
const tag = (ids: string[], category: TraitCategory) => Object.fromEntries(ids.map((id) => [id, category])) as Record<string, TraitCategory>;

export const EXPERIENCE_TRAIT_CATEGORIES: Record<ExperienceSystem, Record<string, TraitCategory>> = {
  "vampire-v5": {
    ...tag(V5_ATTRIBUTES, "attribute"), ...tag(V5_SKILLS, "skill"), ...tag(V5_DISCIPLINES, "discipline"),
    potencia_sangue: "blood_potency", especialidades: "specialty", rituais: "ritual", formulas: "formula", vantagens: "advantage",
  },
  "vampire-v3": {
    ...tag(V3_ATTRIBUTES, "attribute"), ...tag(V3_SKILLS, "skill"), ...tag(V3_DISCIPLINES, "discipline"),
    consciencia: "virtue", autocontrole: "virtue", coragem: "virtue", conviccao: "virtue", instintos: "virtue",
    humanidade: "humanity", trilha_nivel: "humanity", forca_vontade: "willpower",
  },
  hunter: {
    ...tag(V5_ATTRIBUTES, "attribute"), ...tag(HUNTER_SKILLS, "skill"),
    especialidades: "specialty", vantagens: "advantage", triunfos: "edge", distincoes: "perk",
  },
};

export function isExperienceSystem(value: unknown): value is ExperienceSystem {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EXPERIENCE_COST_TABLES, value);
}

/** Mesmo cálculo de private.advance_cost no banco. */
export function advanceCost(costRule: CostRule, from: number, to: number): number {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 1 || to > 20) throw new RangeError("Níveis inválidos.");
  if (costRule.basis === "flat") return costRule.multiplier;
  if (costRule.basis === "level") return to * costRule.multiplier;
  if (to <= from) throw new RangeError("O nível desejado deve superar o nível atual.");
  if (costRule.basis === "per_dot") return (to - from) * costRule.multiplier;
  let total = 0;
  for (let rank = from + 1; rank <= to; rank += 1) {
    if (costRule.basis === "new") total += rank * costRule.multiplier;
    else total += rank === 1 ? costRule.newCost ?? costRule.multiplier : (rank - 1) * costRule.multiplier;
  }
  return total;
}

type TemplateLike = { system_key?: string | null; fields?: Array<{ id: string; kind: string; max?: number | null }>; creation_rules?: unknown[] | null };

function clanDisciplines(template: TemplateLike, clan: string): string[] {
  const out: string[] = [];
  for (const raw of template.creation_rules ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (entry.type === "select_grants" && entry.field === "cla" && Array.isArray(entry.cases)) {
      for (const item of entry.cases as Array<Record<string, unknown>>) {
        if (item?.equals === clan && item.add && typeof item.add === "object") out.push(...Object.keys(item.add as object));
      }
    }
    if (entry.type === "priority_points" && Array.isArray(entry.pools)) {
      for (const pool of entry.pools as Array<Record<string, unknown>>) {
        const allowed = pool?.allowed as { field?: string; cases?: Record<string, unknown> } | undefined;
        const list = allowed?.field === "cla" ? allowed.cases?.[clan] : undefined;
        if (Array.isArray(list)) out.push(...list.filter((id): id is string => typeof id === "string"));
      }
    }
  }
  return out;
}

/** Categoria final de um traço nesta ficha, ou null se não se compra com XP. */
export function resolveAdvanceCategory(template: TemplateLike, values: Record<string, unknown>, trait: string): AdvanceCategory | null {
  const system = template.system_key;
  if (!isExperienceSystem(system)) return null;
  const category = EXPERIENCE_TRAIT_CATEGORIES[system][trait];
  if (!category || !template.fields?.some((field) => field.id === trait)) return null;
  if (category !== "discipline") return EXPERIENCE_COST_TABLES[system][category] ? category : null;
  const clan = typeof values.cla === "string" ? values.cla : "";
  if (clan === "Caitiff") return "caitiff_discipline";
  return clan && clanDisciplines(template, clan).includes(trait) ? "clan_discipline" : "out_of_clan_discipline";
}

/** Pontos de um item de coleção "Nome ••" ou "Nome 2". */
export function itemDots(item: string): number {
  const match = /(•+|\d+)$/u.exec(item.trim());
  if (!match) return 0;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : [...match[1]].length;
}
export function itemBase(item: string): string {
  return item.replace(/\s*(•+|\d+)$/u, "").trim();
}

export type AdvanceQuote = { category: AdvanceCategory; label: string; basis: CostBasis; from: number; to: number; cost: number; collection: boolean };

/** Prévia local do custo; o servidor confirma com quote_advance / purchase_advance. */
export function quoteAdvance(
  template: TemplateLike, values: Record<string, unknown>, trait: string, target: number, itemName = "",
): AdvanceQuote {
  const category = resolveAdvanceCategory(template, values, trait);
  if (!category || !isExperienceSystem(template.system_key)) throw new RangeError("Este traço não se compra com XP neste sistema.");
  const costRule = EXPERIENCE_COST_TABLES[template.system_key][category] as CostRule;
  const field = template.fields?.find((entry) => entry.id === trait);
  if (field?.kind === "collection") {
    const name = costRule.basis === "per_dot" ? itemBase(itemName) : itemName.trim();
    if (!name || name.length > 120) throw new RangeError("Informe o nome do item (até 120 caracteres).");
    const items = Array.isArray(values[trait]) ? (values[trait] as unknown[]).filter((item): item is string => typeof item === "string") : [];
    let from = 0;
    if (costRule.basis === "per_dot") {
      const existing = items.find((item) => itemBase(item).toLowerCase() === name.toLowerCase());
      from = existing ? itemDots(existing) : 0;
      if (target > 5) throw new RangeError("Uma Vantagem vai até 5 pontos.");
    } else {
      if (items.some((item) => item.trim().toLowerCase() === name.toLowerCase())) throw new RangeError("Este item já está na ficha.");
      if (costRule.basis === "flat" && target !== 1) throw new RangeError("Compra de valor fixo usa nível 1.");
      if (target > 5) throw new RangeError("O nível do item vai de 1 a 5.");
    }
    return { category, label: costRule.label, basis: costRule.basis, from, to: target, cost: advanceCost(costRule, from, target), collection: true };
  }
  if (field?.kind !== "number") throw new RangeError("Este traço não se compra com XP neste sistema.");
  const raw = values[trait];
  const from = typeof raw === "number" && Number.isInteger(raw) ? raw : 0;
  const maximum = Math.min(20, typeof field.max === "number" ? field.max : 10);
  if (target <= from) throw new RangeError("O nível desejado deve superar o nível atual.");
  if (target - from > 5) throw new RangeError("Compre no máximo cinco níveis de uma vez.");
  if (target > maximum) throw new RangeError(`O limite deste traço é ${maximum}.`);
  return { category, label: costRule.label, basis: costRule.basis, from, to: target, cost: advanceCost(costRule, from, target), collection: false };
}

/** Traços compráveis do modelo, na ordem dos campos. */
export function purchasableTraits(template: TemplateLike): string[] {
  if (!isExperienceSystem(template.system_key)) return [];
  const categories = EXPERIENCE_TRAIT_CATEGORIES[template.system_key];
  return (template.fields ?? []).filter((field) => categories[field.id] && (field.kind === "number" || field.kind === "collection")).map((field) => field.id);
}

// Calculadora antiga (V5, só estimativa). Mantida para ler o histórico local
// anterior ao EXP-02, que agora aparece como "estimativas".
export type ExperienceKind = "attribute" | "skill" | "discipline" | "outOfClanDiscipline" | "bloodPotency";
const legacyMultipliers: Record<ExperienceKind, number> = { attribute: 5, skill: 3, discipline: 5, outOfClanDiscipline: 7, bloodPotency: 10 };

export function calculateExperienceCost(kind: ExperienceKind, current: number, target: number): number {
  if (!Object.prototype.hasOwnProperty.call(legacyMultipliers, kind)) throw new RangeError("Categoria de avanço inválida.");
  if (!Number.isInteger(current) || current < 0 || current > 5) throw new RangeError("O nível atual deve ficar entre 0 e 5.");
  if (!Number.isInteger(target) || target < 1 || target > 5) throw new RangeError("O nível desejado deve ficar entre 1 e 5.");
  if (target <= current) throw new RangeError("O nível desejado deve superar o nível atual.");
  let cost = 0;
  for (let rank = current + 1; rank <= target; rank += 1) cost += rank * legacyMultipliers[kind];
  return cost;
}
