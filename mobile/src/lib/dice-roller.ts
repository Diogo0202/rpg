/**
 * Pure helpers for the animated 2D roller. Results are always computed up front with
 * crypto.getRandomValues (rejection sampling in `randomInt`); the UI only presents them.
 */
import { randomInt, type DiceRoll } from "./dice";

export { randomInt };

/** Above this many dice the stage groups them instead of animating one element per die. */
export const MAX_ANIMATED_DICE = 20;
/** Length of the presentation animation, in milliseconds. */
export const ROLL_ANIMATION_MS = 650;

export type RandomSource = (arr: Uint32Array) => unknown;

/** Rolls `count` dice with `faces` sides using the unbiased secure generator. */
export function rollDice(count: number, faces: number, source?: RandomSource): number[] {
  if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error("Quantidade de dados inválida.");
  return Array.from({ length: count }, () => randomInt(faces, source));
}

export type V5Classification = {
  successes: number;
  tens: number;
  hungerTens: number;
  hungerOnes: number;
  /** At least one pair of 10s (and the difficulty met, when one is given). */
  critical: boolean;
  /** Critical where a Hunger die shows one of the 10s. */
  messyCritical: boolean;
  /** Failed against the difficulty with a 1 on a Hunger die. Needs a difficulty. */
  bestialFailure: boolean;
  /** Hunger shows a 1: a failure would be bestial. Useful when no difficulty is known. */
  bestialRisk: boolean;
  /** null when no difficulty was supplied. */
  success: boolean | null;
  margin: number | null;
};

/**
 * Classifies a V5 pool. `rolls` are d10 faces; the first `hunger` entries are Hunger dice
 * (same convention as `rollPool`). Successes: faces 6-10; each pair of 10s adds two more.
 */
export function classifyV5(rolls: readonly number[], hunger: number, difficulty?: number): V5Classification {
  if (!rolls.every((r) => Number.isInteger(r) && r >= 1 && r <= 10)) throw new Error("Dados V5 devem ir de 1 a 10.");
  if (!Number.isInteger(hunger) || hunger < 0 || hunger > rolls.length) throw new Error("Dados de fome inválidos.");
  if (difficulty !== undefined && (!Number.isInteger(difficulty) || difficulty < 0))
    throw new Error("Dificuldade inválida.");
  const hungerDice = rolls.slice(0, hunger);
  const tens = rolls.filter((r) => r === 10).length;
  const hungerTens = hungerDice.filter((r) => r === 10).length;
  const hungerOnes = hungerDice.filter((r) => r === 1).length;
  const successes = rolls.filter((r) => r >= 6).length + Math.floor(tens / 2) * 2;
  const success = difficulty === undefined ? null : successes >= difficulty;
  const pair = tens >= 2;
  const critical = pair && success !== false;
  return {
    successes,
    tens,
    hungerTens,
    hungerOnes,
    critical,
    messyCritical: critical && hungerTens > 0,
    bestialFailure: success === false && hungerOnes > 0,
    bestialRisk: hungerOnes > 0,
    success,
    margin: difficulty === undefined ? null : successes - difficulty,
  };
}

export type DieTone = "neutral" | "crit" | "fail" | "messy" | "bestial" | "success";
export type DieView = {
  key: string;
  faces: number;
  value: number;
  hunger: boolean;
  tone: DieTone;
  term: string;
};
export type DieGroup = {
  key: string;
  label: string;
  faces: number;
  hunger: boolean;
  values: number[];
  crits: number;
  fails: number;
  tone: DieTone;
};
export type RollTone = "neutral" | "success" | "fail" | "crit" | "messy" | "bestial";
export type RollSummary = { tone: RollTone; headline: string; detail: string; announce: string };
export type RollContext = { mode: "expression" | "v5" | "sotdl" | "hunter"; hunger?: number; difficulty?: number };

function facesFromLabel(label: string): number | null {
  const match = /^-?\d+d(\d+)$/.exec(label);
  return match ? Number(match[1]) : null;
}

/** One view per die, with its highlight already decided (shown on the first final frame). */
export function buildDiceViews(roll: DiceRoll, ctx: RollContext): DieView[] {
  const views: DieView[] = [];
  roll.terms.forEach((term, termIndex) => {
    if (!term.rolls.length) return;
    const faces =
      ctx.mode === "v5" || ctx.mode === "hunter" ? 10 : ctx.mode === "sotdl" ? (termIndex === 0 ? 20 : 6) : (facesFromLabel(term.label) ?? 0);
    term.rolls.forEach((value, index) => {
      const hunger = ctx.mode === "hunter" ? termIndex === 1 : ctx.mode === "v5" && index < (ctx.hunger ?? roll.pool?.hungerDice.length ?? 0);
      let tone: DieTone = "neutral";
      if (ctx.mode === "v5") {
        if (value === 10) tone = hunger ? "messy" : "crit";
        else if (value === 1 && hunger) tone = "bestial";
        else if (value >= 6) tone = "success";
      } else if (ctx.mode === "hunter") {
        if (value === 10) tone = "crit";
        else if (value === 1 && hunger) tone = "bestial";
        else if (value >= 6) tone = "success";
      } else if (faces >= 2) {
        if (value === faces) tone = "crit";
        else if (value === 1) tone = "fail";
      }
      views.push({ key: `${termIndex}-${index}`, faces, value, hunger, tone, term: term.label });
    });
  });
  return views;
}

