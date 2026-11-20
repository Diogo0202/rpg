import { describe, expect, it } from "vitest";
import { INITIAL_INPUTS, readIntegers, rollFor, validHistory } from "./dice-model";

describe("dice model", () => {
  it("reads only non-negative integers", () => {
    expect(readIntegers(["1", " 2 ", "30"])).toEqual([1, 2, 30]);
    expect(readIntegers(["1", "-2"])).toBeNull();
    expect(readIntegers(["1.5"])).toBeNull();
  });

  it("rejects bad input with the message shown to the player", () => {
    expect(() => rollFor("expression", { ...INITIAL_INPUTS, modifier: "x" })).toThrow("O modificador precisa ser um número inteiro.");
    expect(() => rollFor("v5", { ...INITIAL_INPUTS, poolSize: "3", hunger: "4" })).toThrow("Dados de fome não podem exceder a parada.");
    expect(() => rollFor("sotdl", { ...INITIAL_INPUTS, boons: "" })).toThrow("Atributo, dádivas, perdições e alvo");
    expect(() => rollFor("expression", { ...INITIAL_INPUTS, label: "x".repeat(49) })).toThrow("até 48 caracteres");
  });

  it("passes hunger and a valid difficulty to the V5 roll context", () => {
    const result = rollFor("v5", { ...INITIAL_INPUTS, poolSize: "4", hunger: "2", difficulty: "0" });
    expect(result.context).toEqual({ mode: "v5", hunger: 2 });
    expect(result.roll.label).toBe("V5 local");
  });

  it("keeps only well-formed saved rolls", () => {
    const good = { id: "a", expression: "1d6", total: 3, createdAt: 1, terms: [{ label: "1d6", rolls: [3], subtotal: 3 }] };
    const bad = { ...good, id: "b", terms: [{ label: "1d6", rolls: [0], subtotal: 0 }] };
    expect(validHistory([good, bad, null]).map((roll) => roll.id)).toEqual(["a"]);
    expect(validHistory("nope")).toEqual([]);
  });
});
