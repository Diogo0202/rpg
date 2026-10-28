import type { FieldValue, SheetField } from "./sheet-template.ts";
import { bloodPotency } from "./v5-blood.ts";

/**
 * Vampiro V5, ficha complementar e SAN (frente F2). Espelha backend/app/services/v5_sanguine.py
 * e a migration 20261029110000_v5_feeding_bonds.sql. Só nomes e mecânica resumida; tudo que
 * vem do livro está marcado para conferência (SANGUINE_REVIEW_RULES em backend/app/services/v5_sanguine.py).
 */

/** Convicções e Pedras de Toque: até três pares, preenchidos juntos. Conferir a quantidade. */
export const V5_PAIRS = 3;
export const V5_LIMITS = { conviccao: 160, pedra_toque: 120, principio: 160, discrasia: 160 } as const;
/** Princípios da Crônica: textos curtos definidos pela mesa. */
export const V5_TENETS_MAX = 5;

export const V5_RESONANCES = ["Nenhuma", "Colérica", "Melancólica", "Fleumática", "Sanguínea", "Animal", "Vazia"] as const;
export type V5Resonance = (typeof V5_RESONANCES)[number];
export const V5_INTENSITIES = ["Nenhuma", "Fugaz", "Intensa", "Aguda"] as const;
export type V5Intensity = (typeof V5_INTENSITIES)[number];

/** Disciplinas que recebem o bônus de cada Ressonância (ids da ficha, usados como tags). Conferir. */
export const V5_RESONANCE_DISCIPLINES: Record<V5Resonance, string[]> = {
  Nenhuma: [],
  Colérica: ["disc_potencia", "disc_rapidez"],
  Melancólica: ["disc_fortitude", "disc_ofuscacao"],
  Fleumática: ["disc_auspicios", "disc_dominacao"],
  Sanguínea: ["disc_feiticaria", "disc_presenca"],
  Animal: ["disc_animalismo", "disc_metamorfose"],
  Vazia: ["disc_oblivio"],
};
/** Dados extras nas Disciplinas da Ressonância por intensidade. Conferir. */
export const V5_RESONANCE_BONUS: Record<V5Intensity, number> = { Nenhuma: 0, Fugaz: 0, Intensa: 1, Aguda: 1 };

/** Perdição de cada clã: nome e efeito mecânico resumido, escalado pela Severidade. Conferir tudo. */
export const V5_CLAN_BANES: Record<string, { name: string; effect: string }> = {
  "Banu Haqim": { name: "Sede de Sangue Cainita", effect: "Ao provar sangue vampírico, teste de Frenesi de Fome com dificuldade somada à Severidade." },
  Brujah: { name: "Fúria Latente", effect: "Subtrai a Severidade dos dados para resistir ao Frenesi de Fúria." },
  Gangrel: { name: "Feições Bestiais", effect: "Cada Frenesi deixa feições animais; −1 em um Atributo por feição, até a Severidade." },
  Hecata: { name: "Beijo Doloroso", effect: "O Beijo causa dor; presas não contidas resistem e a caçada fica mais difícil (Severidade)." },
  Lasombra: { name: "Distorção", effect: "Imagem e voz distorcidas em espelhos e gravações; −Severidade em paradas com tecnologia." },
  Malkaviano: { name: "Fratura", effect: "Em Compulsão ou falha bestial, −Severidade numa categoria de paradas durante a cena." },
  Ministério: { name: "Abominação à Luz", effect: "−Severidade nas paradas sob luz forte; dano solar aumenta pela Severidade." },
  Nosferatu: { name: "Repulsivos", effect: "Não passam por mortais; −Severidade para se disfarçar; sem Vantagens de aparência." },
  Ravnos: { name: "Condenação do Sol", effect: "Dano solar aumentado; repousar no mesmo abrigo em noites seguidas causa dano pela Severidade." },
  Salubri: { name: "Sangue Cobiçado", effect: "O terceiro olho sangra ao usar Disciplinas; quem prova o sangue resiste pela Severidade." },
  Toreador: { name: "Estética", effect: "Em ambientes sem beleza, −Severidade nas paradas de Disciplina." },
  Tremere: { name: "Vínculo Enfraquecido", effect: "O sangue não vincula outros vampiros; mortais precisam de mais ingestões (Severidade)." },
  Tzimisce: { name: "Apego à Terra", effect: "Sem repousar com seu objeto ou solo de apego, sofre dano agravado de Vontade pela Severidade." },
  Ventrue: { name: "Paladar Refinado", effect: "Fora da presa preferida, gasta Vontade igual à Severidade para se alimentar." },
};

