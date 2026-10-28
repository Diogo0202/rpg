import type { DieRequest } from "./types.ts";

/** Numbers from a Shadow of the Demon Lord roll, whether from the API or the local mobile roller. */
export type SotdlDiceInput = { d20: number; boonDice: number[]; netBoons: number };

/** 1d20 plus the leftover boon or bane d6; only the highest d6 counts. */
export function sotdlDice({ d20, boonDice, netBoons }: SotdlDiceInput): DieRequest[] {
  const role = netBoons >= 0 ? "boon" : "bane";
  const kept = boonDice.length ? boonDice.indexOf(Math.max(...boonDice)) : -1;
  return [
    { kind: "d20", value: d20, role: "main" },
    ...boonDice.map((value, index): DieRequest => ({ kind: "d6", value, role, kept: index === kept })),
  ];
}

export function sotdlFateDice(die: number): DieRequest[] {
  return [{ kind: "d6", value: die, role: "fate" }];
}
