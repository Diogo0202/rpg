import { describe, expect, it } from "vitest";
import { DICE_LIMITS, parseDice, randomInt, rollExpression, rollPool, type DiceTerm } from "./dice";

describe("parseDice", () => {
  it("returns the real dice/constant union for valid terms", () => {
    const terms: DiceTerm[] = parseDice("2d6-3+d8");
    expect(terms).toEqual([
      { sign: 1, count: 2, faces: 6 },
      { sign: -1, constant: 3 },
      { sign: 1, count: 1, faces: 8 },
    ]);
  });

  it("enforces term, count, face, and modifier limits", () => {
    expect(() => parseDice("1d6+1d6+1d6+1d6+1d6+1d6+1d6+1d6+1d6+1d6+1")).toThrow();
    expect(() => parseDice("101d6")).toThrow();
    expect(() => parseDice("1d1001")).toThrow();
    expect(() => parseDice("100000000000000000000d6")).toThrow();
    expect(() => parseDice("1d6+1001")).toThrow();
    expect(() => parseDice("1d6-1001")).toThrow();
    expect(DICE_LIMITS.maxTerms).toBe(10);
  });

  it("rejects malformed and non-string input", () => {
    expect(() => parseDice("1d6/2")).toThrow();
    expect(() => parseDice("1d6".repeat(20))).toThrow();
    expect(() => parseDice(null as unknown as string)).toThrow();
  });
});

describe("randomInt and rolling", () => {
  it("uses rejection sampling for an unbiased bounded result", () => {
    const values = [0xffff_fffc, 7];
    let calls = 0;
    const result = randomInt(6, (buffer) => {
      buffer[0] = values[calls++]!;
    });
    expect(calls).toBe(2);
    expect(result).toBe(2);
  });

  it("stops after a broken source repeatedly returns rejected values", () => {
    expect(() =>
      randomInt(3, (buffer) => {
        buffer[0] = 0xffff_ffff;
      }),
    ).toThrow("número aleatório válido");
  });

  it("calculates terms and validates modifiers before rolling", () => {
    const roll = rollExpression("1d6+2", 3);
    expect(roll.total).toBeGreaterThanOrEqual(6);
    expect(roll.total).toBeLessThanOrEqual(11);
    expect(() => rollExpression("1d6", Number.POSITIVE_INFINITY)).toThrow("Modificador inválido");
  });

  it("rejects non-finite pool values", () => {
    expect(() => rollPool(3, Number.NaN)).toThrow("fome inválidos");
    expect(() => rollPool(3, Number.POSITIVE_INFINITY)).toThrow("fome inválidos");
    expect(() => rollPool(6, 6)).toThrow("fome inválidos");
    expect(() => rollPool(3, 1.5)).toThrow("fome inválidos");
  });
});
