// F1: ciclo do Sangue de Vampiro: A Máscara 5ª ed. Espelho de
// backend/app/services/v5_blood.py e das RPCs de 20261029100000_v5_blood_cycle.sql.
// Regras puras, sem rede e sem React. Os dados são rolados no banco; aqui só
// se calculam derivados e se conferem resultados. Números marcados para conferência.

export type FrenzyKind = "fury" | "hunger" | "terror";
export type AnimalSlake = "full" | "half" | "none";

export type BloodPotencyRow = {
  potency: number;
  surge: number;
  mend: number;
  power_bonus: number;
  rouse_reroll_level: number;
  bane_severity: number;
  animal_slake: AnimalSlake;
  human_slake_penalty: number;
  kill_to_reduce_below: number | null;
};

export const BLOOD_REVIEW_RULES = [
  "Tabela da Potência de Sangue 0-10 (Surto, Remendar, Bônus de Poder, rerrolagem de Despertar o Sangue, Severidade da Perdição, alimentação).",
  "Resistência ao Frenesi: Força de Vontade atual + Humanidade / 3 (arredondado para baixo); o plano sugeria metade.",
  "Brujah subtraem a Severidade da Perdição ao resistir ao frenesi de fúria.",
  "Vampiro divide o dano superficial físico pela metade (para cima) depois da armadura.",
  "Tabela de Compulsão no d10: 1-3 Fome, 4-5 Dominação, 6-7 Destruição, 8 Paranoia, 9-10 do clã.",
  "Penalidade das Compulsões: -2 dados nas ações que não a satisfazem.",
  "Duração do Torpor por Humanidade.",
];

const row = (potency: number, surge: number, mend: number, bonus: number, reroll: number, bane: number, human: number, kill: number | null): BloodPotencyRow => ({
  potency, surge, mend, power_bonus: bonus, rouse_reroll_level: reroll, bane_severity: bane,
  animal_slake: potency <= 1 ? "full" : potency === 2 ? "half" : "none", human_slake_penalty: human, kill_to_reduce_below: kill,
});

export const BLOOD_POTENCY_TABLE: readonly BloodPotencyRow[] = [
  row(0, 1, 1, 0, 0, 0, 0, null), row(1, 2, 1, 0, 1, 2, 0, null), row(2, 2, 2, 1, 1, 2, 0, null),
  row(3, 3, 2, 1, 2, 3, 0, null), row(4, 3, 3, 2, 2, 3, 1, null), row(5, 4, 3, 2, 3, 4, 1, 2),
  row(6, 4, 3, 3, 3, 4, 2, 2), row(7, 5, 3, 3, 4, 5, 2, 2), row(8, 5, 4, 4, 4, 5, 2, 3),
  row(9, 6, 4, 4, 5, 6, 2, 3), row(10, 6, 5, 5, 5, 6, 3, 3),
];

export const FRENZY_HUMANITY_DIVISOR = 3;
export const HUNGER_MAX = 5;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const int = (value: unknown, fallback: number) => typeof value === "number" && Number.isInteger(value) ? value : fallback;

export function bloodPotency(potency: number): BloodPotencyRow {
  return BLOOD_POTENCY_TABLE[clamp(Math.trunc(potency) || 0, 0, 10)];
}

export function rouseRerollAllowed(potency: number, disciplineLevel: number | null | undefined): boolean {
  return typeof disciplineLevel === "number" && disciplineLevel >= 1 && disciplineLevel <= bloodPotency(potency).rouse_reroll_level;
}

export function rouseSuccessChance(potency: number, disciplineLevel?: number | null): number {
  return rouseRerollAllowed(potency, disciplineLevel) ? 0.75 : 0.5;
}

export function resolveRouse(dice: number[], hunger: number) {
  const success = dice.some((face) => face >= 6);
  const before = clamp(hunger, 0, HUNGER_MAX);
  const after = success ? before : Math.min(HUNGER_MAX, before + 1);
  return { success, hungerBefore: before, hungerAfter: after, hungerFrenzyTest: !success && before === HUNGER_MAX };
}

export function remorsePool(humanity: number, stains: number): number {
  return Math.max(1, 10 - clamp(humanity, 0, 10) - clamp(stains, 0, 10));
}