/** Groups dice by term and Hunger, so large pools render a bounded number of elements. */
export function groupDice(views: readonly DieView[]): DieGroup[] {
  const groups = new Map<string, DieGroup>();
  for (const die of views) {
    const key = `${die.term}|${die.hunger ? "h" : "n"}`;
    const group =
      groups.get(key) ??
      ({ key, label: die.hunger ? `${die.term} (fome)` : die.term, faces: die.faces, hunger: die.hunger, values: [], crits: 0, fails: 0, tone: "neutral" } as DieGroup);
    group.values.push(die.value);
    if (die.tone === "crit" || die.tone === "messy") group.crits++;
    if (die.tone === "fail" || die.tone === "bestial") group.fails++;
    groups.set(key, group);
  }
  return Array.from(groups.values(), (group) => ({
    ...group,
    tone: group.crits && group.hunger ? "messy" : group.fails && group.hunger ? "bestial" : group.crits ? "crit" : group.fails ? "fail" : "neutral",
  }));
}

export type DicePlan =
  | { mode: "individual"; dice: DieView[] }
  | { mode: "grouped"; dice: DieView[]; groups: DieGroup[] };

export function planDice(roll: DiceRoll, ctx: RollContext, limit = MAX_ANIMATED_DICE): DicePlan {
  const dice = buildDiceViews(roll, ctx);
  if (dice.length <= limit) return { mode: "individual", dice };
  const groups = groupDice(dice);
  return { mode: "grouped", dice, groups: ctx.mode === "hunter" ? groups.map((group) => ({ ...group, label: group.label.replace("(fome)", "(Desespero)") })) : groups };
}

/** Headline and screen reader text for a finished roll. */
export function summarizeRoll(roll: DiceRoll, ctx: RollContext): RollSummary {
  const name = roll.label ? `${roll.label}: ` : "";
  if (ctx.mode === "v5") {
    const rolls = roll.terms[0]?.rolls ?? [];
    const hunger = ctx.hunger ?? roll.pool?.hungerDice.length ?? 0;
    const v5 = classifyV5(rolls, Math.min(hunger, rolls.length), ctx.difficulty);
    const count = `${v5.successes} sucesso${v5.successes === 1 ? "" : "s"}`;
    const against = ctx.difficulty !== undefined ? ` contra dificuldade ${ctx.difficulty}` : "";
    let tone: RollTone = v5.success === null ? "neutral" : v5.success ? "success" : "fail";
    let headline = v5.success === null ? count : v5.success ? "Sucesso" : "Falha";
    if (v5.messyCritical) [tone, headline] = ["messy", "Crítico sujo"];
    else if (v5.critical) [tone, headline] = ["crit", "Sucesso crítico"];
    else if (v5.bestialFailure) [tone, headline] = ["bestial", "Falha bestial"];
    const risk = v5.success === null && v5.bestialRisk && !v5.critical ? " Fome mostra 1: se falhar, é bestial." : "";
    const detail = `${count}${against}.${risk}`;
    return { tone, headline, detail, announce: `${name}${headline}. ${detail}` };
  }
  if (ctx.mode === "sotdl" && roll.sotdl) {
    const { success, critical, target } = roll.sotdl;
    const tone: RollTone = critical ? "crit" : success ? "success" : "fail";
    const headline = critical ? "Crítico" : success ? "Sucesso" : "Falha";
    const detail = `Total ${roll.total} contra ${target}.`;
    return { tone, headline, detail, announce: `${name}${headline}. ${detail}` };
  }
  if (ctx.mode === "hunter" && roll.hunter) {
    const { success, critical, difficulty, desperationOnes, desperationConsequence } = roll.hunter;
    const tone: RollTone = critical ? "crit" : success ? "success" : "fail";
    const headline = critical ? "Crítico" : success ? "Êxito" : "Falha";
    const consequence = desperationOnes ? (desperationConsequence === "despair" ? " Desespero: Despair." : " Desespero: escolha da mesa entre Despair e Overreach.") : "";
    const detail = `${roll.total} ${roll.total === 1 ? "sucesso" : "sucessos"} contra dificuldade ${difficulty}.${consequence}`;
    return { tone, headline, detail, announce: `${name}${headline}. ${detail}` };
  }
  const dice = buildDiceViews(roll, ctx);
  const allMax = dice.length > 0 && dice.every((d) => d.tone === "crit");
  const allMin = dice.length > 0 && dice.every((d) => d.tone === "fail");
  const tone: RollTone = allMax ? "crit" : allMin ? "fail" : "neutral";
  const headline = `Total ${roll.total}`;
  const detail = allMax ? "Todos os dados no máximo." : allMin ? "Todos os dados em 1." : roll.expression;
  return { tone, headline, detail, announce: `${name}${headline}. ${detail}` };
}
