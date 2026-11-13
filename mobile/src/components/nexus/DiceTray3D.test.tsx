import { describe, expect, it } from "vitest";
import { rollExpression, rollHunter, rollPool, rollSotdl } from "@/lib/dice";
import { canShowTray, trayRequests, trayResult } from "./DiceTray3D";

describe("DiceTray3D", () => {
  it("maps a local Demon Lord roll to the d20 and the leftover boon or bane dice", () => {
    const boon = rollSotdl(12, 3, 1);
    const requests = trayRequests(boon)!;
    expect(requests[0]).toEqual({ kind: "d20", value: boon.terms[0]!.rolls[0], role: "main" });
    expect(requests.slice(1).map((die) => die.value)).toEqual(boon.terms[2]!.rolls);
    expect(requests.slice(1).filter((die) => die.kept)).toHaveLength(1);
    expect(trayRequests(rollSotdl(10, 0, 2))!.slice(1).every((die) => die.role === "bane")).toBe(true);
    expect(trayRequests(rollSotdl(10, 2, 2))).toHaveLength(1);
  });

  it("throws free d6, d10 and d20 rolls and shows the modifier added to the total", () => {
    const roll = rollExpression("2d6+1d20", 3);
    const requests = trayRequests(roll)!;
    expect(requests.map((die) => die.kind)).toEqual(["d6", "d6", "d20"]);
    expect(requests.map((die) => die.value)).toEqual([...roll.terms[0]!.rolls, ...roll.terms[1]!.rolls]);
    const result = trayResult(roll);
    expect(result.total).toBe(roll.total);
    expect(result.parts.map((part) => part.label)).toEqual(["2d6", "1d20", "Modificador"]);
    expect(result.parts.at(-1)!.value).toBe(3);
    expect(result.parts.reduce((sum, part) => sum + part.value, 0)).toBe(roll.total);
  });

  it("adds the attribute and the boon to the Demon Lord d20", () => {
    const roll = rollSotdl(13, 2, 0, 12);
    const result = trayResult(roll);
    expect(result.parts.map((part) => part.label)).toEqual(["d20", "Atributo", "Dádiva"]);
    expect(result.parts.map((part) => part.value)).toEqual([roll.terms[0]!.rolls[0], 3, Math.max(...roll.terms[2]!.rolls)]);
    expect(result.total).toBe(roll.total);
    expect(result.against).toEqual({ label: "Alvo", value: 12 });
  });

  it("counts pool successes with the pairs of tens for V5 and Hunter", () => {
    for (const roll of [rollPool(10, 2), rollHunter(8, 3, true, 4)]) {
      const result = trayResult(roll);
      expect(result.total).toBe(roll.total);
      expect(result.parts.reduce((sum, part) => sum + part.value, 0)).toBe(roll.total);
    }
  });

  it("has no 3D set for other rolls and falls back to the 2D stage without WebGL", () => {
    expect(trayRequests(rollExpression("1d8"))).toBeNull();
    expect(trayRequests(rollExpression("2d6-1d6"))).toBeNull();
    expect(trayRequests(rollExpression("16d6"))).toBeNull();
    // jsdom has no WebGL context.
    expect(canShowTray(rollSotdl(10))).toBe(false);
    expect(canShowTray(null)).toBe(false);
  });

  it("keeps all Desperation faces visible in a large Hunter pool", () => {
    const roll = rollHunter(30, 5, true, 3);
    const requests = trayRequests(roll)!;
    expect(requests).toHaveLength(15);
    expect(requests.filter((die) => die.role === "desperation").map((die) => die.value)).toEqual(roll.terms[1]!.rolls);
    expect(requests.filter((die) => die.role === "main").map((die) => die.value)).toEqual(roll.terms[0]!.rolls.slice(0, 10));
    expect(requests.every((die) => die.kind === "d10")).toBe(true);
  });

  it("maps a local V5 pool to d10 with the Hunger dice first, and leaves big pools to the 2D stage", () => {
    const roll = rollPool(8, 3);
    const requests = trayRequests(roll)!;
    expect(requests.map((die) => die.value)).toEqual(roll.terms[0]!.rolls);
    expect(requests.map((die) => die.role)).toEqual(["hunger", "hunger", "hunger", "main", "main", "main", "main", "main"]);
    expect(requests.every((die) => die.kind === "d10")).toBe(true);
    expect(trayRequests(rollPool(16, 2))).toBeNull();
  });
});