/** Severidade da Perdição pela tabela de Potência de F1 (frontend/lib/v5-blood.ts). Conferir no livro. */
export function baneSeverity(potency: number): number {
  if (!Number.isInteger(potency) || potency <= 0) return 0;
  return bloodPotency(potency).bane_severity;
}
/** Mesma conta como fórmula da ficha (o avaliador só tem aritmética). */
export const BANE_SEVERITY_FORMULA = "((potencia_sangue + 1) // 2 + 1) * ((potencia_sangue + 9) // 10)";

function text(id: string, label: string, max_length: number, extra: Partial<SheetField> = {}): SheetField {
  return { id, label, kind: "text", required: false, options: [], expression: null, max_length, ...extra };
}

/** Campos novos da ficha V5, em ordem. Nenhum é obrigatório: fichas antigas continuam válidas. */
export function v5SheetFields(clans: string[]): SheetField[] {
  const pairs = Array.from({ length: V5_PAIRS }, (_, index) => {
    const n = index + 1;
    return [
      text(`conviccao_${n}`, `Convicção ${n}`, V5_LIMITS.conviccao, { paired_with: `pedra_toque_${n}` }),
      text(`pedra_toque_${n}`, `Pedra de Toque ${n}`, V5_LIMITS.pedra_toque, { paired_with: `conviccao_${n}` }),
    ];
  }).flat();
  return [
    ...pairs,
    { id: "principios_cronica", label: "Princípios da Crônica", kind: "collection", required: false, options: [], expression: null,
      max_length: V5_LIMITS.principio, max_items: V5_TENETS_MAX },
    { id: "perdicao", label: "Perdição do clã", kind: "select", required: false, options: [], expression: null,
      depends_on: { field_id: "cla", cases: clans.filter((clan) => V5_CLAN_BANES[clan]).map((clan) => ({ equals: clan, options: [V5_CLAN_BANES[clan].name] })) } },
    { id: "severidade_perdicao", label: "Severidade da Perdição", kind: "formula", required: false, options: [], expression: BANE_SEVERITY_FORMULA },
    { id: "ressonancia_atual", label: "Ressonância atual", kind: "select", required: false, options: [...V5_RESONANCES], expression: null },
    { id: "intensidade_ressonancia", label: "Intensidade da Ressonância", kind: "select", required: false, options: [...V5_INTENSITIES], expression: null },
    text("discrasia", "Discrasia", V5_LIMITS.discrasia),
  ];
}
export const V5_SHEET_EXTRA_IDS = [
  ...Array.from({ length: V5_PAIRS }, (_, index) => [`conviccao_${index + 1}`, `pedra_toque_${index + 1}`]).flat(),
  "principios_cronica", "perdicao", "severidade_perdicao", "ressonancia_atual", "intensidade_ressonancia", "discrasia",
];

const filled = (value: FieldValue | undefined) => typeof value === "string" && Boolean(value.trim());

