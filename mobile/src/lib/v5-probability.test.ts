import { describe, expect, it } from "vitest";
import { estimateV5Probabilities } from "./v5-probability";

describe("V5 probability comparison", () => {
  it.each([
    [2, 1, 1, 1, [0.75, 0.01, 0.05], [0.875, 0.015, 0.025]],
    [5, 2, 3, 3, [0.5125, 0.05878, 0.1259], [0.780625, 0.0794575, 0.065575]],
    [5, 5, 4, 3, [0.2325, 0.08146, 0.36046], [0.2325, 0.08146, 0.36046]],
    [
      30,
      5,
      8,
      3,
      [0.998382616828084, 0.3859463446782533, 0.0009279777711713791],
      [0.9995957790819734, 0.3923391298712877, 0.00023552716570448398],
    ],
  ] as const)(
    "matches the server for pool %i, hunger %i, difficulty %i",
    (pool, hunger, difficulty, willpower, base, rerolled) => {
      const comparison = estimateV5Probabilities(pool, hunger, difficulty, willpower);
      for (const [index, key] of (
        ["success", "messy_critical", "bestial_failure"] as const
      ).entries()) {
        expect(comparison.without_reroll[key]).toBeCloseTo(base[index], 10);
        expect(comparison.with_reroll[key]).toBeCloseTo(rerolled[index], 10);
      }
    },
  );

  it("rejects invalid inputs instead of changing the pool silently", () => {
    expect(() => estimateV5Probabilities(4, 5, 2)).toThrow();
    expect(() => estimateV5Probabilities(7, 6, 2)).toThrow();
    expect(() => estimateV5Probabilities(5.5, 2, 2)).toThrow();
    expect(() => estimateV5Probabilities(5, 2, 0)).toThrow();
    expect(() => estimateV5Probabilities(5, 2, 2, 4)).toThrow();
  });
});
