import { describe, expect, it } from "vitest";
import type { DiceRoll } from "./dice";
import {
  MAX_ANIMATED_DICE,
  buildDiceViews,
  classifyV5,
  planDice,
  randomInt,
  rollDice,
  summarizeRoll,
} from "./dice-roller";

function poolRoll(rolls: number[], hunger: number): DiceRoll {
  return {
    id: "r",
    expression: "parada",
    terms: [{ label: `${rolls.length}d10`, rolls, subtotal: 0 }],
    total: 0,
    createdAt: 0,
    pool: { successes: 0, tens: 0, hungerDice: rolls.slice(0, hunger) },
  };
}

describe("distribuição", () => {
  it("é aproximadamente uniforme em d6 e d10 (qui-quadrado)", () => {
    // Valores críticos do qui-quadrado com p = 0,001 e faces - 1 graus de liberdade.
    const critical: Record<number, number> = { 6: 20.52, 10: 27.88, 20: 43.82 };
    for (const faces of [6, 10, 20]) {
      const samples = 1000;
      const counts = new Array(faces).fill(0);
      for (let i = 0; i < 30; i++) for (const value of rollDice(samples, faces)) counts[value - 1]++;
      const expected = (samples * 30) / faces;
      const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
      expect(chi).toBeLessThan(critical[faces]!);
      expect(Math.min(...counts)).toBeGreaterThan(0);
    }
  });

  it("descarta valores acima do limite para não enviesar o módulo", () => {
    const limit = Math.floor(0x100000000 / 6) * 6;
    const values = [0xffffffff, limit, 7];
    let calls = 0;
    const value = randomInt(6, (arr) => {
      arr[0] = values[calls++]!;
    });
    expect(calls).toBe(3);
    expect(value).toBe((7 % 6) + 1);
  });

  it("mapeia o menor e o maior valor aceito para as faces 1 e N", () => {
    const limit = Math.floor(0x100000000 / 10) * 10;
    expect(randomInt(10, (arr) => void (arr[0] = 0))).toBe(1);
    expect(randomInt(10, (arr) => void (arr[0] = limit - 1))).toBe(10);
  });
});

describe("classifyV5", () => {
  it("conta sucessos e dois extras por par de 10", () => {
    expect(classifyV5([10, 10, 6, 1], 0, 4)).toMatchObject({ successes: 5, tens: 2, critical: true, success: true });
    expect(classifyV5([10, 10, 10], 0).successes).toBe(5);
  });

  it("marca crítico sujo quando um 10 do par é de Fome", () => {
    const result = classifyV5([10, 3, 10], 1, 2);
    expect(result).toMatchObject({ critical: true, messyCritical: true, hungerTens: 1 });
    expect(classifyV5([3, 10, 10], 1, 2).messyCritical).toBe(false);
  });

  it("não é crítico quando o par não alcança a dificuldade", () => {
    expect(classifyV5([10, 10], 1, 6)).toMatchObject({ success: false, critical: false, messyCritical: false });
  });

  it("marca falha bestial só em falha com 1 na Fome", () => {
    expect(classifyV5([1, 7, 2], 1, 3)).toMatchObject({ success: false, bestialFailure: true });
    expect(classifyV5([1, 7, 8], 1, 2)).toMatchObject({ success: true, bestialFailure: false, bestialRisk: true });
    expect(classifyV5([2, 1, 2], 1, 3).bestialFailure).toBe(false);
  });

  it("sem dificuldade não decide sucesso nem falha bestial", () => {
    expect(classifyV5([1, 3], 1)).toMatchObject({ success: null, bestialFailure: false, bestialRisk: true, margin: null });
  });

  it("rejeita entradas inválidas", () => {
    expect(() => classifyV5([11], 0)).toThrow();
    expect(() => classifyV5([5], 2)).toThrow();
  });
});

describe("apresentação", () => {
  it("destaca dados de Fome com 10 e 1", () => {
    const views = buildDiceViews(poolRoll([10, 1, 10, 7, 2], 2), { mode: "v5", hunger: 2 });
    expect(views.map((v) => v.tone)).toEqual(["messy", "bestial", "crit", "success", "neutral"]);
    expect(views.slice(0, 2).every((v) => v.hunger)).toBe(true);
  });

  it("resume crítico sujo e falha bestial", () => {
    expect(summarizeRoll(poolRoll([10, 10, 3], 1), { mode: "v5", hunger: 1, difficulty: 2 }).headline).toBe("Crítico sujo");
    expect(summarizeRoll(poolRoll([1, 2, 3], 1), { mode: "v5", hunger: 1, difficulty: 2 }).headline).toBe("Falha bestial");
  });

  it("identifica Desespero e escreve um sucesso no singular", () => {
    const roll: DiceRoll = {
      id: "hunter-1", expression: "Caçador", total: 1, createdAt: 0,
      terms: [{ label: "Dados comuns", rolls: [2, 3], subtotal: 0 }, { label: "Dados de Desespero", rolls: [1, 7], subtotal: 1 }],
      hunter: { difficulty: 3, success: false, critical: false, criticalPairs: 0, desperationOnes: 1, desperationConsequence: "despair" },
    };
    expect(buildDiceViews(roll, { mode: "hunter" })[2]).toMatchObject({ faces: 10, hunger: true, value: 1 });
    expect(summarizeRoll(roll, { mode: "hunter" }).detail).toBe("1 sucesso contra dificuldade 3. Desespero: Despair.");
  });

  it("destaca máximo e 1 em expressões", () => {
    const roll: DiceRoll = {
      id: "e",
      expression: "2d6",
      terms: [{ label: "2d6", rolls: [6, 1], subtotal: 7 }],
      total: 7,
      createdAt: 0,
    };
    expect(buildDiceViews(roll, { mode: "expression" }).map((v) => v.tone)).toEqual(["crit", "fail"]);
    expect(summarizeRoll(roll, { mode: "expression" }).announce).toContain("Total 7");
  });

  it(`agrupa acima de ${MAX_ANIMATED_DICE} dados`, () => {
    const rolls = Array.from({ length: 25 }, (_, i) => (i % 10) + 1);
    expect(planDice(poolRoll(rolls.slice(0, 20), 0), { mode: "v5" }).mode).toBe("individual");
    const plan = planDice(poolRoll(rolls, 3), { mode: "v5", hunger: 3 });
    expect(plan.mode).toBe("grouped");
    if (plan.mode !== "grouped") return;
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.reduce((n, g) => n + g.values.length, 0)).toBe(25);
  });
});