export function remorseSuccessChance(humanity: number, stains: number): number {
  return 1 - 0.5 ** remorsePool(humanity, stains);
}

export function countSuccesses(dice: number[]): number {
  return dice.filter((face) => face >= 6).length + 2 * Math.floor(dice.filter((face) => face === 10).length / 2);
}

export function frenzyPool(willpowerCurrent: number, humanity: number, options: { clan?: string | null; kind?: FrenzyKind; potency?: number } = {}): number {
  const bane = options.kind !== "hunger" && options.kind !== "terror" && options.clan === "Brujah" ? bloodPotency(options.potency ?? 0).bane_severity : 0;
  return clamp(Math.max(0, willpowerCurrent) + Math.floor(clamp(humanity, 0, 10) / FRENZY_HUMANITY_DIVISOR) - bane, 0, 30);
}

export type Compulsion = { name: string; penalty: number; effect: string };

export const GENERAL_COMPULSIONS: readonly Compulsion[] = [
  { name: "Fome", penalty: 2, effect: "-2 dados até se alimentar" },
  { name: "Dominação", penalty: 2, effect: "-2 dados até impor sua vontade a alguém" },
  { name: "Destruição", penalty: 2, effect: "-2 dados até destruir ou ferir algo" },
  { name: "Paranoia", penalty: 2, effect: "-2 dados até fugir ou se proteger da ameaça percebida" },
];

export const CLAN_COMPULSIONS: Readonly<Record<string, Compulsion>> = {
  "Banu Haqim": { name: "Julgamento", penalty: 2, effect: "-2 dados até punir um transgressor" },
  Brujah: { name: "Rebeldia", penalty: 2, effect: "-2 dados até desafiar a autoridade presente" },
  Gangrel: { name: "Impulsos Ferais", penalty: 2, effect: "-2 dados em ações sociais e mentais complexas" },
  Hecata: { name: "Morbidez", penalty: 2, effect: "-2 dados até investigar a morte ou o morrer" },
  Lasombra: { name: "Implacabilidade", penalty: 2, effect: "-2 dados após uma falha, até vencer" },
  Malkaviano: { name: "Delírio", penalty: 2, effect: "-2 dados em Destreza, Manipulação, Autocontrole e Raciocínio" },
  Ministério: { name: "Transgressão", penalty: 2, effect: "-2 dados até levar alguém a quebrar uma convicção" },
  Nosferatu: { name: "Criptofilia", penalty: 2, effect: "-2 dados até descobrir um segredo" },
  Ravnos: { name: "Tentar o Destino", penalty: 2, effect: "-2 dados até correr um risco ousado" },
  Salubri: { name: "Empatia Afetiva", penalty: 2, effect: "-2 dados até aliviar a dor de alguém" },
  Toreador: { name: "Obsessão", penalty: 2, effect: "-2 dados em ações sem relação com a beleza que o prende" },
  Tremere: { name: "Perfeccionismo", penalty: 2, effect: "-2 dados até obter um sucesso crítico" },
  Tzimisce: { name: "Cobiça", penalty: 2, effect: "-2 dados até tomar posse do objeto desejado" },
  Ventrue: { name: "Arrogância", penalty: 2, effect: "-2 dados até alguém obedecer a uma ordem" },
};

export const CLAN_COMPULSION_LABEL = "Compulsão do clã";
export const COMPULSION_OPTIONS = ["Nenhuma", ...GENERAL_COMPULSIONS.map((item) => item.name), CLAN_COMPULSION_LABEL];

/** d10 table; null means roll again (9-10 for a clan without its own compulsion). */
export function compulsionFromDie(face: number, clan: string | null | undefined): string | null {
  if (face <= 3) return "Fome";
  if (face <= 5) return "Dominação";
  if (face <= 7) return "Destruição";
  if (face === 8) return "Paranoia";
  return clan && CLAN_COMPULSIONS[clan] ? CLAN_COMPULSION_LABEL : null;
}

export function describeCompulsion(value: string | null | undefined, clan: string | null | undefined): Compulsion | null {
  if (value === CLAN_COMPULSION_LABEL) return clan ? CLAN_COMPULSIONS[clan] ?? null : null;
  return GENERAL_COMPULSIONS.find((item) => item.name === value) ?? null;
}

