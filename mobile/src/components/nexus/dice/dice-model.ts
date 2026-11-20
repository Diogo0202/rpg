/** Regras do rolador local, sem React: validação das entradas, rolagem por modo e histórico. */

import { DICE_LIMITS, rollExpression, rollHunter, rollPool, rollSotdl, type DiceRoll } from "@/lib/dice";
import type { RollContext } from "@/lib/dice-roller";

export const HISTORY_KEY = "dice-roll-history-v1";
export const HISTORY_LIMIT = 30;
export const LABEL_LIMIT = 48;

export type RollMode = "expression" | "v5" | "sotdl" | "hunter";

export const ROLL_MODES: Array<{ mode: RollMode; label: string }> = [
  { mode: "expression", label: "NdM + modificador" },
  { mode: "v5", label: "Parada V5 local" },
  { mode: "sotdl", label: "d20 Demon Lord" },
  { mode: "hunter", label: "d10 Caçador" },
];

/** Entradas do formulário, todas como texto digitado, menos a escolha de somar Desespero. */
export type DiceInputs = {
  expression: string;
  modifier: string;
  poolSize: string;
  hunger: string;
  difficulty: string;
  willpowerDice: string;
  attribute: string;
  boons: string;
  banes: string;
  target: string;
  desperation: string;
  useDesperation: boolean;
  label: string;
};

export const INITIAL_INPUTS: DiceInputs = {
  expression: "2d6",
  modifier: "0",
  poolSize: "5",
  hunger: "0",
  difficulty: "3",
  willpowerDice: "3",
  attribute: "10",
  boons: "0",
  banes: "0",
  target: "10",
  desperation: "0",
  useDesperation: false,
  label: "",
};

export function readInteger(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

/** Lê vários inteiros de uma vez; nulo se algum não for inteiro. */
export function readIntegers(values: string[]): number[] | null {
  const numbers = values.map(readInteger);
  return numbers.some((value) => value === null) ? null : (numbers as number[]);
}

function readModifier(text: string): number {
  if (!/^-?\d+$/.test(text.trim())) throw new Error("O modificador precisa ser um número inteiro.");
  const value = Number(text);
  if (!Number.isSafeInteger(value) || Math.abs(value) > DICE_LIMITS.maxModifier)
    throw new Error(`O modificador deve ficar entre -${DICE_LIMITS.maxModifier} e ${DICE_LIMITS.maxModifier}.`);
  return value;
}

function rollV5(inputs: DiceInputs, label: string): { roll: DiceRoll; context: RollContext } {
  const pool = readInteger(inputs.poolSize);
  const hunger = readInteger(inputs.hunger);
  if (pool === null || hunger === null) throw new Error("A parada e os dados de fome precisam ser números inteiros.");
  if (pool < 1 || pool > 30) throw new Error("A parada deve ter de 1 a 30 dados.");
  if (hunger > pool) throw new Error("Dados de fome não podem exceder a parada.");
  if (hunger > 5) throw new Error("Fome deve ficar entre 0 e 5.");
  const difficulty = readInteger(inputs.difficulty);
  return {
    roll: rollPool(pool, hunger, label || "V5 local"),
    context: { mode: "v5", hunger, ...(difficulty !== null && difficulty >= 1 ? { difficulty } : {}) },
  };
}

/** Rola no modo escolhido; lança erro com a mensagem para o jogador quando a entrada é inválida. */
export function rollFor(mode: RollMode, inputs: DiceInputs): { roll: DiceRoll; context: RollContext } {
  const label = inputs.label.trim();
  if (label.length > LABEL_LIMIT) throw new Error(`O rótulo deve ter até ${LABEL_LIMIT} caracteres.`);
  if (mode === "expression") {
    return { roll: rollExpression(inputs.expression, readModifier(inputs.modifier), label || undefined), context: { mode } };
  }
  if (mode === "sotdl") {
    const numbers = readIntegers([inputs.attribute, inputs.boons, inputs.banes, inputs.target]);
    if (!numbers) throw new Error("Atributo, dádivas, perdições e alvo precisam ser números inteiros.");
    const [attribute, boons, banes, target] = numbers;
    return { roll: rollSotdl(attribute!, boons!, banes!, target!, label || "Shadow of the Demon Lord"), context: { mode } };
  }
  if (mode === "hunter") {
    const numbers = readIntegers([inputs.poolSize, inputs.desperation, inputs.difficulty]);
    if (!numbers) throw new Error("Parada, Desespero e dificuldade precisam ser números inteiros.");
    const [pool, desperation, difficulty] = numbers;
    return { roll: rollHunter(pool!, desperation!, inputs.useDesperation, difficulty!, label || "Caçador local"), context: { mode } };
  }
  return rollV5(inputs, label);
}

function isValidTerm(term: DiceRoll["terms"][number]): boolean {
  return Boolean(term)
    && typeof term.label === "string"
    && Array.isArray(term.rolls)
    && term.rolls.every((roll: number) => Number.isInteger(roll) && roll > 0 && roll <= DICE_LIMITS.maxFaces)
    && Number.isFinite(term.subtotal);
}

/** Aceita do histórico salvo só rolagens bem formadas, até o limite. */
export function validHistory(value: unknown): DiceRoll[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DiceRoll => Boolean(
      item
      && typeof item === "object"
      && typeof item.id === "string"
      && typeof item.expression === "string"
      && Number.isFinite(item.total)
      && Number.isFinite(item.createdAt)
      && Array.isArray(item.terms)
      && item.terms.every(isValidTerm),
    ))
    .slice(0, HISTORY_LIMIT);
}

export function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(timestamp);
  } catch {
    return "Horário indisponível";
  }
}

export function describeTerms(roll: DiceRoll): string {
  return roll.terms.map((term) => `${term.label}: ${term.rolls.length ? term.rolls.join(", ") : term.subtotal}`).join(" · ");
}
