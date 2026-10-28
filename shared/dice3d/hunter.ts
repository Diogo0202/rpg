import { MAX_TRAY_DICE } from "./simulate.ts";
import type { DieRequest } from "./types.ts";

/** Maps an already resolved Hunter roll to the finite 3D tray. Never rerolls a result. */
export function hunterDice(normalDice: readonly number[], desperationDice: readonly number[]): { requests: DieRequest[]; omitted: number } {
  if (normalDice.length < 1 || desperationDice.length > 5 ||
      ![...normalDice, ...desperationDice].every((value) => Number.isInteger(value) && value >= 1 && value <= 10)) {
    throw new Error("Resultado de Caçador inválido.");
  }
  const visibleNormal = normalDice.slice(0, Math.max(0, MAX_TRAY_DICE - desperationDice.length));
  return {
    requests: [
      ...visibleNormal.map((value): DieRequest => ({ kind: "d10", value, role: "main" })),
      ...desperationDice.map((value): DieRequest => ({ kind: "d10", value, role: "desperation" })),
    ],
    omitted: normalDice.length - visibleNormal.length,
  };
}