/** O que impede os campos novos de passarem; vazio quando estão coerentes. Mesma saída do backend. */
export function v5TraitProblems(values: Record<string, FieldValue>): string[] {
  const problems: string[] = [];
  for (let n = 1; n <= V5_PAIRS; n += 1) {
    if (filled(values[`conviccao_${n}`]) !== filled(values[`pedra_toque_${n}`])) problems.push(`Par ${n}: preencha Convicção e Pedra de Toque juntas`);
  }
  const clan = values.cla;
  const bane = values.perdicao;
  if (typeof bane === "string" && bane && (typeof clan !== "string" || V5_CLAN_BANES[clan]?.name !== bane)) problems.push("A Perdição não é a do clã escolhido");
  const resonance = values.ressonancia_atual;
  const intensity = values.intensidade_ressonancia;
  if (typeof resonance === "string" && typeof intensity === "string" && (resonance === "Nenhuma") !== (intensity === "Nenhuma")) {
    problems.push("Ressonância e intensidade andam juntas");
  }
  if (filled(values.discrasia) && intensity !== "Aguda") problems.push("Discrasia só com Ressonância aguda");
  const tenets = values.principios_cronica;
  if (Array.isArray(tenets) && tenets.length > V5_TENETS_MAX) problems.push(`Até ${V5_TENETS_MAX} Princípios da Crônica`);
  return problems;
}

export type ResonanceEffect = {
  id: string; label: string; delta: number; enabled: boolean; applies_to_tags: string[]; exempt_tags: string[];
  remaining_scenes: number | null; source_note: string | null;
};

/** O efeito que record_v5_hunt cria; null quando a Ressonância não dá bônus. */
export function resonanceEffectPreview(resonance: V5Resonance, intensity: V5Intensity, prey: string): Omit<ResonanceEffect, "id"> | null {
  const delta = V5_RESONANCE_BONUS[intensity];
  const tags = V5_RESONANCE_DISCIPLINES[resonance];
  if (!delta || !tags.length) return null;
  return {
    label: `Ressonância ${resonance} (${intensity})`, delta, enabled: true, applies_to_tags: [...tags], exempt_tags: [],
    remaining_scenes: null, source_note: `Caçada V5 (${prey.trim().slice(0, 80)}); bônus de Ressonância a conferir no livro`,
  };
}

/** Menor Fome da caçada: 0 matando; sem matar, 1 ou o limite da Potência alta (tabela de F1). */
export function huntFloor(potency: number, killed: boolean): number {
  if (killed) return 0;
  return Math.max(1, bloodPotency(Number.isInteger(potency) ? potency : 0).kill_to_reduce_below ?? 1);
}

/** Fome depois da caçada: nunca sobe; abaixo do piso só matando a presa. */
export function hungerAfterHunt(hunger: number, slake: number, killed: boolean, potency = 0): number {
  return Math.min(hunger, Math.max(hunger - slake, huntFloor(potency, killed)));
}

const DAY_MS = 86_400_000;
const utcNight = (time: number) => Math.floor(time / DAY_MS);

/**
 * Grau do Vínculo (0 a 3): cada noite UTC distinta com ingestão sobe um nível; a cada
 * `decayDays` dias sem beber, perde um. Mesma regra de private.v5_bond_degree_from. Conferir.
 */
export function bondDegree(drinks: Array<string | Date>, decayDays: number, at: Date = new Date()): number {
  if (!Number.isInteger(decayDays) || decayDays < 1) throw new Error("O decaimento precisa ser de ao menos um dia.");
  const now = at.getTime();
  const times = drinks.map((item) => new Date(item).getTime()).filter((time) => Number.isFinite(time) && time <= now).sort((a, b) => a - b);
  const period = decayDays * DAY_MS;
  let level = 0;
  let last: number | null = null;
  for (const time of times) {
    if (last !== null) level = Math.max(0, level - Math.floor((time - last) / period));
    if (last === null || utcNight(time) !== utcNight(last)) level = Math.min(3, level + 1);
    last = time;
  }
  if (last !== null) level = Math.max(0, level - Math.floor((now - last) / period));
  return level;
}

export const BOND_DEGREE_LABELS = ["Sem vínculo", "Primeiro grau", "Segundo grau", "Vínculo pleno"] as const;