export const TORPOR_DURATIONS = [
  "um milênio ou mais", "cinco séculos", "um século", "cinco décadas", "uma década", "um ano",
  "um mês", "duas semanas", "uma semana", "três dias", "um dia",
];

export function torporDuration(humanity: number): string {
  return TORPOR_DURATIONS[clamp(Math.trunc(humanity) || 0, 0, 10)];
}

export function halveSuperficial(amount: number): number {
  return Math.ceil(Math.max(0, amount) / 2);
}

export const ANIMAL_SLAKE_LABELS: Record<AnimalSlake, string> = {
  full: "sangue animal e ensacado saciam normalmente",
  half: "sangue animal e ensacado saciam metade",
  none: "sangue animal e ensacado não saciam",
};

export function feedingPenaltyLabel(rowValue: BloodPotencyRow): string {
  const parts = [ANIMAL_SLAKE_LABELS[rowValue.animal_slake]];
  if (rowValue.human_slake_penalty) parts.push(`humano sacia ${rowValue.human_slake_penalty} a menos`);
  if (rowValue.kill_to_reduce_below !== null) parts.push(`Fome abaixo de ${rowValue.kill_to_reduce_below} só matando`);
  return parts.join("; ");
}

export type BloodState = {
  potency: BloodPotencyRow;
  hunger: number;
  humanity: number;
  stains: number;
  remorsePool: number;
  remorseChance: number | null;
  willpowerCurrent: number;
  frenzyPool: Record<FrenzyKind, number>;
  inTorpor: boolean;
  torporDuration: string;
  compulsion: string | null;
  compulsionDetail: Compulsion | null;
  clanCompulsion: Compulsion | null;
};

export function bloodState(values: Record<string, unknown>): BloodState {
  const potency = clamp(int(values.potencia_sangue, 0), 0, 10);
  const humanity = clamp(int(values.humanidade, 7), 0, 10);
  const stains = clamp(int(values.manchas, 0), 0, 10);
  const willpowerMax = clamp(int(values.autocontrole, 0) + int(values.resolucao, 0), 0, 30);
  const willpowerCurrent = Math.max(0, willpowerMax - Math.max(0, int(values.vontade_superficial, 0)) - Math.max(0, int(values.vontade_agravada, 0)));
  const clan = typeof values.cla === "string" ? values.cla : null;
  const compulsion = typeof values.compulsao_atual === "string" ? values.compulsao_atual : null;
  return {
    potency: bloodPotency(potency),
    hunger: clamp(int(values.fome, 0), 0, HUNGER_MAX),
    humanity,
    stains,
    remorsePool: stains ? remorsePool(humanity, stains) : 0,
    remorseChance: stains ? remorseSuccessChance(humanity, stains) : null,
    willpowerCurrent,
    frenzyPool: {
      fury: frenzyPool(willpowerCurrent, humanity, { clan, kind: "fury", potency }),
      hunger: frenzyPool(willpowerCurrent, humanity, { clan, kind: "hunger", potency }),
      terror: frenzyPool(willpowerCurrent, humanity, { clan, kind: "terror", potency }),
    },
    inTorpor: values.torpor === true,
    torporDuration: torporDuration(humanity),
    compulsion,
    compulsionDetail: describeCompulsion(compulsion, clan),
    clanCompulsion: clan ? CLAN_COMPULSIONS[clan] ?? null : null,
  };
}

/** Exact distribution of the Hunger after a Rouse by enumerating every face. */
export function enumerateRouse(hunger: number, rerollAllowed: boolean): Map<number, number> {
  const result = new Map<number, number>();
  for (let first = 1; first <= 10; first += 1) {
    const sequences = first >= 6 || !rerollAllowed ? [[first]] : Array.from({ length: 10 }, (_, index) => [first, index + 1]);
    for (const dice of sequences) {
      const after = resolveRouse(dice, hunger).hungerAfter;
      result.set(after, (result.get(after) ?? 0) + 0.1 / sequences.length);
    }
  }
  return result;
}

/** The item a Discipline power takes in the sheet collection: "Disciplina: Poder". */
export function parsePowerItem(item: string): { discipline: string; power: string } | null {
  const index = item.indexOf(":");
  if (index <= 0) return null;
  return { discipline: item.slice(0, index).trim(), power: item.slice(index + 1).trim() };
}
