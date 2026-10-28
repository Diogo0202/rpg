import type { DieRequest, DieRole } from "./types.ts";

/**
 * Vampire V5 dice on the 3D tray. The result is always decided by the roller (rollPool); these
 * helpers only turn it into dice for the tray and decide what is engraved on each face.
 */

/** Most dice the tray throws. Bigger pools stay on the 2D stage. */
export const V5_TRAY_MAX_DICE = 15;

export type V5Glyph = "ankh" | "skull" | "crowned-ankh";

/**
 * Normal dice carry the ankh and Hunger dice the skull on every face. The 10 shows the crowned
 * ankh on both, since it is the critical face. The physical die prints 0 for the 10; the numbers
 * are not engraved here, the result text and the 2D stage carry them.
 */
export function v5Glyph(role: DieRole, value: number): V5Glyph {
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error("Dado V5 vai de 1 a 10.");
  if (value === 10) return "crowned-ankh";
  return role === "hunger" ? "skull" : "ankh";
}

/** True when the pool fits the tray. */
export function canThrowV5(poolSize: number): boolean {
  return Number.isInteger(poolSize) && poolSize >= 1 && poolSize <= V5_TRAY_MAX_DICE;
}

/**
 * One d10 per roll. The first `hunger` dice are the Hunger dice, the same convention as rollPool
 * and classifyV5, so the red dice on the tray are exactly the ones counted as Hunger.
 */
export function v5Dice(rolls: readonly number[], hunger: number): DieRequest[] {
  if (!canThrowV5(rolls.length)) throw new Error("A bandeja mostra de 1 a 15 dados V5.");
  if (!Number.isInteger(hunger) || hunger < 0 || hunger > rolls.length) throw new Error("Dados de fome inválidos.");
  return rolls.map((value, index): DieRequest => {
    v5Glyph("main", value);
    return { kind: "d10", value, role: index < hunger ? "hunger" : "main" };
  });
}
